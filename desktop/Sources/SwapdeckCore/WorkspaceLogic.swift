import Foundation

/// Pure helpers behind the app's actions (kept here so they can be tested).
public enum WorkspaceLogic {
    /// Which workspaces have a window (by the window's given name), and the
    /// workspace of the front-most window. `windows` are front to back.
    public static func windowState(
        _ windows: [BrowserWindow],
        workspaces: [Workspace],
        browser: BrowserKind
    ) -> (open: Set<String>, front: String?) {
        let candidates = workspaces.filter { $0.browser == browser }
        var open = Set<String>()
        var front: String?
        for window in windows where !window.incognito && !window.givenName.isEmpty {
            guard let workspace = candidates.first(where: { $0.name == window.givenName }) else { continue }
            open.insert(workspace.id)
            if front == nil, window.id == windows.first(where: { !$0.incognito })?.id { front = workspace.id }
        }
        return (open, front)
    }

    /// The named window a workspace should come back to, if it still exists.
    public static func window(for workspace: Workspace, in windows: [BrowserWindow]) -> BrowserWindow? {
        windows.first { !$0.incognito && $0.givenName == workspace.name }
    }

    /// Picks the window a launch just opened: with the browser already running
    /// it is the new front-most one; after a cold start (when the browser may
    /// restore other windows too) only a window showing one of our pages, or
    /// the only window there is, counts.
    public static func launchedWindow(
        before: Set<String>,
        after: [BrowserWindow],
        wasRunning: Bool,
        expectedHosts: [String],
        activeURLs: [String: String]
    ) -> BrowserWindow? {
        let fresh = after.filter { !before.contains($0.id) && !$0.incognito }
        if wasRunning { return fresh.first }
        if !expectedHosts.isEmpty {
            return fresh.first { window in
                guard let host = activeURLs[window.id].flatMap({ URL(string: $0)?.host }) else { return false }
                return expectedHosts.contains(host)
            }
        }
        return fresh.count == 1 ? fresh[0] : nil
    }

    /// Profiles of a browser that no workspace uses yet.
    public static func unusedProfiles(_ profiles: [BrowserProfile], workspaces: [Workspace], browser: BrowserKind) -> [BrowserProfile] {
        let used = Set(workspaces.filter { $0.browser == browser }.map(\.profileDirectory))
        return profiles.filter { !used.contains($0.directory) }
    }

    /// On another Mac the same profile may sit in another folder: find each
    /// workspace's profile again by its Google account, else by its name. A folder
    /// that holds someone else's profile counts as missing. Returns the workspaces
    /// and the ids of those changed and of those still without a profile.
    public static func rematch(
        _ workspaces: [Workspace],
        profiles: [BrowserKind: [BrowserProfile]]
    ) -> (workspaces: [Workspace], changed: Set<String>, missing: Set<String>) {
        var changed = Set<String>()
        var missing = Set<String>()
        let result = workspaces.map { workspace -> Workspace in
            let list = profiles[workspace.browser] ?? []
            let email = workspace.profileEmail.lowercased()
            let name = fold(workspace.profileName)
            let current = list.first { $0.directory == workspace.profileDirectory }
            let currentFits = current.map { profile in
                if !email.isEmpty, let other = profile.email?.lowercased(), !other.isEmpty { return other == email }
                if !name.isEmpty { return fold(profile.name) == name }
                return true
            } ?? false
            if currentFits || (workspace.profileDirectory.isEmpty && email.isEmpty && name.isEmpty) {
                if workspace.profileDirectory.isEmpty { missing.insert(workspace.id) }
                return workspace
            }
            let found = (!email.isEmpty ? list.first { $0.email?.lowercased() == email } : nil)
                ?? (!name.isEmpty ? list.first { fold($0.name) == name } : nil)
            guard let found else {
                missing.insert(workspace.id)
                return workspace
            }
            var copy = workspace
            copy.profileDirectory = found.directory
            copy.profileName = found.name
            copy.profileEmail = found.email ?? ""
            if copy.profileDirectory != workspace.profileDirectory { changed.insert(workspace.id) }
            return copy
        }
        return (result, changed, missing)
    }

    /// Workspaces from an exported file that aren't here yet (by id).
    public static func merge(_ incoming: [Workspace], into existing: [Workspace]) -> [Workspace] {
        let ids = Set(existing.map(\.id))
        var order = (existing.map(\.order).max() ?? -1) + 1
        return incoming.filter { !ids.contains($0.id) }.sorted { $0.order < $1.order }.map { workspace in
            var copy = workspace
            copy.order = order
            order += 1
            return copy
        }
    }

    /// A workspace for a profile: its name, and its color when it is close to a pigment.
    public static func workspace(for profile: BrowserProfile, browser: BrowserKind, existing: [Workspace]) -> Workspace {
        Workspace(
            name: profile.name,
            color: Palette.next(after: existing.map(\.color)),
            browser: browser,
            profileDirectory: profile.directory,
            profileName: profile.name,
            profileEmail: profile.email ?? "",
            order: (existing.map(\.order).max() ?? -1) + 1
        )
    }

    /// Imported workspaces whose name isn't taken yet, as new workspaces without a profile.
    public static func adopt(_ imported: [ImportedWorkspace], into existing: [Workspace], browser: BrowserKind) -> [Workspace] {
        var names = Set(existing.map { fold($0.name) })
        var order = (existing.map(\.order).max() ?? -1) + 1
        var result: [Workspace] = []
        for item in imported where names.insert(fold(item.name)).inserted {
            result.append(Workspace(
                name: item.name,
                color: item.color,
                symbol: item.symbol,
                note: item.note,
                browser: browser,
                links: item.links,
                order: order
            ))
            order += 1
        }
        return result
    }

    /// Search without accents or case: "cong ty" finds "Công ty", "dang" finds "Đặng".
    public static func filter(_ workspaces: [Workspace], query: String) -> [Workspace] {
        let needle = fold(query).trimmingCharacters(in: .whitespaces)
        if needle.isEmpty { return workspaces }
        return workspaces.filter { workspace in
            [workspace.name, workspace.note, workspace.profileDirectory].contains { fold($0).contains(needle) }
                || workspace.links.contains { fold($0.title).contains(needle) || fold($0.url).contains(needle) }
        }
    }

    public static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: nil)
            .replacingOccurrences(of: "đ", with: "d")
            .replacingOccurrences(of: "Đ", with: "d")
    }

    /// A free name like "New workspace 2".
    public static func uniqueName(_ base: String, existing: [Workspace]) -> String {
        let names = Set(existing.map(\.name))
        if !names.contains(base) { return base }
        var number = 2
        while names.contains("\(base) \(number)") { number += 1 }
        return "\(base) \(number)"
    }

    /// Moves the workspace with `id` to `index` and renumbers `order`.
    public static func move(_ workspaces: [Workspace], id: String, to index: Int) -> [Workspace] {
        var ordered = workspaces.sorted { ($0.order, $0.createdAt) < ($1.order, $1.createdAt) }
        guard let from = ordered.firstIndex(where: { $0.id == id }) else { return workspaces }
        let item = ordered.remove(at: from)
        ordered.insert(item, at: max(0, min(index, ordered.count)))
        return ordered.enumerated().map { offset, workspace in
            var copy = workspace
            copy.order = offset
            return copy
        }
    }
}
