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

    /// The saved value of a workspace's variable ("" when there is none).
    func secretValue(_ name: String, in workspace: Workspace) -> String {
        secrets.value(workspace: workspace.id, name: name) ?? ""
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
        try? secrets.set(nil, workspace: workspace.id, name: name)
        var copy = workspace
        copy.cliVariables.removeAll { $0.name == name }
        update(copy)
    }

    /// The line that loads a workspace's variables into any terminal.
    func terminalCommand(for workspace: Workspace) -> String {
        TerminalEnv.evalLine(executable: Self.executablePath, workspaceId: workspace.id)
    }

    func copyTerminalCommand(_ workspace: Workspace) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(terminalCommand(for: workspace), forType: .string)
        show(.info, t("terminal.copied"))
    }

    /// Opens Terminal (or iTerm) with the workspace's variables, in its folder. The
    /// script Terminal runs holds no secret and removes itself; the values come
    /// straight from the Keychain through `--env`.
    func openTerminal(_ workspace: Workspace) {
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
                title: workspace.name,
                folder: workspace.terminalFolder
            )
            FileManager.default.createFile(atPath: file.path, contents: Data(script.utf8), attributes: [.posixPermissions: 0o700])
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

    /// Asks GitHub for the latest release (only when the user presses the button).
    func checkForUpdates() async {
        updateCheck = .checking
        var request = URLRequest(url: Releases.latestAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        do {
            let (body, response) = try await URLSession(configuration: .ephemeral).data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let latest = Releases.parse(body), let version = latest.desktop
            else {
                updateCheck = .failed
                return
            }
            updateCheck = Releases.compare(version, AppInfo.version) > 0 ? .available(version: version, url: latest.url) : .latest
        } catch {
            updateCheck = .failed
        }
    }
}
