import Foundation

/// An environment variable a workspace's terminal gets, e.g. `SUPABASE_ACCESS_TOKEN`.
/// Only the name is kept with the workspace; the value lives in the Keychain
/// (`SecretStore`), never in the data file or an exported file.
public struct CLIVariable: Encodable, Hashable, Sendable, Identifiable {
    public var name: String
    /// A token (shown as dots), or a plain value such as a profile name.
    public var secret: Bool

    public var id: String { name }

    public init(name: String, secret: Bool = true) {
        self.name = name
        self.secret = secret
    }
}

/// A command-line tool whose account a workspace can choose through one variable.
public struct CLIPreset: Sendable, Identifiable {
    public let id: String
    /// The tool, as people call it ("Supabase CLI").
    public let tool: String
    public let variable: String
    public let secret: Bool
    /// Where to make a token (or what the value is).
    public let source: String
}

public enum CLIPresets {
    /// Tools that take their account from one variable, so each workspace can use its own.
    public static let all: [CLIPreset] = [
        CLIPreset(id: "supabase", tool: "Supabase CLI", variable: "SUPABASE_ACCESS_TOKEN", secret: true,
                  source: "supabase.com/dashboard/account/tokens"),
        CLIPreset(id: "vercel", tool: "Vercel CLI", variable: "VERCEL_TOKEN", secret: true,
                  source: "vercel.com/account/tokens"),
        CLIPreset(id: "github", tool: "GitHub CLI", variable: "GH_TOKEN", secret: true,
                  source: "github.com/settings/tokens"),
        CLIPreset(id: "netlify", tool: "Netlify CLI", variable: "NETLIFY_AUTH_TOKEN", secret: true,
                  source: "app.netlify.com/user/applications"),
        CLIPreset(id: "cloudflare", tool: "Cloudflare Wrangler", variable: "CLOUDFLARE_API_TOKEN", secret: true,
                  source: "dash.cloudflare.com/profile/api-tokens"),
        CLIPreset(id: "fly", tool: "Fly.io", variable: "FLY_API_TOKEN", secret: true,
                  source: "fly.io/user/personal_access_tokens"),
        CLIPreset(id: "railway", tool: "Railway CLI", variable: "RAILWAY_API_TOKEN", secret: true,
                  source: "railway.com/account/tokens"),
        CLIPreset(id: "heroku", tool: "Heroku CLI", variable: "HEROKU_API_KEY", secret: true,
                  source: "dashboard.heroku.com/account/applications"),
        CLIPreset(id: "digitalocean", tool: "DigitalOcean doctl", variable: "DIGITALOCEAN_ACCESS_TOKEN", secret: true,
                  source: "cloud.digitalocean.com/account/api/tokens"),
        CLIPreset(id: "aws", tool: "AWS CLI", variable: "AWS_PROFILE", secret: false,
                  source: "~/.aws/config"),
        CLIPreset(id: "gcloud", tool: "Google Cloud CLI", variable: "CLOUDSDK_ACTIVE_CONFIG_NAME", secret: false,
                  source: "gcloud config configurations list"),
    ]

    public static func preset(for variable: String) -> CLIPreset? {
        all.first { $0.variable == variable }
    }
}

/// The terminal of a workspace: its variables exported, in its folder.
public enum TerminalEnv {
    public static let maxVariables = 30
    public static let maxValueLength = 8192

    /// Variables that would let a value take over the shell, or that the shell owns.
    private static let reserved: Set<String> = [
        "PATH", "HOME", "SHELL", "USER", "LOGNAME", "IFS", "PS1", "PS2", "PS3", "PS4", "PROMPT_COMMAND",
        "ENV", "BASH_ENV", "ZDOTDIR", "TMPDIR", "PWD", "OLDPWD", "SHLVL", "TERM", "CDPATH", "FPATH", "MAIL",
    ]

    /// A name a shell can export and that can't change how the shell or programs run.
    public static func isAllowedName(_ name: String) -> Bool {
        guard (1...64).contains(name.count),
              name.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_").contains($0) }),
              let first = name.unicodeScalars.first, !CharacterSet.decimalDigits.contains(first)
        else { return false }
        let upper = name.uppercased()
        if reserved.contains(upper) { return false }
        return !(upper.hasPrefix("DYLD_") || upper.hasPrefix("LD_") || upper.hasPrefix("BASH_FUNC_"))
    }

    /// A value a variable may hold: no NUL byte, not huge.
    public static func isAllowedValue(_ value: String) -> Bool {
        !value.contains("\0") && value.utf8.count <= maxValueLength
    }

    /// Single-quoted for a POSIX shell: nothing inside can run.
    public static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// `export NAME='value'` lines, what `--env <workspace>` prints for `eval`.
    /// Names that aren't allowed and values that aren't are left out.
    public static func exports(_ values: [(name: String, value: String)]) -> String {
        values
            .filter { isAllowedName($0.name) && isAllowedValue($0.value) }
            .map { "export \($0.name)=\(shellQuote($0.value))\n" }
            .joined()
    }

    /// The line to paste into another terminal (VS Code, Warp…, bash or zsh) to load a
    /// workspace's variables. `--env` asks for Touch ID or the Mac's password each time;
    /// when it fails, the shell says so (`failure`) instead of going on without them.
    public static func evalLine(executable: String, workspaceId: String, failure: String) -> String {
        "if __swapdeck_env=$(\(shellQuote(executable)) --env \(shellQuote(workspaceId))); "
            + "then eval \"$__swapdeck_env\"; else echo \(shellQuote(failure)) >&2; fi; unset __swapdeck_env"
    }

