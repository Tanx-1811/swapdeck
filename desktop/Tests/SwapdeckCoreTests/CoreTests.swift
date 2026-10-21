import Foundation
import Testing
@testable import SwapdeckCore

@Suite("Browser profiles")
struct ProfileTests {
    let localState = Data("""
    {
      "profile": {
        "profiles_order": ["Default", "Profile 3", "Profile 1"],
        "info_cache": {
          "Default": { "name": "Personal", "user_name": "me@gmail.com", "profile_highlight_color": -14135184, "active_time": 1700000000.5 },
          "Profile 1": { "name": "  ", "default_avatar_fill_color": -16777216 },
          "Profile 3": { "name": "Acme", "user_name": "" },
          "Profile 9": { "name": "Guest-like", "is_ephemeral": true },
          "../evil": { "name": "Path" }
        }
      }
    }
    """.utf8)

    @Test func readsProfilesInTheBrowsersOrder() throws {
        let profiles = try ProfileReader.profiles(localState: localState)
        #expect(profiles.map(\.directory) == ["Default", "Profile 3", "Profile 1"])
        #expect(profiles[0].name == "Personal")
        #expect(profiles[0].email == "me@gmail.com")
        #expect(profiles[0].color == "#285070")
        #expect(profiles[0].lastActive == Date(timeIntervalSince1970: 1_700_000_000.5))
        #expect(profiles[1].email == nil)
        #expect(profiles[2].name == "Profile 1")
        #expect(profiles[2].color == "#000000")
    }

    @Test func rejectsFilesThatAreNotLocalState() {
        #expect(throws: ProfileReader.Failure.unreadable) { try ProfileReader.profiles(localState: Data("[]".utf8)) }
        #expect(throws: ProfileReader.Failure.unreadable) { try ProfileReader.profiles(localState: Data("nope".utf8)) }
    }

    @Test func convertsSignedARGBColors() {
        #expect(Palette.hex(fromARGB: -16777216) == "#000000")
        #expect(Palette.hex(fromARGB: 0xFFC8_402B) == "#c8402b")
        #expect(Palette.hex(fromARGB: -3653589) == "#c8402b")
    }

    @Test func picksFreeProfileFolderNames() {
        #expect(ProfileReader.newDirectoryName(existing: ["Default", "Profile 1", "Profile 2"]) == "Profile 3")
        #expect(ProfileReader.newDirectoryName(existing: []) == "Profile 1")
        #expect(ProfileReader.isProfileDirectory("Profile 2"))
        #expect(!ProfileReader.isProfileDirectory("../x"))
        #expect(!ProfileReader.isProfileDirectory("--flag"))
        #expect(!ProfileReader.isProfileDirectory(""))
    }
}

@Suite("Launching and scripting")
struct LauncherTests {
    @Test func opensAProfileThroughOpenWithOnlyWebPages() throws {
        let command = try #require(Launcher.openProfile(
            .chrome,
            profileDirectory: "Profile 2",
            urls: ["https://supabase.com/dashboard", "--disable-web-security", "file:///etc/passwd", "javascript:alert(1)"]
        ))
        #expect(command.executable == "/usr/bin/open")
        #expect(command.arguments == [
            "-n", "-b", "com.google.Chrome", "--args", "--profile-directory=Profile 2", "--new-window",
            "https://supabase.com/dashboard",
        ])
        #expect(Launcher.openProfile(.brave, profileDirectory: "../../x") == nil)
        #expect(Launcher.openProfile(.edge, profileDirectory: "Default", newWindow: false)?.arguments.contains("--new-window") == false)
    }

    @Test func escapesAppleScriptStrings() {
        #expect(BrowserScript.literal("Công ty") == "\"Công ty\"")
        #expect(BrowserScript.literal("a \"b\" \\ c\nd") == "\"a \\\"b\\\" \\\\ c d\"")
        let script = BrowserScript.nameWindow(.chrome, id: "12", name: "Khách \"VIP\"")
        #expect(script.contains("tell application id \"com.google.Chrome\""))
        #expect(script.contains("set given name of w to \"Khách \\\"VIP\\\"\""))
        #expect(script.contains("is \"12\""))
    }

    @Test func parsesWindowLists() {
        let output = "101\tCông ty\tfalse\tnormal\n102\t\ttrue\tnormal\n103\tTab\tname\tfalse\tincognito\n\nbad\n"
        let windows = BrowserScript.parseWindows(output)
        #expect(windows == [
            BrowserWindow(id: "101", givenName: "Công ty", minimized: false, incognito: false),
            BrowserWindow(id: "102", givenName: "", minimized: true, incognito: false),
            BrowserWindow(id: "103", givenName: "Tab\tname", minimized: false, incognito: true),
        ])
        #expect(BrowserScript.parseActiveURLs("1\thttps://a.io/x\n2\thttps://b.io\n") == ["1": "https://a.io/x", "2": "https://b.io"])
    }

    @Test func recognisesAMissingPermission() {
        #expect(BrowserScript.isPermissionDenied("execution error: Not authorized to send Apple events to Google Chrome. (-1743)"))
        #expect(!BrowserScript.isPermissionDenied("execution error: Google Chrome got an error: Can’t get window 1. (-1719)"))
    }
}

