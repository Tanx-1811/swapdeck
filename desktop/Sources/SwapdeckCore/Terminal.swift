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

    /// The line to paste into another terminal (VS Code, Warp…) to load a workspace's variables.
    public static func evalLine(executable: String, workspaceId: String) -> String {
        "eval \"$(\(shellQuote(executable)) --env \(shellQuote(workspaceId)))\""
    }

    /// The `.command` file Terminal runs for "Open Terminal": it removes itself,
    /// takes the variables from the app (they are never written to disk), goes
    /// to the workspace's folder, names the window and starts the user's shell.
    public static func commandFile(executable: String, workspaceId: String, title: String, folder: String) -> String {
        var lines = [
            "#!/bin/sh",
            "# Swapdeck Desktop: a terminal for one workspace. This file removes itself.",
            "rm -f -- \"$0\"",
            "rmdir -- \"$(dirname -- \"$0\")\" 2>/dev/null",
            evalLine(executable: executable, workspaceId: workspaceId) + " || exit 1",
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

/// Where a workspace's secret values live. The app uses the Keychain; tests use `MemorySecretStore`.
public protocol SecretStore: Sendable {
    func value(workspace: String, name: String) -> String?
    /// `nil` removes the value.
    func set(_ value: String?, workspace: String, name: String) throws
    func removeAll(workspace: String, names: [String]) throws
}

/// In memory only (tests and previews).
public final class MemorySecretStore: SecretStore, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()

    public init(_ values: [String: String] = [:]) {
        self.values = values
    }

    public func value(workspace: String, name: String) -> String? {
        lock.withLock { values["\(workspace)/\(name)"] }
    }

    public func set(_ value: String?, workspace: String, name: String) throws {
        lock.withLock { values["\(workspace)/\(name)"] = value }
    }

    public func removeAll(workspace: String, names: [String]) throws {
        lock.withLock { values = values.filter { !$0.key.hasPrefix("\(workspace)/") } }
    }
}

public extension TerminalEnv {
    /// What `--env <workspace>` prints: the workspace (by id, else by name) and
    /// its variables that have a value. Nil when there is no such workspace.
    static func environment(for key: String, in data: DesktopData, secrets: SecretStore) -> String? {
        let folded = WorkspaceLogic.fold(key)
        guard let workspace = data.workspaces.first(where: { $0.id == key })
            ?? data.workspaces.first(where: { WorkspaceLogic.fold($0.name) == folded })
        else { return nil }
        let values = workspace.cliVariables.compactMap { variable -> (name: String, value: String)? in
            guard let value = secrets.value(workspace: workspace.id, name: variable.name), !value.isEmpty else { return nil }
            return (variable.name, value)
        }
        return exports(values)
    }
}
