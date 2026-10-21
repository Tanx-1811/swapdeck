import Foundation

/// A workspace ("bên"): a client, company or project kept in its own browser
/// profile, so its sign-ins never mix with the others'. Swapdeck Desktop only
/// opens the right profile; it never reads or copies sign-in data.
public struct Workspace: Encodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    /// "#rrggbb"; a pigment from `Palette` unless imported.
    public var color: String
    /// A key of `Symbols`, or "" for initials.
    public var symbol: String
    public var note: String
    public var browser: BrowserKind
    /// The profile folder in the browser's data folder ("Default", "Profile 2"); "" until chosen.
    public var profileDirectory: String
    /// The profile's name and Google account when it was chosen, to find it again on another Mac
    /// (where the same profile may live in another folder).
    public var profileName: String
    public var profileEmail: String
    public var links: [WorkspaceLink]
    /// Open the pinned pages whenever the workspace gets a new window.
    public var openLinksInNewWindow: Bool
    /// Links from other apps that belong here ("acme.example", "supabase.com/dashboard/project/acme"),
    /// besides the ones its pages imply (see `LinkRouter`).
    public var linkRules: [String]
    public var order: Int
    public var createdAt: Date
    public var lastOpenedAt: Date?
    public var openCount: Int

    public init(
        id: String = Workspace.newId(),
        name: String,
        color: String = Palette.pigments[0].hex,
        symbol: String = "",
        note: String = "",
        browser: BrowserKind = .chrome,
        profileDirectory: String = "",
        profileName: String = "",
        profileEmail: String = "",
        links: [WorkspaceLink] = [],
        openLinksInNewWindow: Bool = true,
        linkRules: [String] = [],
        order: Int = 0,
        createdAt: Date = Date(),
        lastOpenedAt: Date? = nil,
        openCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.color = color
        self.symbol = symbol
        self.note = note
        self.browser = browser
        self.profileDirectory = profileDirectory
        self.profileName = profileName
        self.profileEmail = profileEmail
        self.links = links
        self.openLinksInNewWindow = openLinksInNewWindow
        self.linkRules = linkRules
        self.order = order
        self.createdAt = createdAt
        self.lastOpenedAt = lastOpenedAt
        self.openCount = openCount
    }

    public static func newId() -> String {
        "ws_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
    }

    /// The pinned pages that may be handed to the browser (http and https only).
    public var openableLinks: [WorkspaceLink] {
        links.filter { Links.isOpenable($0.url) }
    }
}

/// A page that belongs to a workspace.
public struct WorkspaceLink: Encodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var url: String

    public init(id: String = "ln_" + UUID().uuidString.prefix(8).lowercased(), title: String, url: String) {
        self.id = id
        self.title = title
        self.url = url
    }
}

public enum LanguagePreference: String, Codable, CaseIterable, Sendable {
    case auto, vi, en
}

/// The global shortcut that opens the switcher.
public enum HotkeyChoice: String, Codable, CaseIterable, Sendable {
    case controlOptionB, controlOptionCommandB, optionShiftSpace, off

    public var display: String {
        switch self {
        case .controlOptionB: "⌃⌥B"
        case .controlOptionCommandB: "⌃⌥⌘B"
        case .optionShiftSpace: "⌥⇧Space"
        case .off: ""
        }
    }
}

public struct DesktopSettings: Encodable, Hashable, Sendable {
    public var language: LanguagePreference
    public var hotkey: HotkeyChoice
    /// Give each workspace's browser window the workspace's name (Mission Control, Window menu)
    /// and bring that window back instead of opening a new one.
    public var nameWindows: Bool
    /// The browser new workspaces use (and that opens links outside any workspace).
    public var defaultBrowser: BrowserKind
    /// Where links that match no workspace go, when Swapdeck opens links.
    public var unmatchedLinks: UnmatchedLinks

    public init(
        language: LanguagePreference = .auto,
        hotkey: HotkeyChoice = .controlOptionB,
        nameWindows: Bool = true,
        defaultBrowser: BrowserKind = .chrome,
        unmatchedLinks: UnmatchedLinks = .ask
    ) {
        self.language = language
        self.hotkey = hotkey
        self.nameWindows = nameWindows
        self.defaultBrowser = defaultBrowser
        self.unmatchedLinks = unmatchedLinks
    }
}

/// Everything Swapdeck Desktop stores (no secrets: names, colors, profile folders, page addresses).
public struct DesktopData: Hashable, Sendable {
    public var settings: DesktopSettings
    public var workspaces: [Workspace]

    public init(settings: DesktopSettings = DesktopSettings(), workspaces: [Workspace] = []) {
        self.settings = settings
        self.workspaces = workspaces
    }

    /// Workspaces in display order.
    public var ordered: [Workspace] {
        workspaces.sorted { ($0.order, $0.createdAt) < ($1.order, $1.createdAt) }
    }
}

public enum Links {
    /// Only plain web pages are handed to the browser: never flags, files or scripts.
    public static func isOpenable(_ text: String) -> Bool {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { return false }
        return true
    }

    /// "example.com/path" → "https://example.com/path"; nil when it can't be a web page.
    public static func normalized(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if isOpenable(trimmed) { return trimmed }
        if !trimmed.contains("://"), !trimmed.hasPrefix("-"), isOpenable("https://" + trimmed) { return "https://" + trimmed }
        return nil
    }

    /// A short title for a page: its host without "www.".
    public static func defaultTitle(for text: String) -> String {
        guard let host = URL(string: text)?.host else { return text }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