@Suite("Workspaces")
struct WorkspaceLogicTests {
    let acme = Workspace(id: "ws_acme", name: "Acme", browser: .chrome, profileDirectory: "Profile 1", order: 0)
    let me = Workspace(id: "ws_me", name: "Cá nhân", browser: .chrome, profileDirectory: "Default", order: 1)
    let brave = Workspace(id: "ws_brave", name: "Acme", browser: .brave, profileDirectory: "Default", order: 2)

    @Test func findsOpenAndFrontWindows() {
        let windows = [
            BrowserWindow(id: "1", givenName: "Cá nhân", minimized: false, incognito: false),
            BrowserWindow(id: "2", givenName: "", minimized: false, incognito: false),
            BrowserWindow(id: "3", givenName: "Acme", minimized: true, incognito: false),
            BrowserWindow(id: "4", givenName: "Acme", minimized: false, incognito: true),
        ]
        let state = WorkspaceLogic.windowState(windows, workspaces: [acme, me, brave], browser: .chrome)
        #expect(state.open == ["ws_me", "ws_acme"])
        #expect(state.front == "ws_me")
        let behind = WorkspaceLogic.windowState(Array(windows.dropFirst()), workspaces: [acme, me], browser: .chrome)
        #expect(behind.front == nil)
        #expect(WorkspaceLogic.window(for: acme, in: windows)?.id == "3")
    }

    @Test func picksTheWindowALaunchOpened() {
        let after = [
            BrowserWindow(id: "9", givenName: "", minimized: false, incognito: false),
            BrowserWindow(id: "8", givenName: "", minimized: false, incognito: false),
            BrowserWindow(id: "1", givenName: "Old", minimized: false, incognito: false),
        ]
        // Running browser: the new front-most window.
        #expect(WorkspaceLogic.launchedWindow(before: ["1"], after: after, wasRunning: true, expectedHosts: [], activeURLs: [:])?.id == "9")
        // Cold start with restored windows: only a window showing our page, …
        let urls = ["9": "https://other.io/", "8": "https://supabase.com/dashboard"]
        #expect(WorkspaceLogic.launchedWindow(before: [], after: after, wasRunning: false, expectedHosts: ["supabase.com"], activeURLs: urls)?.id == "8")
        // … or the only window there is; never a guess.
        #expect(WorkspaceLogic.launchedWindow(before: [], after: after, wasRunning: false, expectedHosts: [], activeURLs: [:]) == nil)
        #expect(WorkspaceLogic.launchedWindow(before: [], after: [after[0]], wasRunning: false, expectedHosts: [], activeURLs: [:])?.id == "9")
    }

    @Test func searchesWithoutAccents() {
        let list = [acme, me, Workspace(name: "Đặng Gia", note: "khách VIP")]
        #expect(WorkspaceLogic.filter(list, query: "ca nhan").map(\.id) == ["ws_me"])
        #expect(WorkspaceLogic.filter(list, query: "dang").map(\.name) == ["Đặng Gia"])
        #expect(WorkspaceLogic.filter(list, query: "vip").map(\.name) == ["Đặng Gia"])
        #expect(WorkspaceLogic.filter(list, query: "  ").count == 3)
    }

