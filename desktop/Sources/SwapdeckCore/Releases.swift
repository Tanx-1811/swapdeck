import Foundation

/// "Check for updates" (Settings; only when the user asks): the recent GitHub
/// releases, read from the public API — no sign-in, nothing of the user's sent.
/// The extension and Swapdeck Desktop share the repository, and a release may
/// carry only one of them, so the newest Desktop zip among recent releases counts.
public enum Releases {
    public static let repository = "Tanx-1811/swapdeck"
    /// The latest 20 releases, newest first.
    public static let listAPI = URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=20")!
    public static let page = URL(string: "https://github.com/\(repository)/releases/latest")!

    public struct Latest: Equatable, Sendable {
        /// Swapdeck Desktop's version in the release (from its zip's name).
        public let desktop: String?
        /// The extension's version (its zip's name, else the tag).
        public let extensionVersion: String?
        /// The release page (always on github.com/Tanx-1811/swapdeck).
        public let url: URL
    }

    /// One release of GitHub's JSON, validated (it comes from the network).
    public static func parse(_ data: Data) -> Latest? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(release: root)
    }

    /// The newest Desktop version among a list of releases (drafts and pre-releases left
    /// out), with the page of the release that has it. Nil only when the list can't be
    /// read; `desktop` is nil when no release has a Desktop zip.
    public static func parseList(_ data: Data) -> Latest? {
        guard let list = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return nil }
        var desktop: (version: String, url: URL)?
        var extensionVersion: String?
        for item in list {
            guard let release = item as? [String: Any],
                  release["draft"] as? Bool != true, release["prerelease"] as? Bool != true,
                  let latest = parse(release: release)
            else { continue }
            if let version = latest.desktop, desktop.map({ compare(version, $0.version) > 0 }) ?? true {
                desktop = (version, latest.url)
            }
            if let version = latest.extensionVersion, extensionVersion.map({ compare(version, $0) > 0 }) ?? true {
                extensionVersion = version
            }
        }
        return Latest(desktop: desktop?.version, extensionVersion: extensionVersion, url: desktop?.url ?? page)
    }

    private static func parse(release root: [String: Any]) -> Latest? {
        let tag = root["tag_name"] as? String ?? ""
        var extensionVersion = isVersion(tag) ? String(tag.drop { $0 == "v" }) : nil
        var desktop: String?
        for asset in root["assets"] as? [Any] ?? [] {
            guard let name = (asset as? [String: Any])?["name"] as? String else { continue }
            if let version = version(in: name, prefix: "swapdeck-desktop-") {
                if desktop.map({ compare(version, $0) > 0 }) ?? true { desktop = version }
            } else if let version = version(in: name, prefix: "swapdeck-") {
                extensionVersion = version
            }
        }
        guard desktop != nil || extensionVersion != nil else { return nil }
        let link = (root["html_url"] as? String).flatMap(URL.init(string:))
        let url = link.flatMap { $0.absoluteString.hasPrefix("https://github.com/\(repository)/releases/") ? $0 : nil } ?? page
        return Latest(desktop: desktop, extensionVersion: extensionVersion, url: url)
    }

    /// Numeric comparison of "1.10.0"-style versions (unreadable ones count as 0.0.0).
    public static func compare(_ a: String, _ b: String) -> Int {
        let x = parts(a), y = parts(b)
        for index in 0..<3 where x[index] != y[index] { return x[index] - y[index] }
        return 0
    }

    private static func parts(_ value: String) -> [Int] {
        guard isVersion(value) else { return [0, 0, 0] }
        return value.drop { $0 == "v" }.split(separator: ".").map { Int($0) ?? 0 }
    }

    private static func isVersion(_ value: String) -> Bool {
        value.range(of: #"^v?[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$"#, options: .regularExpression) != nil
    }

    private static func version(in name: String, prefix: String) -> String? {
        guard name.hasPrefix(prefix), name.hasSuffix(".zip") else { return nil }
        let version = String(name.dropFirst(prefix.count).dropLast(4))
        return isVersion(version) && !version.hasPrefix("v") ? version : nil
    }
}
