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

/// Why a new name wasn't taken.
enum NameCheck: Equatable {
    case ok
    case empty
    case taken(by: String)
}

struct Banner: Identifiable, Equatable {
    enum Tone { case info, error }
    let id = UUID()
    let tone: Tone
    let text: String
}

/// A name to take off a browser's windows: the workspace `id` moved to another profile.
struct PendingUnname: Sendable {
    let id: String
    let browser: BrowserKind
    let name: String
}

/// A secret typed in the editor, waiting to go to the Keychain.
struct StagedSecret: Hashable {
    let workspace: String
    let name: String
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
    /// "Check for updates" in Settings.
    var updateCheck: UpdateCheck = .idle
    /// Bumped after asking macOS to change the default browser, so views read it again.
    var defaultBrowserCheck = 0

    @ObservationIgnored let store: DataStore
    @ObservationIgnored let applicationSupport: URL
    /// Previews run on sample data and never touch the system.
    @ObservationIgnored let offline: Bool
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let browserInstalled: @MainActor (BrowserKind) -> Bool
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var bannerTask: Task<Void, Never>?
    /// Workspaces renamed since the last save → the name their window still has.
    @ObservationIgnored private var pendingRenames: [String: String] = [:]
    /// Names to take off windows (of a workspace that moved to another profile or browser).
    @ObservationIgnored private var pendingUnnames: [PendingUnname] = []
    /// Workspaces whose profile changed: their next opening gets a new window.
    @ObservationIgnored private(set) var profileChanged: Set<String> = []
    /// One launch at a time per browser, so each new window is named after the right workspace.
    @ObservationIgnored private var launchQueues: [BrowserKind: Task<Void, Never>] = [:]
    @ObservationIgnored var onShowManager: ((ManagerSelection?) -> Void)?
    @ObservationIgnored var onClosePopover: (() -> Void)?
    @ObservationIgnored var onHotkeyChange: (() -> Void)?
    /// Shows the "which workspace?" chooser for a link.
    @ObservationIgnored var onChooseLink: ((URL) -> Void)?

    /// Values of the workspaces' terminal variables (the Keychain; in memory for previews).
    @ObservationIgnored let secrets: SecretStore
    /// Single-use passes that let "Open in Terminal" load the tokens without Touch ID.
    @ObservationIgnored let tickets: TerminalTickets
    /// Values typed in the editor, written to the Keychain a moment later (or at once by `flushPendingWrites`).
    @ObservationIgnored var stagedSecrets: [StagedSecret: String] = [:]
    @ObservationIgnored var secretTask: Task<Void, Never>?

