import Foundation

/// "Check for updates" (Settings; only when the user asks): the latest GitHub
/// release, read from the public API — no sign-in, nothing of the user's sent.
public enum Releases {
    public static let repository = "Tanx-1811/swapdeck"
    public static let latestAPI = URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!
    public static let page = URL(string: "https://github.com/\(repository)/releases/latest")!

    public struct Latest: Equatable, Sendable {
        /// Swapdeck Desktop's version in the release (from its zip's name).
        public let desktop: String?
        /// The extension's version (its zip's name, else the tag).
        public let extensionVersion: String?
        /// The release page (always on github.com/Tanx-1811/swapdeck).
        public let url: URL
    }

    /// The parts of GitHub's release JSON that matter, validated (it comes from the network).
    public static func parse(_ data: Data) -> Latest? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let tag = root["tag_name"] as? String ?? ""
        var extensionVersion = isVersion(tag) ? String(tag.drop { $0 == "v" }) : nil
        var desktop: String?
        for asset in root["assets"] as? [Any] ?? [] {
            guard let name = (asset as? [String: Any])?["name"] as? String else { continue }
            if let version = version(in: name, prefix: "swapdeck-desktop-") {
                desktop = version
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
        value.range(of: #"^v?\d{1,4}\.\d{1,4}\.\d{1,4}$"#, options: .regularExpression) != nil
    }

    private static func version(in name: String, prefix: String) -> String? {
        guard name.hasPrefix(prefix), name.hasSuffix(".zip") else { return nil }
        let version = String(name.dropFirst(prefix.count).dropLast(4))
        return isVersion(version) && !version.hasPrefix("v") ? version : nil
    }
}