    @Test func importsProfilesAndBackupsWithoutDuplicates() {
        let profiles = [BrowserProfile(directory: "Default", name: "Me"), BrowserProfile(directory: "Profile 4", name: "Globex")]
        let unused = WorkspaceLogic.unusedProfiles(profiles, workspaces: [acme, me, brave], browser: .chrome)
        #expect(unused.map(\.directory) == ["Profile 4"])
        let made = WorkspaceLogic.workspace(for: unused[0], browser: .chrome, existing: [acme, me])
        #expect(made.name == "Globex" && made.profileDirectory == "Profile 4" && made.order == 2)

        let imported = [
            ImportedWorkspace(name: "acme", color: "#2f4e86", symbol: "building", note: "", links: []),
            ImportedWorkspace(name: "Initech", color: "#1f6b52", symbol: "", note: "n", links: [WorkspaceLink(title: "Docs", url: "https://docs.io")]),
        ]
        let adopted = WorkspaceLogic.adopt(imported, into: [acme, me], browser: .edge)
        #expect(adopted.map(\.name) == ["Initech"])
        #expect(adopted[0].browser == .edge && adopted[0].profileDirectory.isEmpty && adopted[0].links.count == 1)
    }

    @Test func namesAndOrders() {
        #expect(WorkspaceLogic.uniqueName("Acme", existing: [acme]) == "Acme 2")
        #expect(WorkspaceLogic.uniqueName("Globex", existing: [acme]) == "Globex")
        let moved = WorkspaceLogic.move([acme, me, brave], id: "ws_brave", to: 0)
        #expect(moved.map(\.id) == ["ws_brave", "ws_acme", "ws_me"])
        #expect(moved.map(\.order) == [0, 1, 2])
    }

    @Test func initialsAndColors() {
        #expect(Initials.of("Ngọc Ánh") == "NA")
        #expect(Initials.of("Dự án phụ") == "DA")
        #expect(Initials.of("Đặng") == "ĐA")
        #expect(Initials.of("acme.io") == "AI")
        #expect(Initials.of("") == "?")
        for pigment in Palette.pigments {
            #expect(Palette.contrast("#ffffff", pigment.hex) >= 4.5, "\(pigment.key)")
        }
        #expect(Palette.next(after: ["#c8402b"]) == "#2f4e86")
        #expect(Palette.textColor(on: "#f4f0e8") == "#1a1714")
    }

    @Test func linksMustBeWebPages() {
        #expect(Links.isOpenable("https://supabase.com"))
        #expect(!Links.isOpenable("file:///etc/hosts"))
        #expect(!Links.isOpenable("--incognito"))
        #expect(Links.normalized("vercel.com/dashboard") == "https://vercel.com/dashboard")
        #expect(Links.normalized("javascript:alert(1)") == nil)
        #expect(Links.defaultTitle(for: "https://www.github.com/x") == "github.com")
    }
}

@Suite("Data file")
struct DataFileTests {
    @Test func roundTripsAndDropsWhatItDoesNotTrust() throws {
        var workspace = Workspace(id: "ws_1", name: "Acme", symbol: "rocket", profileDirectory: "Profile 1")
        workspace.links = [WorkspaceLink(id: "l1", title: "Dash", url: "https://app.acme.example")]
        workspace.lastOpenedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let data = DesktopData(settings: DesktopSettings(language: .vi, hotkey: .off, nameWindows: false, defaultBrowser: .brave), workspaces: [workspace])
        let decoded = try DataFile.decode(DataFile.encode(data))
        #expect(decoded.settings == data.settings)
        #expect(decoded.workspaces.first?.links == workspace.links)
        #expect(decoded.workspaces.first?.lastOpenedAt == workspace.lastOpenedAt)

        let hostile = Data("""
        { "format": "swapdeck-desktop", "version": 1,
          "settings": { "language": "fr", "hotkey": "nope", "nameWindows": "yes" },
          "workspaces": [
            { "id": "a", "name": "  Ok  ", "color": "red", "symbol": "skull", "browser": "netscape",
              "profileDirectory": "../../etc", "links": [{ "url": "javascript:x" }, { "url": "https://ok.io", "title": "" }] },
            { "id": "a", "name": "Duplicate" },
            { "id": "", "name": "No id" },
            { "name": "No id either" }
          ] }
        """.utf8)
        let cleaned = try DataFile.decode(hostile)
        #expect(cleaned.settings == DesktopSettings())
        #expect(cleaned.workspaces.count == 1)
        let ok = cleaned.workspaces[0]
        #expect(ok.name == "Ok" && ok.color == Palette.pigments[0].hex && ok.symbol.isEmpty)
        #expect(ok.browser == .chrome && ok.profileDirectory.isEmpty)
        #expect(ok.links.map(\.url) == ["https://ok.io"] && ok.links[0].title == "ok.io")
        #expect(throws: DataFile.Failure.notSwapdeckData) { try DataFile.decode(Data("{}".utf8)) }
    }

