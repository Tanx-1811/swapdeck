import Foundation

/// Where a link that matches no workspace goes.
public enum UnmatchedLinks: String, Codable, CaseIterable, Sendable {
    /// Show the chooser.
    case ask
    /// The workspace whose window was used last.
    case front
    /// The browser, as if Swapdeck weren't there (its last-used profile).
    case browser
}

/// The workspace a link belongs to, and why.
public struct LinkRoute: Equatable, Sendable {
    public let workspaceId: String
    /// The rule that matched ("acme.example", "supabase.com/dashboard/project/acme").
    public let rule: String
    /// The rule was added by hand (else it comes from the workspace's pages).
    public let explicit: Bool
}

/// Sends links opened from other apps (Slack, Mail, …) to the right workspace.
/// A rule is a host, optionally with a path prefix: "acme.example" also covers
/// "app.acme.example"; "supabase.com/dashboard/project/acme" only that project.
/// The most specific rule wins; rules added by hand beat those taken from pages.
public enum LinkRouter {
    public static func route(_ url: URL, workspaces: [Workspace]) -> LinkRoute? {
        guard let target = Target(url) else { return nil }
        var best: (score: Int, route: LinkRoute)?
        for workspace in workspaces {
            let candidates = workspace.linkRules.map { ($0, true) }
                + implicitRules(for: workspace, among: workspaces).map { ($0, false) }
            for (rule, explicit) in candidates {
                guard let score = specificity(of: rule, for: target) else { continue }
                let total = score * 2 + (explicit ? 1 : 0)
                if best == nil || total > best!.score {
                    best = (total, LinkRoute(workspaceId: workspace.id, rule: rule, explicit: explicit))
                }
            }
        }
        return best?.route
    }

    /// Rules taken from a workspace's pages: each page's host and path, and the
    /// host alone when no other workspace has a page there.
    public static func implicitRules(for workspace: Workspace, among workspaces: [Workspace]) -> [String] {
        var rules: [String] = []
        let otherHosts = Set(workspaces.filter { $0.id != workspace.id }.flatMap { $0.openableLinks.compactMap { Target(urlString: $0.url)?.host } })
        for link in workspace.openableLinks {
            guard let target = Target(urlString: link.url) else { continue }
            if target.path.count > 1 { rules.append(target.host + target.path) }
            if !otherHosts.contains(target.host) { rules.append(target.host) }
        }
        var seen = Set<String>()
        return rules.filter { seen.insert($0).inserted }
    }

    /// "https://www.Acme.example/Path/" → "acme.example/Path"; nil when it isn't a host.
    public static func normalize(_ text: String) -> String? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = value.range(of: "://") { value = String(value[range.upperBound...]) }
        if value.hasPrefix("*.") { value.removeFirst(2) }
        let parts = value.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        var host = String(parts.first ?? "").lowercased()
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        if let colon = host.firstIndex(of: ":") { host = String(host[..<colon]) }
        if host.hasPrefix("www.") { host.removeFirst(4) }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.-")
        guard !host.isEmpty, host.count <= 253, host.contains("."), !host.hasPrefix("."), !host.hasSuffix("."),
              host.unicodeScalars.allSatisfy(allowed.contains)
        else { return nil }
        var path = parts.count > 1 ? "/" + parts[1] : ""
        if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<cut]) }
        while path.hasSuffix("/") { path.removeLast() }
        return String((host + path).prefix(300))
    }

    /// How well a rule matches (higher is more specific), or nil.
    static func specificity(of rule: String, for target: Target) -> Int? {
        guard let normalized = normalize(rule) else { return nil }
        let slash = normalized.firstIndex(of: "/")
        let host = slash.map { String(normalized[..<$0]) } ?? normalized
        let path = slash.map { String(normalized[$0...]) } ?? ""
        let exactHost = target.host == host
        guard exactHost || target.host.hasSuffix("." + host) else { return nil }
        if !path.isEmpty {
            guard target.path == path || target.path.hasPrefix(path + "/") else { return nil }
        }
        let labels = host.split(separator: ".").count
        return labels * 100 + (exactHost ? 50 : 0) + path.count * 1000
    }

    /// A link's host (without "www.") and path (without a trailing slash).
    struct Target {
        let host: String
        let path: String

        init?(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  var host = url.host?.lowercased(), !host.isEmpty
            else { return nil }
            if host.hasPrefix("www.") { host.removeFirst(4) }
            var path = url.path
            while path.hasSuffix("/") { path.removeLast() }
            self.host = host
            self.path = path.isEmpty ? "/" : path
        }

        init?(urlString: String) {
            guard let url = URL(string: urlString) else { return nil }
            self.init(url)
        }
    }
}

/// The first preferences of a profile Swapdeck creates for a workspace: Chrome
/// adopts its name, and themes the profile's windows from its color.
public enum ProfileSeed {
    public static func preferences(name: String, color: String) -> Data {
        var browser: [String: Any] = [:]
        if Palette.isHex(color), let rgb = UInt32(color.dropFirst(), radix: 16) {
            // A signed ARGB integer, as Chrome stores colors; variant 1 is Chrome's "tonal spot".
            let argb = Int32(bitPattern: 0xff00_0000 | rgb)
            browser["theme"] = ["user_color": argb, "color_variant": 1]
        }
        let name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        let root: [String: Any] = ["profile": ["name": name, "using_default_name": false], "browser": browser]
        return (try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
