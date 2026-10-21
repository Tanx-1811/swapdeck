import Foundation

/// A process to run: the executable and its arguments, kept apart (no shell).
public struct LaunchCommand: Equatable, Sendable {
    public let executable: String
    public let arguments: [String]
}

public enum Launcher {
    /// Opens a window of `profileDirectory` in `browser`. `open -n` starts a
    /// second browser process that hands the request to the running one (or
    /// starts the browser); only validated web pages are passed, so nothing can
    /// smuggle in a command-line flag.
    public static func openProfile(
        _ browser: BrowserKind,
        profileDirectory: String,
        urls: [String] = [],
        newWindow: Bool = true
    ) -> LaunchCommand? {
        guard ProfileReader.isProfileDirectory(profileDirectory) else { return nil }
        var arguments = ["-n", "-b", browser.bundleIdentifier, "--args", "--profile-directory=\(profileDirectory)"]
        if newWindow { arguments.append("--new-window") }
        arguments += urls.filter(Links.isOpenable)
        return LaunchCommand(executable: "/usr/bin/open", arguments: arguments)
    }
}

/// A browser window as AppleScript sees it.
public struct BrowserWindow: Equatable, Sendable {
    public let id: String
    /// The name Swapdeck (or the user) gave the window; "" when it has none.
    public let givenName: String
    public let minimized: Bool
    public let incognito: Bool
}

/// AppleScript for Chromium browsers: list, name and bring forward windows.
/// Scripts address the browser by bundle id and are only run while it runs
/// (`tell` would otherwise launch it).
public enum BrowserScript {
    /// Windows front to back, one per line: id, given name, minimized, mode.
    public static func listWindows(_ browser: BrowserKind) -> String {
        """
        tell application id "\(browser.bundleIdentifier)"
            set output to ""
            repeat with w in windows
                try
                    set n to given name of w
                    if n is missing value then set n to ""
                    set output to output & (id of w as text) & tab & n & tab & (minimized of w as text) & tab & (mode of w as text) & linefeed
                end try
            end repeat
            return output
        end tell
        """
    }

    public static func parseWindows(_ output: String) -> [BrowserWindow] {
        output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
            guard fields.count >= 4, !fields[0].isEmpty else { return nil }
            let mode = fields[fields.count - 1]
            let minimized = fields[fields.count - 2] == "true"
            let name = fields[1..<(fields.count - 2)].joined(separator: "\t")
            return BrowserWindow(id: fields[0], givenName: name, minimized: minimized, incognito: mode == "incognito")
        }
    }

    /// Un-minimizes the window, puts it in front and activates the browser.
    public static func focusWindow(_ browser: BrowserKind, id: String) -> String {
        """
        tell application id "\(browser.bundleIdentifier)"
            repeat with w in windows
                if (id of w as text) is \(literal(id)) then
                    if minimized of w then set minimized of w to false
                    set index of w to 1
                    activate
                    return "ok"
                end if
            end repeat
            return "missing"
        end tell
        """
    }

    /// Names a window (shown in Mission Control and the Window menu instead of the page title).
    public static func nameWindow(_ browser: BrowserKind, id: String, name: String) -> String {
        """
        tell application id "\(browser.bundleIdentifier)"
            repeat with w in windows
                if (id of w as text) is \(literal(id)) then
                    set given name of w to \(literal(name))
                    return "ok"
                end if
            end repeat
            return "missing"
        end tell
        """
    }

    /// The active tab's address of every window, one per line: id, URL (to find
    /// the window a launch just opened when several appeared at once).
    public static func listActiveURLs(_ browser: BrowserKind) -> String {
        """
        tell application id "\(browser.bundleIdentifier)"
            set output to ""
            repeat with w in windows
                try
                    set output to output & (id of w as text) & tab & (URL of active tab of w) & linefeed
                end try
            end repeat
            return output
        end tell
        """
    }

    public static func parseActiveURLs(_ output: String) -> [String: String] {
        var result: [String: String] = [:]
        for line in output.split(whereSeparator: \.isNewline) {
            let fields = line.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            if fields.count == 2, !fields[0].isEmpty { result[fields[0]] = fields[1] }
        }
        return result
    }

    /// An AppleScript string literal: quotes and backslashes escaped, line breaks spelled out.
    public static func literal(_ text: String) -> String {
        var escaped = ""
        for char in text {
            switch char {
            case "\\": escaped += "\\\\"
            case "\"": escaped += "\\\""
            case "\n", "\r", "\r\n": escaped += " "
            case "\t": escaped += " "
            default: escaped.append(char)
            }
        }
        return "\"\(escaped)\""
    }

    /// osascript's message when the user hasn't allowed controlling the browser.
    public static func isPermissionDenied(_ message: String) -> Bool {
        message.contains("-1743") || message.localizedCaseInsensitiveContains("not authorized")
    }
}
