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
        let candidates = workspaces.filter { $0.browser == browser && !$0.name.isEmpty }
        var open = Set<String>()
        var front: String?
        for window in windows where !window.incognito && !window.givenName.isEmpty {
            guard let workspace = candidates.first(where: { $0.name == window.givenName }) else { continue }
            open.insert(workspace.id)
            if front == nil, window.id == windows.first(where: { !$0.incognito })?.id { front = workspace.id }
        }
        return (open, front)
    }

    /// The named window a workspace should come back to, if it still exists. A workspace
    /// without a name has no window of its own (unnamed windows belong to nobody).
    public static func window(for workspace: Workspace, in windows: [BrowserWindow]) -> BrowserWindow? {
        guard !workspace.name.isEmpty else { return nil }
        return windows.first { !$0.incognito && $0.givenName == workspace.name }
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

    /// Whether `profile` is still the profile a workspace remembers: the same Google account
    /// when both have one, else the same name; a workspace that remembers nothing accepts it.
    public static func profileMatches(_ workspace: Workspace, _ profile: BrowserProfile) -> Bool {
        let email = workspace.profileEmail.lowercased()
        if !email.isEmpty, let other = profile.email?.lowercased(), !other.isEmpty { return other == email }
        let name = fold(workspace.profileName)
        if !name.isEmpty { return fold(profile.name) == name }
        return true
    }

    /// The workspace with the name and Google account of the profile in its folder, when that
    /// profile is still the one it remembers (or it remembers none yet). A folder that now
    /// holds someone else's profile never overwrites what the workspace remembers: that is
    /// how `rematch` finds the right profile again.
    public static func refreshedDetails(_ workspace: Workspace, profile: BrowserProfile?) -> Workspace {
        guard let profile else { return workspace }
        var copy = workspace
        if workspace.profileName.isEmpty && workspace.profileEmail.isEmpty {
            copy.profileName = profile.name
            copy.profileEmail = profile.email ?? ""
        } else if profileMatches(workspace, profile) {
            copy.profileName = profile.name
            // Signed out of the browser: keep the account it had.
            if let email = profile.email, !email.isEmpty { copy.profileEmail = email }
        }
        return copy
    }

    /// On another Mac the same profile may sit in another folder: find each workspace's
    /// profile again by its Google account, else by its name — only a name that one
    /// profile and one workspace have, that the browser didn't choose itself ("Person 1"),
    /// and whose profile no other workspace already has.
    ///
    /// A workspace left without a match loses a folder that holds someone else's profile
    /// (it keeps what it remembers, to be matched later): for workspaces just `imported`
    /// from another Mac, any folder (its name means nothing here); for the others, a folder
    /// whose profile is signed in to another Google account (a mere new name can be the
    /// same profile, renamed). Nothing changes for a browser whose profiles couldn't be read.
    /// Returns the workspaces, the ids of those given another profile and of those still
    /// without one.
    public static func rematch(
        _ workspaces: [Workspace],
        profiles: [BrowserKind: [BrowserProfile]],
        imported: Set<String> = []
    ) -> (workspaces: [Workspace], changed: Set<String>, missing: Set<String>) {
        var changed = Set<String>()
        var missing = Set<String>()
        func current(_ workspace: Workspace) -> BrowserProfile? {
            (profiles[workspace.browser] ?? []).first { $0.directory == workspace.profileDirectory }
        }
        // Workspaces whose folder still holds their profile keep it, and claim it.
        var claimed: [BrowserKind: Set<String>] = [:]
        var fits = Set<String>()
        for workspace in workspaces {
            if let profile = current(workspace), profileMatches(workspace, profile) {
                fits.insert(workspace.id)
                claimed[workspace.browser, default: []].insert(profile.directory)
            }
        }
        // A remembered name only counts when a single workspace looking for a profile has it.
        var nameCounts: [BrowserKind: [String: Int]] = [:]
        for workspace in workspaces where !fits.contains(workspace.id) {
            let name = fold(workspace.profileName)
            if !name.isEmpty { nameCounts[workspace.browser, default: [:]][name, default: 0] += 1 }
        }
        let result = workspaces.map { workspace -> Workspace in
            if fits.contains(workspace.id) { return workspace }
            let list = profiles[workspace.browser] ?? []
            let email = workspace.profileEmail.lowercased()
            let name = fold(workspace.profileName)
            if workspace.profileDirectory.isEmpty && email.isEmpty && name.isEmpty {
                missing.insert(workspace.id)
                return workspace
            }
            var found = email.isEmpty ? nil : list.first { $0.email?.lowercased() == email }
            if found == nil, !name.isEmpty, nameCounts[workspace.browser]?[name] == 1 {
                let named = list.filter { fold($0.name) == name }
                if named.count == 1, let profile = named.first, !profile.usesDefaultName,
                   !(claimed[workspace.browser]?.contains(profile.directory) ?? false),
                   email.isEmpty || (profile.email ?? "").isEmpty {
                    found = profile
                }
            }
            guard let found else {
                missing.insert(workspace.id)
                guard profiles[workspace.browser] != nil, !workspace.profileDirectory.isEmpty else { return workspace }
                let holder = current(workspace)
                let someoneElse = imported.contains(workspace.id)
                    || (holder.flatMap { $0.email?.lowercased() }.map { !$0.isEmpty && !email.isEmpty && $0 != email } ?? false)
                guard someoneElse else { return workspace }
                // Never open another account's profile for this workspace: it waits for a profile instead.
                var copy = workspace
                copy.profileDirectory = ""
                return copy
            }
            claimed[workspace.browser, default: []].insert(found.directory)
            var copy = workspace
            copy.profileDirectory = found.directory
            copy.profileName = found.name
            if let foundEmail = found.email, !foundEmail.isEmpty { copy.profileEmail = foundEmail }
            if copy.profileDirectory != workspace.profileDirectory { changed.insert(workspace.id) }
            return copy
        }
        return (result, changed, missing)
    }

    /// Workspaces from an exported file that aren't here yet (by id), with names not taken here.
    public static func merge(_ incoming: [Workspace], into existing: [Workspace]) -> [Workspace] {
        let ids = Set(existing.map(\.id))
        var order = (existing.map(\.order).max() ?? -1) + 1
        var taken = existing
        var result: [Workspace] = []
        for workspace in incoming.filter({ !ids.contains($0.id) }).sorted(by: { $0.order < $1.order }) {
            var copy = workspace
            copy.order = order
            copy.name = uniqueName(workspace.name, existing: taken)
            order += 1
            taken.append(copy)
            result.append(copy)
        }
        return result
    }

    /// A workspace for a profile: its name (made unique), and its color when it is close to a pigment.
    public static func workspace(for profile: BrowserProfile, browser: BrowserKind, existing: [Workspace]) -> Workspace {
        Workspace(
            name: uniqueName(DataFile.cleanName(profile.name), existing: existing),
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

    /// The workspace already called `name` (without accents or case), other than `id`.
    public static func nameOwner(_ name: String, in workspaces: [Workspace], except id: String? = nil) -> Workspace? {
        let folded = fold(name)
        return workspaces.first { $0.id != id && fold($0.name) == folded }
    }

    /// A free name like "New workspace 2" (names compare without accents or case, and stay
    /// within `Limits.name`).
    public static func uniqueName(_ base: String, existing: [Workspace]) -> String {
        let names = Set(existing.map { fold($0.name) })
        if !names.contains(fold(base)) { return base }
        var number = 2
        while true {
            let suffix = " \(number)"
            let candidate = String(base.prefix(max(1, Limits.name - suffix.count))) + suffix
            if !names.contains(fold(candidate)) { return candidate }
            number += 1
        }
    }

    /// The same workspaces, a later one renamed ("Acme 2") when its name is already used.
    public static func withUniqueNames(_ workspaces: [Workspace]) -> [Workspace] {
        var kept: [Workspace] = []
        for workspace in workspaces {
            var copy = workspace
            copy.name = uniqueName(workspace.name, existing: kept)
            kept.append(copy)
        }
        return kept
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
