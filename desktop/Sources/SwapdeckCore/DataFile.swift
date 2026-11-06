import Foundation

/// The data file: `{ "format": "swapdeck-desktop", "version": 1, "settings": …, "workspaces": […] }`.
/// Reading is forgiving — anything unknown or invalid is dropped, never trusted — but a workspace
/// is only dropped when it has no id: text that is too long is cut, a missing name is replaced.
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
        let untitled = Translator(Language.resolve(settings.language))("workspace.untitled")
        var seen = Set<String>()
        let workspaces = (root["workspaces"] as? [Any] ?? [])
            .compactMap { sanitizeWorkspace($0, untitled: untitled) }
            .filter { seen.insert($0.id).inserted }
        // A window is found again by its workspace's name: names must not repeat.
        return DesktopData(settings: settings, workspaces: WorkspaceLogic.withUniqueNames(workspaces))
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
        if let raw = input["terminalApp"] as? String, let app = TerminalApp(rawValue: raw) { settings.terminalApp = app }
        return settings
    }

    /// A workspace from untrusted JSON, or nil without an id. `untitled` names a workspace that has no name.
    public static func sanitizeWorkspace(_ value: Any, untitled: String = "Workspace") -> Workspace? {
        guard let input = value as? [String: Any],
              let id = text(input["id"], max: 64), !id.isEmpty
        else { return nil }
        let name = cleanName(input["name"] as? String ?? "")
        let fallback = cleanName(untitled)
        let color = (input["color"] as? String).flatMap { Palette.isHex($0) ? $0.lowercased() : nil } ?? Palette.pigments[0].hex
        let symbol = (input["symbol"] as? String).flatMap { Symbols.isKnown($0) ? $0 : nil } ?? ""
        let browser = (input["browser"] as? String).flatMap(BrowserKind.init(rawValue:)) ?? .chrome
        let profile = (input["profileDirectory"] as? String).flatMap { ProfileReader.isProfileDirectory($0) ? $0 : nil } ?? ""
        let links = (input["links"] as? [Any] ?? []).compactMap(sanitizeLink).prefix(Limits.links)
        var ruleSet = Set<String>()
        let rules = (input["linkRules"] as? [Any] ?? []).compactMap { ($0 as? String).flatMap(LinkRouter.normalize) }
            .filter { ruleSet.insert($0).inserted }.prefix(Limits.linkRules)
        var names = Set<String>()
        let variables = (input["cliVariables"] as? [Any] ?? []).compactMap { item -> CLIVariable? in
            guard let entry = item as? [String: Any], let name = entry["name"] as? String,
                  TerminalEnv.isAllowedName(name), names.insert(name).inserted
            else { return nil }
            return CLIVariable(name: name, secret: entry["secret"] as? Bool ?? true)
        }.prefix(TerminalEnv.maxVariables)
        let folder = (input["terminalFolder"] as? String).flatMap { TerminalEnv.normalizedFolder($0) } ?? ""
        return Workspace(
            id: id,
            name: name.isEmpty ? (fallback.isEmpty ? "Workspace" : fallback) : name,
            color: color,
            symbol: symbol,
            note: clip(input["note"] as? String ?? "", Limits.note),
            browser: browser,
            profileDirectory: profile,
            profileName: clip(input["profileName"] as? String ?? "", Limits.profileName),
            profileEmail: text(input["profileEmail"], max: Limits.profileEmail) ?? "",
            links: Array(links),
            openLinksInNewWindow: input["openLinksInNewWindow"] as? Bool ?? true,
            linkRules: Array(rules),
            cliVariables: Array(variables),
            terminalFolder: folder,
            order: (input["order"] as? NSNumber)?.intValue ?? 0,
            createdAt: date(input["createdAt"]) ?? Date(timeIntervalSince1970: 0),
            lastOpenedAt: date(input["lastOpenedAt"]),
            openCount: max(0, (input["openCount"] as? NSNumber)?.intValue ?? 0)
        )
    }

    public static func sanitizeLink(_ value: Any) -> WorkspaceLink? {
        guard let input = value as? [String: Any],
              let url = text(input["url"], max: Limits.url), Links.isOpenable(url)
        else { return nil }
        let title = clip((input["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines), Limits.linkTitle)
        let id = text(input["id"], max: 64) ?? ""
        return WorkspaceLink(
            id: id.isEmpty ? WorkspaceLink(title: "", url: url).id : id,
            title: title.isEmpty ? Links.defaultTitle(for: url) : title,
            url: url
        )
    }

    /// A workspace name as it is kept: one line, no surrounding spaces, at most `Limits.name` characters.
    public static func cleanName(_ raw: String) -> String {
        let oneLine = String(raw.map { $0.isNewline || $0 == "\t" ? " " : $0 })
        return clip(oneLine.trimmingCharacters(in: .whitespacesAndNewlines), Limits.name)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// At most `max` characters.
    public static func clip(_ value: String, _ max: Int) -> String {
        value.count <= max ? value : String(value.prefix(max))
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

    /// How `loadReportingOutcome` found the file.
    public enum LoadOutcome: Equatable, Sendable {
        /// Read and understood.
        case loaded
        /// There is no file yet.
        case noFile
        /// The file couldn't be read or understood (set aside when possible).
        case unreadable
    }

    public func load() -> DesktopData {
        loadReportingOutcome().data
    }

    public func loadReportingOutcome() -> (data: DesktopData, outcome: LoadOutcome) {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return (DesktopData(), .noFile) }
        guard let data = try? Data(contentsOf: fileURL) else { return (DesktopData(), .unreadable) }
        do {
            return (try DataFile.decode(data), .loaded)
        } catch {
            let stamp = Int(Date().timeIntervalSince1970)
            let aside = fileURL.deletingPathExtension().appendingPathExtension("unreadable-\(stamp).json")
            try? FileManager.default.moveItem(at: fileURL, to: aside)
            return (DesktopData(), .unreadable)
        }
    }

    /// The data as it is, never setting the file aside (`--env` must not move the user's file).
    public func peek() -> DesktopData {
        (try? Data(contentsOf: fileURL)).flatMap { try? DataFile.decode($0) } ?? DesktopData()
    }

    public func save(_ data: DesktopData) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try DataFile.encode(data).write(to: fileURL, options: .atomic)
    }
}
