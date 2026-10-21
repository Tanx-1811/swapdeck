import AppKit
import Observation
import ServiceManagement
import SwapdeckCore

enum ManagerSelection: Hashable {
    case workspace(String)
    case settings
    case importing
}

/// Whether macOS lets Swapdeck script the browser (asked on first use).
enum AutomationState: String {
    case unknown, allowed, denied
}

enum ProfileStatus: Equatable {
    case ready(BrowserProfile)
    case unassigned
    case missing
    case browserMissing
}

struct Banner: Identifiable, Equatable {
    enum Tone { case info, error }
    let id = UUID()
    let tone: Tone
    let text: String
}

/// The app's state and actions. Everything runs on the main actor; processes
/// (`open`, `osascript`) run off it through `Shell`.
@MainActor @Observable
final class AppModel {
    var data: DesktopData
    var profiles: [BrowserKind: [BrowserProfile]] = [:]
    var unreadableBrowsers: Set<BrowserKind> = []
    var installedBrowsers: [BrowserKind] = []
    /// Workspaces that have a named window, and the one whose window is in front.
    var openIds: Set<String> = []
    var frontId: String?
    var automation: AutomationState
    var busyId: String?
    var banner: Banner?
    var query = ""
    var launchAtLogin = false

    @ObservationIgnored let store: DataStore
    @ObservationIgnored let applicationSupport: URL
    /// Previews run on sample data and never touch the system.
    @ObservationIgnored let offline: Bool
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var bannerTask: Task<Void, Never>?
    /// Workspaces renamed since the last save → the name their window still has.
    @ObservationIgnored private var pendingRenames: [String: String] = [:]
    @ObservationIgnored var onShowManager: ((ManagerSelection?) -> Void)?
    @ObservationIgnored var onClosePopover: (() -> Void)?
    @ObservationIgnored var onHotkeyChange: (() -> Void)?

    init(store: DataStore, applicationSupport: URL, defaults: UserDefaults = .standard, offline: Bool = false) {
        self.store = store
        self.applicationSupport = applicationSupport
        self.defaults = defaults
        self.offline = offline
        self.data = DesktopData()
        self.automation = AutomationState(rawValue: defaults.string(forKey: "automation") ?? "") ?? .unknown
    }

    static func standard() -> AppModel {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return AppModel(store: .standard(), applicationSupport: support)
    }

    var t: Translator { Translator(Language.resolve(data.settings.language)) }
    var workspaces: [Workspace] { data.ordered }
    var visibleWorkspaces: [Workspace] { WorkspaceLogic.filter(workspaces, query: query) }

    func workspace(_ id: String) -> Workspace? {
        data.workspaces.first { $0.id == id }
    }

    // MARK: - Loading and saving

    func load() {
        data = store.load()
        refreshProfiles()
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    func refreshProfiles() {
        guard !offline else { return }
        installedBrowsers = BrowserKind.allCases.filter {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.bundleIdentifier) != nil
        }
        var found: [BrowserKind: [BrowserProfile]] = [:]
        var unreadable = Set<BrowserKind>()
        for browser in installedBrowsers {
            let url = browser.localStateURL(applicationSupport: applicationSupport)
            guard let raw = try? Data(contentsOf: url) else { continue }
            do {
                found[browser] = try ProfileReader.profiles(localState: raw)
            } catch {
                unreadable.insert(browser)
            }
        }
        profiles = found
        unreadableBrowsers = unreadable
    }

    /// Saves at once (structural changes).
    func save() {
        saveTask?.cancel()
        do {
            try store.save(data)
        } catch {
            show(.error, t("error.save", ["detail": error.localizedDescription]))
        }
        let renames = pendingRenames
        pendingRenames = [:]
        if !renames.isEmpty, !offline, automation == .allowed, data.settings.nameWindows {
            Task { await renameWindows(renames) }
        }
    }

    /// Keeps a renamed workspace's window named after it, so it is still found.
    private func renameWindows(_ renames: [String: String]) async {
        for (id, oldName) in renames {
            guard let workspace = workspace(id), workspace.name != oldName, isRunning(workspace.browser),
                  let windows = await windows(of: workspace.browser),
                  let window = windows.first(where: { !$0.incognito && $0.givenName == oldName })
            else { continue }
            _ = await Shell.appleScript(BrowserScript.nameWindow(workspace.browser, id: window.id, name: workspace.name))
        }
    }