    init(
        store: DataStore,
        applicationSupport: URL,
        defaults: UserDefaults = .standard,
        offline: Bool = false,
        secrets: SecretStore = KeychainSecretStore(),
        tickets: TerminalTickets = .standard(),
        browserInstalled: @escaping @MainActor (BrowserKind) -> Bool = {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.bundleIdentifier) != nil
        }
    ) {
        self.store = store
        self.applicationSupport = applicationSupport
        self.defaults = defaults
        self.offline = offline
        self.secrets = secrets
        self.tickets = tickets
        self.browserInstalled = browserInstalled
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
        let (loaded, outcome) = store.loadReportingOutcome()
        data = loaded
        refreshProfiles()
        if Bundle.main.bundleURL.pathExtension == "app" {
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
        guard !offline else { return }
        tickets.purgeExpired()
        // Tokens of workspaces that no longer exist — only when the data file was read: a
        // file that couldn't be must never cost the user their tokens.
        if outcome == .loaded {
            do {
                try secrets.sweep(keeping: Set(data.workspaces.map(\.id)))
            } catch {
                show(.error, t("terminal.sweepFailed", ["detail": "\(error)"]))
            }
        }
    }

    /// Reads the browsers' profiles, and refreshes what each workspace remembers of its
    /// profile — only while it is still the same profile (see `WorkspaceLogic.refreshedDetails`).
    func refreshProfiles() {
        guard !offline else { return }
        reloadProfiles()
        let refreshed = data.workspaces.map { WorkspaceLogic.refreshedDetails($0, profile: profile(of: $0)) }
        if refreshed != data.workspaces {
            data.workspaces = refreshed
            save()
        }
    }

    /// The browsers' profiles from their Local State, without touching the workspaces.
    private func reloadProfiles() {
        guard !offline else { return }
        installedBrowsers = BrowserKind.allCases.filter { browserInstalled($0) }
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

    private func profile(of workspace: Workspace) -> BrowserProfile? {
        profiles[workspace.browser]?.first { $0.directory == workspace.profileDirectory }
    }

    /// Saves at once (structural changes).
    func save() {
        saveTask?.cancel()
        saveTask = nil
        do {
            try store.save(data)
        } catch {
            show(.error, t("error.save", ["detail": error.localizedDescription]))
        }
        let renames = pendingRenames
        let unnames = pendingUnnames
        pendingRenames = [:]
        pendingUnnames = []
        guard !offline, automation == .allowed, data.settings.nameWindows else { return }
        // In each browser's launch queue, so a window being opened and named isn't touched halfway.
        for item in unnames {
            Task { await serialized(item.browser) { [self] in await unnameWindows([item]) } }
        }
        for (id, oldName) in renames {
            guard let browser = workspace(id)?.browser else { continue }
            Task { await serialized(browser) { [self] in await renameWindow(id, from: oldName) } }
        }
    }

    /// Writes what is still waiting: the data file and the tokens typed in the editor.
    func flushPendingWrites() {
        flushSecrets()
        if saveTask != nil { save() }
    }

    /// Keeps a renamed workspace's window named after it, so it is still found.
    private func renameWindow(_ id: String, from oldName: String) async {
        guard let workspace = workspace(id), workspace.name != oldName, isRunning(workspace.browser),
              let windows = await windows(of: workspace.browser),
              let window = windows.first(where: { !$0.incognito && $0.givenName == oldName })
        else { return }
        _ = await Shell.appleScript(BrowserScript.nameWindow(workspace.browser, id: window.id, name: workspace.name))
    }

    /// Takes a workspace's name off the windows of the profile it no longer uses.
    private func unnameWindows(_ unnames: [PendingUnname]) async {
        for item in unnames where !item.name.isEmpty && isRunning(item.browser) {
            _ = await Shell.appleScript(BrowserScript.clearName(item.browser, name: item.name))
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

    /// Saves a workspace's changes. Its name only changes through `rename`.
    func update(_ workspace: Workspace) {
        guard let index = data.workspaces.firstIndex(where: { $0.id == workspace.id }) else { return }
        let previous = data.workspaces[index]
        var workspace = workspace
        workspace.name = previous.name
        if previous.profileDirectory != workspace.profileDirectory || previous.browser != workspace.browser {
            workspace = withChosenProfileDetails(workspace)
            // Its window belongs to the old profile now: never bring that one back for it.
            profileChanged.insert(workspace.id)
            pendingUnnames.append(PendingUnname(id: workspace.id, browser: previous.browser, name: previous.name))
        }
        data.workspaces[index] = workspace
        scheduleSave()
    }

    /// Renames a workspace, unless the name is empty or another workspace has it (without
    /// accents or case): a workspace's window is found again by its name.
    @discardableResult
    func rename(_ id: String, to proposed: String) -> NameCheck {
        guard let index = data.workspaces.firstIndex(where: { $0.id == id }) else { return .ok }
        let name = DataFile.cleanName(proposed)
        if name.isEmpty { return .empty }
        if let other = WorkspaceLogic.nameOwner(name, in: data.workspaces, except: id) { return .taken(by: other.name) }
        let previous = data.workspaces[index].name
        guard previous != name else { return .ok }
        if pendingRenames[id] == nil { pendingRenames[id] = previous }
        data.workspaces[index].name = name
        scheduleSave()
        return .ok
    }

    /// The profile the user just chose: remember its name and Google account (to find it again
    /// on another Mac), or nothing yet when the browser hasn't listed it (filled at the next refresh).
    private func withChosenProfileDetails(_ workspace: Workspace) -> Workspace {
        var copy = workspace
        let profile = profile(of: workspace)
        copy.profileName = profile?.name ?? ""
        copy.profileEmail = profile?.email ?? ""
        return copy
    }

    @discardableResult
    func createWorkspace() -> Workspace {
        let browser = data.settings.defaultBrowser
        let unused = WorkspaceLogic.unusedProfiles(profiles[browser] ?? [], workspaces: data.workspaces, browser: browser)
        let profile = unused.first
        let workspace = Workspace(
            name: WorkspaceLogic.uniqueName(t("manager.newName"), existing: data.workspaces),
            color: Palette.next(after: data.workspaces.map(\.color)),
            browser: browser,
            profileDirectory: profile?.directory ?? "",
            profileName: profile?.name ?? "",
            profileEmail: profile?.email ?? "",
            order: (data.workspaces.map(\.order).max() ?? -1) + 1
        )
        data.workspaces.append(workspace)
        save()
        return workspace
    }

    func delete(_ id: String) {
        if let workspace = workspace(id) {
            discardStagedSecrets(of: id)
            do {
                try secrets.removeAll(workspace: id)
            } catch {
                show(.error, t("terminal.removeFailed", ["name": workspace.name, "detail": "\(error)"]))
            }
        }
        data.workspaces.removeAll { $0.id == id }
        openIds.remove(id)
        profileChanged.remove(id)
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
        if let profile = profile(of: workspace) {
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

    /// Whether a link can be opened in the workspace's profile right now.
    func canOpenLinks(in workspace: Workspace) -> Bool {
        if case .ready = profileStatus(workspace) { return true }
        return false
    }

    /// Opens the browser on a brand-new profile for the workspace.
    func createProfile(for workspace: Workspace) async {
        var updated = workspace
        let folder = workspace.browser.dataDirectory(applicationSupport: applicationSupport)
        let onDisk = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        let known = Set((profiles[workspace.browser] ?? []).map(\.directory)).union(onDisk)
        updated.profileDirectory = ProfileReader.newDirectoryName(existing: known)
        // Chrome adopts the name of a new profile from its first preferences, and themes it from the color.
        let profileFolder = folder.appendingPathComponent(updated.profileDirectory, isDirectory: true)
        if !FileManager.default.fileExists(atPath: profileFolder.path) {
            try? FileManager.default.createDirectory(at: profileFolder, withIntermediateDirectories: true)
            try? ProfileSeed.preferences(name: workspace.name, color: workspace.color)
                .write(to: profileFolder.appendingPathComponent("Preferences"), options: .atomic)
        }
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

    /// Runs launches of one browser one after another: each one names the window it opened.
    private func serialized(_ browser: BrowserKind, _ work: @escaping @MainActor @Sendable () async -> Void) async {
        let previous = launchQueues[browser]
        let task = Task { @MainActor in
            await previous?.value
            await work()
        }
        launchQueues[browser] = task
        await task.value
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
        let id = workspace.id
        await serialized(workspace.browser) { [self] in
            await launch(id, newWindow: newWindow)
        }
    }

    private func launch(_ id: String, newWindow requested: Bool) async {
        // The workspace as it is now (it may have changed while waiting for its turn).
        guard let workspace = workspace(id), !workspace.profileDirectory.isEmpty else { return }
        busyId = workspace.id
        defer { busyId = nil }

        let browser = workspace.browser
        let wasRunning = isRunning(browser)
        let naming = data.settings.nameWindows && automation != .denied
        let newWindow = requested || profileChanged.contains(workspace.id)
        // Moved to another profile and not saved yet: its old window loses the name first.
        let stale = pendingUnnames.filter { $0.id == workspace.id }
        if !stale.isEmpty {
            pendingUnnames.removeAll { $0.id == workspace.id }
            if naming { await unnameWindows(stale) }
        }
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
        profileChanged.remove(workspace.id)
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
        let id = workspace.id
        let browser = workspace.browser
        await serialized(browser) { [self] in
            let result = await Shell.run(command)
            if result.status != 0 {
                show(.error, t("error.launch", ["browser": browser.displayName, "detail": result.error]))
            } else {
                recordOpened(id)
            }
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

    /// Waits for the window a launch opened (up to ~6 s) and names it (taking the name off
    /// any other window that still had it).
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

    // MARK: - Links from other apps

    /// A link another app opened (Swapdeck is the default browser): into its
    /// workspace, else as the setting says. `choose` (⌥ held) always asks.
    func routeLink(_ url: URL, choose: Bool = false) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            openNormally(url)
            return
        }
        let all = workspaces
        if all.isEmpty {
            openNormally(url)
            return
        }
        if !choose, let route = LinkRouter.route(url, workspaces: all), let workspace = workspace(route.workspaceId) {
            deliver(url, to: workspace)
            return
        }
        if !choose {
            switch data.settings.unmatchedLinks {
            case .browser:
                openNormally(url)
                return
            case .front:
                let recent = all.compactMap { workspace in workspace.lastOpenedAt.map { (workspace, $0) } }.max { $0.1 < $1.1 }?.0
                if let id = frontId ?? recent?.id, let workspace = workspace(id) {
                    deliver(url, to: workspace)
                    return
                }
            case .ask:
                break
            }
        }
        onChooseLink?(url)
    }

    /// Opens a link from another app in a workspace — or, when the workspace has no usable
    /// profile, says so and asks where to open it instead: the link is never lost.
    private func deliver(_ url: URL, to workspace: Workspace) {
        guard canOpenLinks(in: workspace) else {
            show(.error, t("error.linkNeedsProfile", ["name": workspace.name]))
            onChooseLink?(url)
            return
        }
        Task { await openLink(WorkspaceLink(title: "", url: url.absoluteString), in: workspace) }
    }

    /// The chooser's answer: a workspace (and maybe a rule to remember), or nil to open the link normally.
    func openChosen(_ url: URL, in workspaceId: String?, remember: Bool) {
        guard let workspaceId, var workspace = workspace(workspaceId) else {
            openNormally(url)
            return
        }
        if remember, let host = url.host.flatMap(LinkRouter.normalize), !workspace.linkRules.contains(host),
           workspace.linkRules.count < Limits.linkRules {
            workspace.linkRules.append(host)
            update(workspace)
            save()
        }
        deliver(url, to: workspace)
    }

    /// Opens a link in the browser as if Swapdeck weren't there (its last-used profile).
    func openNormally(_ url: URL) {
        guard !offline else { return }
        let browser = data.settings.defaultBrowser
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: browser.bundleIdentifier) else {
            show(.error, t("error.browserMissing", ["browser": browser.displayName]))
            return
        }
        NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
            guard let error else { return }
            Task { @MainActor in self?.show(.error, self?.t("error.openLink", ["detail": error.localizedDescription]) ?? "") }
        }
    }

    var isDefaultBrowser: Bool {
        guard let handler = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "https://example.com")!) else { return false }
        return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }

    /// Asks macOS to make Swapdeck the default web browser (macOS confirms with the user).
    func makeDefaultBrowser() async {
        do {
            try await NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpenURLsWithScheme: "http")
            if !isDefaultBrowser {
                try await NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpenURLsWithScheme: "https")
            }
        } catch {
            show(.error, t("settings.defaultBrowserFailed", ["detail": error.localizedDescription]))
        }
        defaultBrowserCheck += 1
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

    /// The workspaces as a file for another Mac (no sign-ins: names, looks, pages, link rules, profiles).
    func exportFile() throws -> Data {
        flushPendingWrites()
        return try DataFile.encode(DesktopData(settings: data.settings, workspaces: data.workspaces))
    }

    /// Adds the workspaces of a Swapdeck Desktop export and finds their profiles on this Mac.
    func importDesktopFile(_ file: Data) throws -> (added: Int, matched: Int, missing: Int) {
        let incoming = try DataFile.decode(file)
        reloadProfiles()
        let added = WorkspaceLogic.merge(incoming.workspaces, into: data.workspaces)
        let addedIds = Set(added.map(\.id))
        data.workspaces += added
        // The added workspaces come from another Mac: their profile folders mean nothing here.
        let result = WorkspaceLogic.rematch(data.workspaces, profiles: profiles, imported: addedIds)
        data.workspaces = result.workspaces
        save()
        return (added.count, addedIds.subtracting(result.missing).count, addedIds.intersection(result.missing).count)
    }

    /// Finds each workspace's profile again by its Google account or name (after moving Macs).
    /// Matches first, then refreshes: refreshing first would take a folder's new owner for the workspace.
    @discardableResult
    func rematchProfiles() -> Int {
        reloadProfiles()
        let result = WorkspaceLogic.rematch(data.workspaces, profiles: profiles)
        data.workspaces = result.workspaces.map { WorkspaceLogic.refreshedDetails($0, profile: profile(of: $0)) }
        save()
        return result.changed.count
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
