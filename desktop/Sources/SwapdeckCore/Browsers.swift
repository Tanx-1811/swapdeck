import Foundation

/// Chromium browsers whose profiles Swapdeck Desktop can open. All of them take
/// `--profile-directory` and answer AppleScript like Chrome.
public enum BrowserKind: String, Codable, CaseIterable, Sendable {
    case chrome, chromeBeta, chromeDev, chromeCanary, brave, edge

    public var displayName: String {
        switch self {
        case .chrome: "Google Chrome"
        case .chromeBeta: "Chrome Beta"
        case .chromeDev: "Chrome Dev"
        case .chromeCanary: "Chrome Canary"
        case .brave: "Brave"
        case .edge: "Microsoft Edge"
        }
    }

    public var bundleIdentifier: String {
        switch self {
        case .chrome: "com.google.Chrome"
        case .chromeBeta: "com.google.Chrome.beta"
        case .chromeDev: "com.google.Chrome.dev"
        case .chromeCanary: "com.google.Chrome.canary"
        case .brave: "com.brave.Browser"
        case .edge: "com.microsoft.edgemac"
        }
    }

    /// The browser's data folder, inside ~/Library/Application Support.
    public var dataFolder: String {
        switch self {
        case .chrome: "Google/Chrome"
        case .chromeBeta: "Google/Chrome Beta"
        case .chromeDev: "Google/Chrome Dev"
        case .chromeCanary: "Google/Chrome Canary"
        case .brave: "BraveSoftware/Brave-Browser"
        case .edge: "Microsoft Edge"
        }
    }

    public func dataDirectory(applicationSupport: URL) -> URL {
        applicationSupport.appendingPathComponent(dataFolder, isDirectory: true)
    }

    public func localStateURL(applicationSupport: URL) -> URL {
        dataDirectory(applicationSupport: applicationSupport).appendingPathComponent("Local State")
    }
}

/// One profile of a browser, as listed in its "Local State" file.
public struct BrowserProfile: Identifiable, Hashable, Sendable {
    public var id: String { directory }
    /// "Default", "Profile 1", …
    public let directory: String
    public let name: String
    /// The Google account signed in to the profile, if any.
    public let email: String?
    /// "#rrggbb" from the profile's theme or avatar.
    public let color: String?
    public let lastActive: Date?

    public init(directory: String, name: String, email: String? = nil, color: String? = nil, lastActive: Date? = nil) {
        self.directory = directory
        self.name = name
        self.email = email
        self.color = color
        self.lastActive = lastActive
    }
}

public enum ProfileReader {
    public enum Failure: Error, Equatable {
        case unreadable
    }

    /// The profiles in a browser's "Local State" JSON, in the browser's own order.
    public static func profiles(localState data: Data) throws -> [BrowserProfile] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let profile = root["profile"] as? [String: Any]
        else { throw Failure.unreadable }
        let cache = profile["info_cache"] as? [String: Any] ?? [:]
        var profiles: [BrowserProfile] = []
        for (directory, raw) in cache {
            guard let info = raw as? [String: Any], isProfileDirectory(directory) else { continue }
            if (info["is_ephemeral"] as? Bool) == true { continue }
            let name = (info["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let email = (info["user_name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let color = (info["profile_highlight_color"] as? NSNumber ?? info["default_avatar_fill_color"] as? NSNumber)
                .map { Palette.hex(fromARGB: $0.int64Value) }
            let active = (info["active_time"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) }
            profiles.append(BrowserProfile(
                directory: directory,
                name: (name?.isEmpty == false ? name : nil) ?? directory,
                email: email,
                color: color,
                lastActive: active
            ))
        }
        let order = (profile["profiles_order"] as? [String]) ?? []
        return profiles.sorted { a, b in
            let (ia, ib) = (order.firstIndex(of: a.directory) ?? Int.max, order.firstIndex(of: b.directory) ?? Int.max)
            if ia != ib { return ia < ib }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }

    /// "Default" or "Profile N" (also any plain folder name a browser created): never a path.
    public static func isProfileDirectory(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 64 && !name.contains("/") && !name.contains("\\")
            && !name.hasPrefix(".") && !name.hasPrefix("-") && !name.contains("\0")
    }

    /// The first "Profile N" folder name that is free.
    public static func newDirectoryName(existing: Set<String>) -> String {
        var number = 1
        while existing.contains("Profile \(number)") { number += 1 }
        return "Profile \(number)"
    }
}