    @Test func setsAsideAFileItCannotRead() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("swapdeck-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = DataStore(fileURL: folder.appendingPathComponent("workspaces.json"))
        #expect(store.load() == DesktopData())
        try store.save(DesktopData(workspaces: [Workspace(name: "Kept")]))
        #expect(store.load().workspaces.map(\.name) == ["Kept"])
        try Data("garbage".utf8).write(to: store.fileURL)
        #expect(store.load() == DesktopData())
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.path)
        #expect(names.contains { $0.hasPrefix("workspaces.unreadable-") })
    }
}

@Suite("Extension backups")
struct BackupTests {
    let plain = Data("""
    { "format": "swapdeck-backup", "version": 1, "createdAt": 1, "encrypted": false,
      "payload": { "apps": [], "accounts": [], "sessions": {}, "workspaces": [
        { "id": "ws_1", "name": "Công ty", "color": "#C8402B", "icon": "building", "emoji": "🏢", "note": "Main",
          "members": {}, "links": [{ "id": "p", "title": "Prod", "url": "https://supabase.com/dashboard" }, { "url": "chrome://settings" }] },
        { "id": "ws_2", "name": "", "color": "#000000" }
      ] } }
    """.utf8)

    @Test func readsWorkspacesOfAPlainBackup() throws {
        #expect(try !BackupImport.isEncrypted(plain))
        let list = try BackupImport.workspaces(from: plain)
        #expect(list.count == 1)
        #expect(list[0].name == "Công ty" && list[0].color == "#c8402b" && list[0].symbol == "building" && list[0].note == "Main")
        #expect(list[0].links.map(\.url) == ["https://supabase.com/dashboard"])
        #expect(throws: BackupImport.Failure.notABackup) { try BackupImport.workspaces(from: Data("{}".utf8)) }
    }

    /// The fixture was written by the extension's own `encryptWithPassword` (see scripts/make-backup-fixture.mjs).
    @Test func decryptsABackupMadeByTheExtension() throws {
        let url = try #require(Bundle.module.url(forResource: "encrypted-backup", withExtension: "json"))
        let data = try Data(contentsOf: url)
        #expect(try BackupImport.isEncrypted(data))
        #expect(throws: BackupImport.Failure.needsPassword) { try BackupImport.workspaces(from: data) }
        #expect(throws: BackupImport.Failure.wrongPassword) { try BackupImport.workspaces(from: data, password: "wrong password") }
        let list = try BackupImport.workspaces(from: data, password: "mật khẩu đúng 123")
        #expect(list.map(\.name) == ["Khách hàng Acme", "Cá nhân"])
        #expect(list[0].links.first?.url == "https://app.acme.example/")
    }
}

