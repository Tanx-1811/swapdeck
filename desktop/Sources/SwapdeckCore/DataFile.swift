import Foundation

/// The data file: `{ "format": "swapdeck-desktop", "version": 1, "settings": …, "workspaces": […] }`.
/// Reading is forgiving — anything unknown or invalid is dropped, never trusted.
public enum DataFile {
    public static let format = "swapdeck-desktop"
    public static let version = 1

    private struct Envelope: Encodable {
        let format: String
        let version: Int
        let settings: DesktopSettings
        let workspaces: [Workspace]
    }

    public static func encode(_ data: DesktopData) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return try encoder.encode(Envelope(format: format, version: version, settings: data.settings, workspaces: data.workspaces))
    }

    public enum Failure: Error, Equatable {
        case notSwapdeckData
    }

    public static func decode(_ data: Data) throws -> DesktopData {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["format"] as? String == format
        else { throw Failure.notSwapdeckData }
        let settings = sanitizeSettings(root["settings"])
        var seen = Set<String>()
        let workspaces = (root["workspaces"] as? [Any] ?? []).compactMap(sanitizeWorkspace).filter { seen.insert($0.id).inserted }
        return DesktopData(settings: settings, workspaces: workspaces)
    }

    public static func sanitizeSettings(_ value: Any?) -> DesktopSettings {
        let input = value as? [String: Any] ?? [:]
        var settings = DesktopSettings()
        if let raw = input["language"] as? String, let language = LanguagePreference(rawValue: raw) { settings.language = language }
        if let raw = input["hotkey"] as? String, let hotkey = HotkeyChoice(rawValue: raw) { settings.hotkey = hotkey }
        if let nameWindows = input["nameWindows"] as? Bool { settings.nameWindows = nameWindows }
        if let raw = input["defaultBrowser"] as? String, let browser = BrowserKind(rawValue: raw) {
            settings.defaultBrowser = browser
        }
        if let raw = input["unmatchedLinks"] as? String, let choice = UnmatchedLinks(rawValue: raw) {
            settings.unmatchedLinks = choice
        }
        return settings
    }

    public static func sanitizeWorkspace(_ value: Any) -> Workspace? {
        guard let input = value as? [String: Any],
              let id = text(input["id"], max: 64), !id.isEmpty,
              let name = text(input["name"], max: 80)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty
        else { return nil }
        let color = (input["color"] as? String).flatMap { Palette.isHex($0) ? $0.lowercased() : nil } ?? Palette.pigments[0].hex
        let symbol = (input["symbol"] as? String).flatMap { Symbols.isKnown($0) ? $0 : nil } ?? ""
        let browser = (input["browser"] as? String).flatMap(BrowserKind.init(rawValue:)) ?? .chrome
        let profile = (input["profileDirectory"] as? String).flatMap { ProfileReader.isProfileDirectory($0) ? $0 : nil } ?? ""
        let links = (input["links"] as? [Any] ?? []).prefix(50).compactMap(sanitizeLink)
        var ruleSet = Set<String>()
        let rules = (input["linkRules"] as? [Any] ?? []).compactMap { ($0 as? String).flatMap(LinkRouter.normalize) }
            .filter { ruleSet.insert($0).inserted }.prefix(50)
        return Workspace(
            id: id,
            name: name,
            color: color,
            symbol: symbol,
            note: text(input["note"], max: 500) ?? "",
            browser: browser,
            profileDirectory: profile,
            links: Array(links),
            openLinksInNewWindow: input["openLinksInNewWindow"] as? Bool ?? true,
            linkRules: Array(rules),
            order: (input["order"] as? NSNumber)?.intValue ?? 0,
            createdAt: date(input["createdAt"]) ?? Date(timeIntervalSince1970: 0),
            lastOpenedAt: date(input["lastOpenedAt"]),
            openCount: max(0, (input["openCount"] as? NSNumber)?.intValue ?? 0)
        )
    }

    public static func sanitizeLink(_ value: Any) -> WorkspaceLink? {
        guard let input = value as? [String: Any],
              let url = text(input["url"], max: 2048), Links.isOpenable(url)
        else { return nil }
        let title = text(input["title"], max: 200)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let id = text(input["id"], max: 64) ?? ""
        return WorkspaceLink(
            id: id.isEmpty ? WorkspaceLink(title: "", url: url).id : id,
            title: title.isEmpty ? Links.defaultTitle(for: url) : title,
            url: url
        )
    }

    private static func text(_ value: Any?, max: Int) -> String? {
        guard let string = value as? String, string.count <= max else { return nil }
        return string
    }

    private static func date(_ value: Any?) -> Date? {
        guard let number = value as? NSNumber, number.doubleValue > 0 else { return nil }
        return Date(timeIntervalSince1970: number.doubleValue / 1000)
    }
}

/// Reads and writes the data file. A file that can't be read is set aside
/// (never overwritten) so nothing is lost.
public struct DataStore: Sendable {
    public let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// ~/Library/Application Support/Swapdeck Desktop/workspaces.json
    public static func standard() -> DataStore {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return DataStore(fileURL: support.appendingPathComponent("Swapdeck Desktop/workspaces.json"))
    }

    public func load() -> DesktopData {
        guard let data = try? Data(contentsOf: fileURL) else { return DesktopData() }
        do {
            return try DataFile.decode(data)
        } catch {
            let stamp = Int(Date().timeIntervalSince1970)
            let aside = fileURL.deletingPathExtension().appendingPathExtension("unreadable-\(stamp).json")
            try? FileManager.default.moveItem(at: fileURL, to: aside)
            return DesktopData()
        }
    }

    public func save(_ data: DesktopData) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try DataFile.encode(data).write(to: fileURL, options: .atomic)
    }
}