    /// The `.command` file Terminal runs for "Open Terminal": it removes itself,
    /// takes the variables from the app with a single-use `ticket` (they are never
    /// written to disk), goes to the workspace's folder, names the window and starts
    /// the user's shell. If the variables can't be loaded it stops with `failure`:
    /// a window named after the workspace must never run its tools as someone else.
    public static func commandFile(
        executable: String,
        workspaceId: String,
        ticket: String?,
        title: String,
        folder: String,
        failure: String
    ) -> String {
        let ticketArgument = ticket.map { " --ticket \(shellQuote($0))" } ?? ""
        var lines = [
            "#!/bin/sh",
            "# Swapdeck Desktop: a terminal for one workspace. This file removes itself.",
            "rm -f -- \"$0\"",
            "rmdir -- \"$(dirname -- \"$0\")\" 2>/dev/null",
            "vars=$(\(shellQuote(executable)) --env \(shellQuote(workspaceId))\(ticketArgument)) || "
                + "{ echo \(shellQuote(failure)) >&2; exit 1; }",
            "eval \"$vars\"",
            "unset vars",
        ]
        if !folder.isEmpty { lines.append("cd -- \(shellQuote(folder)) 2>/dev/null") }
        let name = title.filter { !$0.isNewline && $0.asciiValue.map { $0 >= 0x20 && $0 != 0x7f } ?? true }
        lines.append("printf '\\033]0;%s\\007' \(shellQuote(String(name.prefix(80))))")
        lines.append("exec \"${SHELL:-/bin/zsh}\" -l")
        return lines.joined(separator: "\n") + "\n"
    }

    /// A folder for a workspace's terminal: absolute (a leading "~/" is expanded), without the trailing slash.
    public static func normalizedFolder(_ input: String, home: String = NSHomeDirectory()) -> String? {
        var path = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty { return "" }
        if path == "~" { path = home } else if path.hasPrefix("~/") { path = home + path.dropFirst(1) }
        guard path.hasPrefix("/"), path.count <= 1024, !path.contains("\0") else { return nil }
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        return path
    }
}

/// Where a workspace's secret values live, one per workspace and variable ("<workspace>/<NAME>").
/// The app uses the Keychain; tests and previews use `MemorySecretStore`, which behaves the same.
public protocol SecretStore: Sendable {
    /// The value, or nil when there is none. Throws when it exists but can't be read
    /// (the Keychain refused): never mistake that for "no value".
    func value(workspace: String, name: String) throws -> String?
    /// `nil` (or "") removes the value.
    func set(_ value: String?, workspace: String, name: String) throws
    /// Removes every value of a workspace, whatever its variables are called now.
    func removeAll(workspace: String) throws
    /// The workspaces that have at least one value.
    func workspaceIds() throws -> Set<String>
}

public extension SecretStore {
    /// Removes the values of workspaces that aren't in `ids` any more; returns those workspaces.
    @discardableResult
    func sweep(keeping ids: Set<String>) throws -> Set<String> {
        let gone = try workspaceIds().subtracting(ids)
        for id in gone { try removeAll(workspace: id) }
        return gone
    }
}

/// In memory only (tests and previews). `unreadable` names ("<workspace>/<NAME>") fail to
/// read, like a Keychain item macOS won't hand over.
public final class MemorySecretStore: SecretStore, @unchecked Sendable {
    public struct Unreadable: Error, Equatable {}

    private var values: [String: String] = [:]
    private var unreadable: Set<String>
    private let lock = NSLock()

    public init(_ values: [String: String] = [:], unreadable: Set<String> = []) {
        self.values = values
        self.unreadable = unreadable
    }

    public func value(workspace: String, name: String) throws -> String? {
        let key = "\(workspace)/\(name)"
        return try lock.withLock {
            if unreadable.contains(key) { throw Unreadable() }
            return values[key]
        }
    }

    public func set(_ value: String?, workspace: String, name: String) throws {
        lock.withLock { values["\(workspace)/\(name)"] = (value?.isEmpty ?? true) ? nil : value }
    }

    public func removeAll(workspace: String) throws {
        lock.withLock { values = values.filter { !$0.key.hasPrefix("\(workspace)/") } }
    }

    public func workspaceIds() throws -> Set<String> {
        lock.withLock { Set(values.keys.compactMap { $0.split(separator: "/", maxSplits: 1).first.map(String.init) }) }
    }
}

/// A variable whose value exists but couldn't be read.
public struct UnreadableVariable: Error {
    public let name: String
    public let underlying: any Error
}

public extension TerminalEnv {
    /// The workspace `--env <key>` means: by id, else by name (without accents or case).
    static func workspace(for key: String, in data: DesktopData) -> Workspace? {
        let folded = WorkspaceLogic.fold(key)
        return data.workspaces.first(where: { $0.id == key })
            ?? data.workspaces.first(where: { WorkspaceLogic.fold($0.name) == folded })
    }

    /// What `--env` prints for a workspace: its variables that have a value. Throws
    /// `UnreadableVariable` when one can't be read, so nothing half-loaded is printed.
    static func environment(of workspace: Workspace, secrets: SecretStore) throws -> String {
        let values = try workspace.cliVariables.compactMap { variable -> (name: String, value: String)? in
            let value: String?
            do {
                value = try secrets.value(workspace: workspace.id, name: variable.name)
            } catch {
                throw UnreadableVariable(name: variable.name, underlying: error)
            }
            guard let value, !value.isEmpty else { return nil }
            return (variable.name, value)
        }
        return exports(values)
    }

    /// `environment(of:)` for the workspace `key` means; nil when there is no such workspace.
    static func environment(for key: String, in data: DesktopData, secrets: SecretStore) throws -> String? {
        guard let workspace = workspace(for: key, in: data) else { return nil }
        return try environment(of: workspace, secrets: secrets)
    }
}
