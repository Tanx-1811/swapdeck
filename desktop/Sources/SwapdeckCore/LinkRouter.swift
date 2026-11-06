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
/// The same rules as the extension's `src/core/links.ts`: the most specific rule
/// wins (a rule added by hand beats one taken from a page by a hair), and when
/// several workspaces share the best one nobody wins — the link is "unmatched".
public enum LinkRouter {
    public static func route(_ url: URL, workspaces: [Workspace]) -> LinkRoute? {
        guard let target = Target(url) else { return nil }
        var best: (score: Int, route: LinkRoute, owners: Set<String>)?
        for workspace in workspaces {
            let candidates = workspace.linkRules.map { ($0, true) } + implicitRules(for: workspace).map { ($0, false) }
            for (rule, explicit) in candidates {
                guard let score = specificity(of: rule, for: target) else { continue }
                let total = score * 2 + (explicit ? 1 : 0)
                if let current = best, total < current.score { continue }
                if let current = best, total == current.score {
                    best = (total, current.route, current.owners.union([workspace.id]))
                } else {
                    best = (total, LinkRoute(workspaceId: workspace.id, rule: rule, explicit: explicit), [workspace.id])
                }
            }
        }
        guard let best, best.owners.count == 1 else { return nil }
        return best.route
    }

    /// Rules taken from a workspace's pages: each page's host and path. Like the
    /// extension's pinned pages, a page covers its own address and what is under
    /// it — never its whole site (a pinned GitHub repo doesn't make every GitHub
    /// link this workspace's), and a site's home page covers nothing.
    public static func implicitRules(for workspace: Workspace) -> [String] {
        var seen = Set<String>()
        return workspace.openableLinks.compactMap { link -> String? in
            guard let target = Target(urlString: link.url), target.path.count > 1 else { return nil }
            return target.host + target.path
        }.filter { seen.insert($0).inserted }
    }

    /// "https://www.Acme.example/Path/" → "acme.example/Path"; nil when it isn't a host.
    /// The path is kept percent-encoded, as browsers show it in a link.
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
        // "dự-án" or "a b" typed in a rule are encoded like the address of a link.
        path = path.addingPercentEncoding(withAllowedCharacters: pathCharacters) ?? path
        return String((host + path).prefix(300))
    }

    /// Characters a path keeps as they are ("%" too: what is already encoded stays so).
    private static let pathCharacters = CharacterSet.urlPathAllowed.union(CharacterSet(charactersIn: "%"))

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

    /// A path without "." and ".." segments ("/a/../b" → "/b"), as browsers resolve it.
    static func removingDotSegments(_ path: String) -> String {
        func isDot(_ segment: Substring) -> Bool { segment == "." || segment.lowercased() == "%2e" }
        func isDotDot(_ segment: Substring) -> Bool { ["..", ".%2e", "%2e.", "%2e%2e"].contains(segment.lowercased()) }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard segments.contains(where: { isDot($0) || isDotDot($0) }) else { return path }
        var output: [Substring] = []
        for (index, segment) in segments.enumerated() {
            let last = index == segments.count - 1
            if index == 0 && segment.isEmpty { continue }
            if isDot(segment) {
                if last { output.append("") }
            } else if isDotDot(segment) {
                if !output.isEmpty { output.removeLast() }
                if last { output.append("") }
            } else {
                output.append(segment)
            }
        }
        return "/" + output.joined(separator: "/")
    }

    /// A link's host (without "www.") and path (percent-encoded, without dot segments or a
    /// trailing slash) — what a browser's `URL.pathname` gives the extension.
    struct Target {
        let host: String
        let path: String

        init?(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  var host = url.host?.lowercased(), !host.isEmpty
            else { return nil }
            if host.hasPrefix("www.") { host.removeFirst(4) }
            let encoded = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
            var path = LinkRouter.removingDotSegments(encoded)
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