    /// Saves shortly after the last edit (typing in the editor).
    func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    func show(_ tone: Banner.Tone, _ text: String) {
        banner = Banner(tone: tone, text: text)
        bannerTask?.cancel()
        bannerTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(tone == .error ? 8 : 4))
            guard !Task.isCancelled else { return }
            self?.banner = nil
        }
    }

    // MARK: - Workspaces

    func update(_ workspace: Workspace) {
        guard let index = data.workspaces.firstIndex(where: { $0.id == workspace.id }) else { return }
        let previous = data.workspaces[index].name
        if previous != workspace.name, pendingRenames[workspace.id] == nil { pendingRenames[workspace.id] = previous }
        data.workspaces[index] = workspace
        scheduleSave()
    }

    @discardableResult
    func createWorkspace() -> Workspace {
        let browser = data.settings.defaultBrowser
        let unused = WorkspaceLogic.unusedProfiles(profiles[browser] ?? [], workspaces: data.workspaces, browser: browser)
        let workspace = Workspace(
            name: WorkspaceLogic.uniqueName(t("manager.newName"), existing: data.workspaces),
            color: Palette.next(after: data.workspaces.map(\.color)),
            browser: browser,
            profileDirectory: unused.first?.directory ?? "",
            order: (data.workspaces.map(\.order).max() ?? -1) + 1
        )
        data.workspaces.append(workspace)
        save()
        return workspace
    }

    func delete(_ id: String) {
        data.workspaces.removeAll { $0.id == id }
        openIds.remove(id)
        if frontId == id { frontId = nil }
        save()
    }

    func move(_ id: String, to index: Int) {
        data.workspaces = WorkspaceLogic.move(data.workspaces, id: id, to: index)
        save()
    }

    func setSettings(_ change: (inout DesktopSettings) -> Void) {
        let before = data.settings
        change(&data.settings)
        save()
        if before.hotkey != data.settings.hotkey { onHotkeyChange?() }
    }

    // MARK: - Profiles

    func profileStatus(_ workspace: Workspace) -> ProfileStatus {
        if workspace.profileDirectory.isEmpty { return .unassigned }
        if !offline, !installedBrowsers.contains(workspace.browser) { return .browserMissing }
        if let profile = profiles[workspace.browser]?.first(where: { $0.directory == workspace.profileDirectory }) {
            return .ready(profile)
        }
        // A profile Chrome just created is on disk before it is listed in Local State.
        let folder = workspace.browser.dataDirectory(applicationSupport: applicationSupport)
            .appendingPathComponent(workspace.profileDirectory, isDirectory: true)
        if !offline, FileManager.default.fileExists(atPath: folder.path) {
            return .ready(BrowserProfile(directory: workspace.profileDirectory, name: workspace.profileDirectory))
        }
        return .missing
    }

    /// Opens the browser on a brand-new profile for the workspace.
    func createProfile(for workspace: Workspace) async {
        var updated = workspace
        let folder = workspace.browser.dataDirectory(applicationSupport: applicationSupport)
        let onDisk = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        let known = Set((profiles[workspace.browser] ?? []).map(\.directory)).union(onDisk)
        updated.profileDirectory = ProfileReader.newDirectoryName(existing: known)
        update(updated)
        save()
        await open(updated, newWindow: true, creatingProfile: true)
        try? await Task.sleep(for: .seconds(2))
        refreshProfiles()
    }

    // MARK: - Opening

    func isRunning(_ browser: BrowserKind) -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleIdentifier).isEmpty
    }

    /// Brings the workspace's window back, or opens its profile in a new window
    /// (with its pages) and names that window after the workspace.
    func open(_ workspace: Workspace, newWindow: Bool = false, creatingProfile: Bool = false) async {
        switch creatingProfile ? .ready(BrowserProfile(directory: workspace.profileDirectory, name: "")) : profileStatus(workspace) {
        case .unassigned:
            show(.error, t("error.noProfile", ["name": workspace.name]))
            onShowManager?(.workspace(workspace.id))
            return
        case .browserMissing:
            show(.error, t("error.browserMissing", ["browser": workspace.browser.displayName]))
            return
        case .missing:
            show(.error, t("error.profileMissing", [
                "browser": workspace.browser.displayName, "profile": workspace.profileDirectory, "name": workspace.name,
            ]))
            onShowManager?(.workspace(workspace.id))
            return
        case .ready:
            break
        }
        guard !offline else { return }
        busyId = workspace.id
        defer { busyId = nil }

        let browser = workspace.browser
        let wasRunning = isRunning(browser)
        let naming = data.settings.nameWindows && automation != .denied
        var before: [BrowserWindow] = []
        if wasRunning && naming, let windows = await windows(of: browser) {
            before = windows
            if !newWindow, let window = WorkspaceLogic.window(for: workspace, in: windows) {
                if case .ok("ok") = await Shell.appleScript(BrowserScript.focusWindow(browser, id: window.id)) {
                    recordOpened(workspace.id)
                    return
                }
            }
        }

        let urls = workspace.openLinksInNewWindow ? workspace.openableLinks.map(\.url) : []
        guard let command = Launcher.openProfile(browser, profileDirectory: workspace.profileDirectory, urls: urls) else { return }
        let result = await Shell.run(command)
        guard result.status == 0 else {
            show(.error, t("error.launch", ["browser": browser.displayName, "detail": result.error]))
            return
        }
        recordOpened(workspace.id)
        if naming {
            await nameLaunchedWindow(workspace, before: Set(before.map(\.id)), wasRunning: wasRunning, urls: urls)
        }
        await refreshWindows()
    }

    /// Opens one of the workspace's pages in its profile (a new tab in its window).
    func openLink(_ link: WorkspaceLink, in workspace: Workspace) async {
        guard case .ready = profileStatus(workspace), !offline,
              let command = Launcher.openProfile(workspace.browser, profileDirectory: workspace.profileDirectory, urls: [link.url], newWindow: false)
        else {
            await open(workspace)
            return
        }
        let result = await Shell.run(command)
        if result.status != 0 {
            show(.error, t("error.launch", ["browser": workspace.browser.displayName, "detail": result.error]))
        } else {
            recordOpened(workspace.id)
        }
    }

    private func recordOpened(_ id: String) {
        guard let index = data.workspaces.firstIndex(where: { $0.id == id }) else { return }
        data.workspaces[index].lastOpenedAt = Date()
        data.workspaces[index].openCount += 1
        frontId = id
        openIds.insert(id)
        save()
    }

    /// Waits for the window a launch opened (up to ~6 s) and names it.
    private func nameLaunchedWindow(_ workspace: Workspace, before: Set<String>, wasRunning: Bool, urls: [String]) async {
        let hosts = urls.compactMap { URL(string: $0)?.host }
        var lastCount = -1
        for _ in 0..<24 {
            try? await Task.sleep(for: .milliseconds(250))
            guard let windows = await windows(of: workspace.browser) else { return }
            let fresh = windows.filter { !before.contains($0.id) }
            if fresh.isEmpty { continue }
            // After a cold start, wait until restored windows stop appearing.
            if !wasRunning && hosts.isEmpty && fresh.count != lastCount {
                lastCount = fresh.count
                continue
            }
            var active: [String: String] = [:]
            if !wasRunning, !hosts.isEmpty, case .ok(let text) = await Shell.appleScript(BrowserScript.listActiveURLs(workspace.browser)) {
                active = BrowserScript.parseActiveURLs(text)
            }
            if let window = WorkspaceLogic.launchedWindow(
                before: before, after: windows, wasRunning: wasRunning, expectedHosts: hosts, activeURLs: active
            ) {
                _ = await Shell.appleScript(BrowserScript.nameWindow(workspace.browser, id: window.id, name: workspace.name))
                return
            }
            if wasRunning || hosts.isEmpty { return }
        }
    }

    /// The browser's windows, or nil when it can't be scripted (and why is remembered).
    private func windows(of browser: BrowserKind) async -> [BrowserWindow]? {
        switch await Shell.appleScript(BrowserScript.listWindows(browser)) {
        case .ok(let text):
            setAutomation(.allowed)
            return BrowserScript.parseWindows(text)
        case .denied:
            setAutomation(.denied)
            return nil
        case .failed:
            return nil
        }
    }

    private func setAutomation(_ state: AutomationState) {
        guard automation != state else { return }
        automation = state
        defaults.set(state.rawValue, forKey: "automation")
    }

    /// Marks open workspaces and the one in front. Only scripts the browser once
    /// macOS has allowed it, so opening the menu never triggers a prompt.
    func refreshWindows() async {
        guard !offline, automation == .allowed, data.settings.nameWindows else { return }
        var open = Set<String>()
        var front: String?
        var frontBrowser: BrowserKind?
        if let app = NSWorkspace.shared.frontmostApplication?.bundleIdentifier {
            frontBrowser = BrowserKind.allCases.first { $0.bundleIdentifier == app }
        }
        for browser in Set(data.workspaces.map(\.browser)) where isRunning(browser) {
            guard let windows = await windows(of: browser) else { continue }
            let state = WorkspaceLogic.windowState(windows, workspaces: data.workspaces, browser: browser)
            open.formUnion(state.open)
            if front == nil || frontBrowser == browser, let id = state.front { front = id }
        }
        openIds = open
        frontId = front
    }

    func recheckAutomation() async {
        setAutomation(.unknown)
        for browser in Set(data.workspaces.map(\.browser)) where isRunning(browser) {
            _ = await windows(of: browser)
            return
        }
    }

    // MARK: - Import

    @discardableResult
    func importProfiles(_ browser: BrowserKind) -> Int {
        let unused = WorkspaceLogic.unusedProfiles(profiles[browser] ?? [], workspaces: data.workspaces, browser: browser)
        for profile in unused {
            data.workspaces.append(WorkspaceLogic.workspace(for: profile, browser: browser, existing: data.workspaces))
        }
        save()
        return unused.count
    }

    /// Adds the workspaces of an extension backup (names, looks and pages only).
    func importBackup(_ file: Data, password: String?) throws -> Int {
        let imported = try BackupImport.workspaces(from: file, password: password)
        let added = WorkspaceLogic.adopt(imported, into: data.workspaces, browser: data.settings.defaultBrowser)
        data.workspaces += added
        save()
        return added.count
    }

    // MARK: - System

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            show(.error, t("settings.launchAtLoginFailed", ["detail": error.localizedDescription]))
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    func openAutomationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
    }

    func showDataInFinder() {
        let url = store.fileURL
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            NSWorkspace.shared.open(url.deletingLastPathComponent())
        }
    }
}