@Suite("Messages")
struct MessageTests {
    @Test func everyMessageExistsInBothLanguages() {
        #expect(Set(Messages.en.keys) == Set(Messages.vi.keys))
        for pigment in Palette.pigments { #expect(Messages.en["color.\(pigment.key)"] != nil) }
        for symbol in Symbols.all { #expect(Messages.en["symbol.\(symbol.key)"] != nil) }
    }

    @Test func fillsPlaceholdersAndPicksTheLanguage() {
        let vi = Translator(.vi)
        #expect(vi("switcher.pages", ["n": "3"]) == "3 trang")
        #expect(vi.count(1, one: "switcher.onePage", many: "switcher.pages") == "1 trang")
        #expect(Translator(.en)("missing.key") == "missing.key")
        #expect(Language.resolve(.auto, preferred: ["vi-VN"]) == .vi)
        #expect(Language.resolve(.auto, preferred: ["en-US"]) == .en)
        #expect(Language.resolve(.en, preferred: ["vi-VN"]) == .en)
    }
}

@Suite("Opening links in the right workspace")
struct LinkRouterTests {
    let company = Workspace(
        id: "ws_company", name: "Company",
        links: [
            WorkspaceLink(title: "Projects", url: "https://supabase.com/dashboard/projects"),
            WorkspaceLink(title: "Docs", url: "https://docs.company.example/"),
        ]
    )
    let acme = Workspace(
        id: "ws_acme", name: "Acme",
        links: [WorkspaceLink(title: "Acme DB", url: "https://supabase.com/dashboard/project/acme")],
        linkRules: ["acme.example"]
    )

    private func route(_ link: String, _ workspaces: [Workspace]? = nil) -> String? {
        LinkRouter.route(URL(string: link)!, workspaces: workspaces ?? [company, acme])?.workspaceId
    }

    @Test func picksTheMostSpecificRule() {
        #expect(route("https://app.acme.example/invoices") == "ws_acme")
        #expect(route("https://www.acme.example") == "ws_acme")
        #expect(route("https://supabase.com/dashboard/project/acme/sql/new") == "ws_acme")
        #expect(route("https://supabase.com/dashboard/projects") == "ws_company")
        #expect(route("https://docs.company.example/guide") == "ws_company")
        // A host both workspaces have pages on belongs to neither by itself.
        #expect(route("https://supabase.com/dashboard/project/other") == nil)
        #expect(route("https://supabase.com/dashboard/project/acmeX") == nil)
        #expect(route("https://example.org/") == nil)
        #expect(route("mailto:someone@acme.example") == nil)
    }

    @Test func rulesAddedByHandWinTies() {
        var company = company
        company.linkRules = ["supabase.com/dashboard/project/acme"]
        let found = LinkRouter.route(URL(string: "https://supabase.com/dashboard/project/acme")!, workspaces: [company, acme])
        #expect(found == LinkRoute(workspaceId: "ws_company", rule: "supabase.com/dashboard/project/acme", explicit: true))
        // A host rule without a path never beats a matching path.
        var broad = acme
        broad.linkRules = ["supabase.com"]
        #expect(route("https://supabase.com/dashboard/projects", [company, broad]) == "ws_company")
        #expect(route("https://supabase.com/billing", [company, broad]) == "ws_acme")
    }

    @Test func derivesRulesFromPages() {
        #expect(LinkRouter.implicitRules(for: company, among: [company, acme]) == [
            "supabase.com/dashboard/projects", "docs.company.example",
        ])
        #expect(LinkRouter.implicitRules(for: acme, among: [acme]) == ["supabase.com/dashboard/project/acme", "supabase.com"])
    }

    @Test func normalizesWhatPeopleType() {
        #expect(LinkRouter.normalize("https://www.Acme.example/Path/?q=1#x") == "acme.example/Path")
        #expect(LinkRouter.normalize("*.acme.example") == "acme.example")
        #expect(LinkRouter.normalize("user@acme.example:8080/a") == "acme.example/a")
        #expect(LinkRouter.normalize("localhost") == nil)
        #expect(LinkRouter.normalize("not a host") == nil)
        #expect(LinkRouter.normalize("") == nil)
    }

    @Test func keepsRulesAndTheChoiceInTheDataFile() throws {
        var workspace = Workspace(id: "ws", name: "Acme")
        workspace.linkRules = ["acme.example", "supabase.com/dashboard/project/acme"]
        let data = DesktopData(settings: DesktopSettings(unmatchedLinks: .front), workspaces: [workspace])
        let decoded = try DataFile.decode(DataFile.encode(data))
        #expect(decoded.settings.unmatchedLinks == .front)
        #expect(decoded.workspaces[0].linkRules == workspace.linkRules)
        let hostile = Data("""
        { "format": "swapdeck-desktop", "settings": { "unmatchedLinks": "everywhere" },
          "workspaces": [{ "id": "a", "name": "A", "linkRules": ["https://www.Acme.example/", "acme.example", "bad host", 4] }] }
        """.utf8)
        let cleaned = try DataFile.decode(hostile)
        #expect(cleaned.settings.unmatchedLinks == .ask)
        #expect(cleaned.workspaces[0].linkRules == ["acme.example"])
    }
}

