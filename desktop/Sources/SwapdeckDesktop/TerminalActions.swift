import AppKit
import SwapdeckCore

/// The result of "Check for updates".
enum UpdateCheck: Equatable {
    case idle, checking, latest, failed
    case available(version: String, url: URL)
}

/// A workspace's terminal: its variables (values in the Keychain), its folder,
/// "Open Terminal" and the command for other terminals. See `TerminalEnv`.
extension AppModel {
    /// This app's own executable: `--env` runs it to read the Keychain.
    static var executablePath: String { Bundle.main.executableURL?.path ?? CommandLine.arguments[0] }

    /// The value of a workspace's variable ("" when there is none), including one typed but
    /// not written yet. Nil when the Keychain wouldn't give it (the user is told).
    func secretValue(_ name: String, in workspace: Workspace) -> String? {
        if let staged = stagedSecrets[StagedSecret(workspace: workspace.id, name: name)] { return staged }
        do {
            return try secrets.value(workspace: workspace.id, name: name) ?? ""
        } catch {
            show(.error, t("terminal.keychainReadFailed", ["name": name]))
            return nil
        }
    }

    /// Keeps a typed value and writes it to the Keychain shortly after the last keystroke.
    func stageSecret(_ value: String, name: String, in workspace: Workspace) {
        stagedSecrets[StagedSecret(workspace: workspace.id, name: name)] = value
        secretTask?.cancel()
        secretTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            self?.flushSecrets()
        }
    }

    /// Writes the typed values that are still waiting.
    func flushSecrets() {
        secretTask?.cancel()
        secretTask = nil
        let staged = stagedSecrets
        stagedSecrets = [:]
        for (key, value) in staged {
            guard let workspace = workspace(key.workspace), workspace.cliVariables.contains(where: { $0.name == key.name }) else {
                continue
            }
            setSecret(value, name: key.name, in: workspace)
        }
    }

    func discardStagedSecrets(of workspaceId: String, name: String? = nil) {
        stagedSecrets = stagedSecrets.filter { key, _ in key.workspace != workspaceId || (name != nil && key.name != name) }
    }

    func setSecret(_ value: String, name: String, in workspace: Workspace) {
        guard TerminalEnv.isAllowedValue(value) else {
            show(.error, t("terminal.valueTooLong"))
            return
        }
        do {
            try secrets.set(value.isEmpty ? nil : value, workspace: workspace.id, name: name)
        } catch {
            show(.error, t("terminal.keychainFailed"))
        }
    }

    /// Adds a variable (false when the name isn't allowed, is taken or there are too many).
    @discardableResult
    func addVariable(_ variable: CLIVariable, to workspace: Workspace) -> Bool {
        guard TerminalEnv.isAllowedName(variable.name),
              !workspace.cliVariables.contains(where: { $0.name == variable.name }),
              workspace.cliVariables.count < TerminalEnv.maxVariables
        else { return false }
        var copy = workspace
        copy.cliVariables.append(variable)
        update(copy)
        return true
    }

    func removeVariable(_ name: String, from workspace: Workspace) {
        discardStagedSecrets(of: workspace.id, name: name)
        do {
            try secrets.set(nil, workspace: workspace.id, name: name)
        } catch {
            show(.error, t("terminal.removeFailed", ["name": workspace.name, "detail": "\(error)"]))
        }
        var copy = workspace
        copy.cliVariables.removeAll { $0.name == name }
        update(copy)
    }

    /// The line that loads a workspace's variables into any terminal (asks for Touch ID or the password).
    func terminalCommand(for workspace: Workspace) -> String {
        TerminalEnv.evalLine(
            executable: Self.executablePath,
            workspaceId: workspace.id,
            failure: t("terminal.notLoaded", ["name": workspace.name])
        )
    }

    func copyTerminalCommand(_ workspace: Workspace) {
        flushPendingWrites()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(terminalCommand(for: workspace), forType: .string)
        show(.info, t("terminal.copied"))
    }

    /// Opens Terminal (or iTerm) with the workspace's variables, in its folder. The
    /// script Terminal runs holds no secret and removes itself; the values come
    /// straight from the Keychain through `--env`, with a single-use ticket (without
    /// one, `--env` asks for Touch ID or the password).
    func openTerminal(_ workspace: Workspace) {
        flushPendingWrites()
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("swapdeck-terminal-\(UUID().uuidString)", isDirectory: true)
        let file = folder.appendingPathComponent("terminal.command")
        do {
            try FileManager.default.createDirectory(
                at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]
            )
            let script = TerminalEnv.commandFile(
                executable: Self.executablePath,
                workspaceId: workspace.id,
                ticket: workspace.cliVariables.isEmpty ? nil : try? tickets.issue(workspaceId: workspace.id),
                title: workspace.name,
                folder: workspace.terminalFolder,
                failure: t("terminal.notLoaded", ["name": workspace.name])
            )
            guard FileManager.default.createFile(atPath: file.path, contents: Data(script.utf8), attributes: [.posixPermissions: 0o700])
            else { throw CocoaError(.fileWriteUnknown) }
        } catch {
            show(.error, t("terminal.openFailed"))
            return
        }
        let preferred = data.settings.terminalApp
        let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: preferred.bundleIdentifier)
            ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: TerminalApp.terminal.bundleIdentifier)
        guard let app else {
            show(.error, t("terminal.openFailed"))
            return
        }
        NSWorkspace.shared.open([file], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
            guard error != nil else { return }
            Task { @MainActor in
                guard let self else { return }
                self.show(.error, self.t("terminal.openFailed"))
            }
        }
    }

    /// Terminal apps installed here (Terminal always).
    var installedTerminals: [TerminalApp] {
        TerminalApp.allCases.filter { $0 == .terminal || NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.bundleIdentifier) != nil }
    }

    /// Asks GitHub for the recent releases (only when the user presses the button) and
    /// offers the newest Swapdeck Desktop among them.
    func checkForUpdates() async {
        updateCheck = .checking
        var request = URLRequest(url: Releases.listAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        do {
            let (body, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let latest = Releases.parseList(body) else {
                updateCheck = .failed
                return
            }
            if let version = latest.desktop, Releases.compare(version, AppInfo.version) > 0 {
                updateCheck = .available(version: version, url: latest.url)
            } else {
                // No newer Desktop among the recent releases (some only carry the extension).
                updateCheck = .latest
            }
        } catch {
            updateCheck = .failed
        }
    }
}