@Suite("New profiles")
struct ProfileSeedTests {
    @Test func namesAndColorsANewProfile() throws {
        let data = ProfileSeed.preferences(name: "  Khách hàng Acme  ", color: "#94661a")
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let profile = try #require(root["profile"] as? [String: Any])
        #expect(profile["name"] as? String == "Khách hàng Acme")
        #expect(profile["using_default_name"] as? Bool == false)
        let theme = try #require((root["browser"] as? [String: Any])?["theme"] as? [String: Any])
        // The signed ARGB Chrome itself wrote for #94661a in our check against Chrome for Testing.
        #expect((theme["user_color"] as? NSNumber)?.intValue == -7_051_750)
        #expect((theme["color_variant"] as? NSNumber)?.intValue == 1)
        let plain = try #require(try JSONSerialization.jsonObject(with: ProfileSeed.preferences(name: "A", color: "red")) as? [String: Any])
        #expect((plain["browser"] as? [String: Any])?["theme"] == nil)
    }
}

@Suite("Moving to another Mac")
struct MoveTests {
    let here: [BrowserKind: [BrowserProfile]] = [
        .chrome: [
            BrowserProfile(directory: "Default", name: "Personal", email: "minh.home@example.com"),
            BrowserProfile(directory: "Profile 2", name: "Acme", email: "dev@acme.example"),
            BrowserProfile(directory: "Profile 5", name: "Công ty"),
        ],
    ]

    @Test func findsEachProfileAgainByAccountOrName() {
        let byEmail = Workspace(id: "a", name: "Acme", profileDirectory: "Profile 3", profileName: "Acme old", profileEmail: "DEV@acme.example")
        let byName = Workspace(id: "c", name: "Company", profileDirectory: "Profile 1", profileName: "cong ty")
        let someoneElse = Workspace(id: "p", name: "Me", profileDirectory: "Profile 2", profileEmail: "minh.home@example.com")
        let fine = Workspace(id: "d", name: "Personal", profileDirectory: "Default", profileName: "Personal")
        let lost = Workspace(id: "x", name: "Gone", profileDirectory: "Profile 9", profileName: "Globex")
        let none = Workspace(id: "n", name: "New")
        let result = WorkspaceLogic.rematch([byEmail, byName, someoneElse, fine, lost, none], profiles: here)
        let byId = Dictionary(uniqueKeysWithValues: result.workspaces.map { ($0.id, $0) })
        #expect(byId["a"]?.profileDirectory == "Profile 2")
        #expect(byId["a"]?.profileName == "Acme")
        #expect(byId["c"]?.profileDirectory == "Profile 5")
        // "Profile 2" holds someone else's account here: the workspace moves to its own profile.
        #expect(byId["p"]?.profileDirectory == "Default")
        #expect(byId["d"]?.profileDirectory == "Default")
        #expect(result.changed == ["a", "c", "p"])
        #expect(result.missing == ["x", "n"])
    }

    @Test func importsOnlyWorkspacesThatAreNotHereYet() {
        let existing = [Workspace(id: "a", name: "A", order: 0), Workspace(id: "b", name: "B", order: 3)]
        let incoming = [Workspace(id: "b", name: "B again", order: 0), Workspace(id: "c", name: "C", order: 1)]
        let merged = WorkspaceLogic.merge(incoming, into: existing)
        #expect(merged.map(\.id) == ["c"])
        #expect(merged[0].order == 4)
    }

    @Test func keepsTheRememberedProfileInTheFile() throws {
        let workspace = Workspace(id: "w", name: "Acme", profileDirectory: "Profile 2", profileName: "Acme", profileEmail: "dev@acme.example")
        let decoded = try DataFile.decode(DataFile.encode(DesktopData(workspaces: [workspace])))
        #expect(decoded.workspaces[0].profileName == "Acme")
        #expect(decoded.workspaces[0].profileEmail == "dev@acme.example")
    }
}
