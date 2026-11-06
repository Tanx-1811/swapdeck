import Foundation
import Testing
@testable import SwapdeckCore
@testable import SwapdeckDesktop

/// Drives the real AppModel against a fake Application Support folder: Chrome counts as
/// installed, its "Local State" is written by the test, no browser is launched, no
/// AppleScript runs (automation is never allowed here) and secrets stay in memory.
@MainActor
@Suite("App model")
final class AppModelTests {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("swapdeck-app-\(UUID().uuidString)")
    let suite = "swapdeck-app-tests-\(UUID().uuidString)"
    var support: URL { base.appendingPathComponent("Application Support") }
    var dataFile: URL { base.appendingPathComponent("workspaces.json") }

    deinit {
        try? FileManager.default.removeItem(at: base)
        UserDefaults().removePersistentDomain(forName: suite)
    }

    func writeLocalState(_ profiles: [(dir: String, name: String, email: String)]) throws {
        var cache: [String: Any] = [:]
        for profile in profiles { cache[profile.dir] = ["name": profile.name, "user_name": profile.email] }
        let root: [String: Any] = ["profile": ["info_cache": cache, "profiles_order": profiles.map(\.dir)]]
        let url = BrowserKind.chrome.localStateURL(applicationSupport: support)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: root).write(to: url)
    }

    func makeModel(secrets: SecretStore = MemorySecretStore()) -> AppModel {
        AppModel(
            store: DataStore(fileURL: dataFile),
            applicationSupport: support,
            defaults: UserDefaults(suiteName: suite)!,
            offline: false,
            secrets: secrets,
            tickets: TerminalTickets(directory: base.appendingPathComponent("tickets")),
            browserInstalled: { $0 == .chrome }
        )
    }

    /// README: "Bấm Ghép lại hồ sơ bất cứ lúc nào (ví dụ sau khi đăng nhập Chrome)".
    @Test func matchProfilesAgainFindsTheWorkspacesProfileAfterSigningIn() throws {
        // New Mac: "Profile 1" is Globex's profile here.
        try writeLocalState([("Default", "Personal", "me@home.example"), ("Profile 1", "Globex", "dev@globex.example")])
        let model = makeModel()
        model.refreshProfiles()
        // Exported on the old Mac, where Acme lived in "Profile 1".
        let exported = try DataFile.encode(DesktopData(workspaces: [Workspace(
            id: "ws_acme", name: "Acme", profileDirectory: "Profile 1", profileName: "Acme", profileEmail: "dev@acme.example"
        )]))
        let result = try model.importDesktopFile(exported)
        #expect(result.missing == 1)
        // It doesn't point at Globex's folder: opening it asks for a profile instead.
        #expect(model.workspace("ws_acme")?.profileDirectory == "")
        #expect(model.profileStatus(try #require(model.workspace("ws_acme"))) == .unassigned)
        // The menu opens (AppDelegate.showPopover → refreshProfiles): Acme still remembers its account.
        model.refreshProfiles()
        #expect(model.workspace("ws_acme")?.profileEmail == "dev@acme.example")
        // The user signs in to Chrome with the Acme account in a new profile, then presses "Match profiles again".
        try writeLocalState([
            ("Default", "Personal", "me@home.example"), ("Profile 1", "Globex", "dev@globex.example"),
            ("Profile 2", "Acme", "dev@acme.example"),
        ])
        #expect(model.rematchProfiles() == 1)
        #expect(model.workspace("ws_acme")?.profileDirectory == "Profile 2")
    }

    @Test func refreshingKeepsWhatAWorkspaceRemembersWhenItsFolderChangedHands() throws {
        try writeLocalState([("Profile 1", "Acme", "dev@acme.example")])
        let model = makeModel()
        model.refreshProfiles()
        model.data.workspaces = [Workspace(id: "a", name: "Acme", profileDirectory: "Profile 1")]
        model.refreshProfiles()
        // Nothing remembered yet: filled from the profile.
        #expect(model.workspace("a")?.profileEmail == "dev@acme.example")
        // Renamed in Chrome: still the same account, so the new name is remembered.
        try writeLocalState([("Profile 1", "Acme Corp", "dev@acme.example")])
        model.refreshProfiles()
        #expect(model.workspace("a")?.profileName == "Acme Corp")
        // The folder now holds someone else's profile: what Acme remembers stays.
        try writeLocalState([("Profile 1", "Globex", "dev@globex.example")])
        model.refreshProfiles()
        #expect(model.workspace("a")?.profileEmail == "dev@acme.example")
        #expect(model.workspace("a")?.profileName == "Acme Corp")
    }

    /// Chrome names signed-in profiles after the account's first name: two "Tan" profiles are common.
    @Test func importingProfilesGivesEachWorkspaceItsOwnName() throws {
        try writeLocalState([("Default", "Tan", "tan@acme.example"), ("Profile 1", "Tan", "tan@globex.example")])
        let model = makeModel()
        model.refreshProfiles()
        #expect(model.importProfiles(.chrome) == 2)
        #expect(model.data.workspaces.map(\.name) == ["Tan", "Tan 2"])
    }

    @Test func aWorkspaceIsNeverRenamedToNothingOrToAnotherOnesName() throws {
        let model = makeModel()
        model.data.workspaces = [Workspace(id: "a", name: "Acme"), Workspace(id: "g", name: "Globex")]
        #expect(model.rename("a", to: "   ") == .empty)
        #expect(model.rename("a", to: "globex") == .taken(by: "Globex"))
        #expect(model.workspace("a")?.name == "Acme")
        #expect(model.rename("a", to: "  Acme Corp  ") == .ok)
        #expect(model.workspace("a")?.name == "Acme Corp")
        #expect(model.rename("a", to: String(repeating: "x", count: 120)) == .ok)
        #expect(model.workspace("a")?.name.count == Limits.name)
        // update() never changes the name (the editor goes through rename).
        var renamed = try #require(model.workspace("g"))
        renamed.name = ""
        model.update(renamed)
        #expect(model.workspace("g")?.name == "Globex")
    }

    @Test func choosingAnotherProfileGivesTheWorkspaceANewWindow() throws {
        try writeLocalState([("Profile 1", "Acme", "dev@acme.example"), ("Profile 3", "Acme new", "")])
        let model = makeModel()
        model.refreshProfiles()
        model.data.workspaces = [Workspace(id: "a", name: "Acme", profileDirectory: "Profile 1", profileName: "Acme",
                                           profileEmail: "dev@acme.example")]
        var moved = try #require(model.workspace("a"))
        moved.profileDirectory = "Profile 3"
        model.update(moved)
        #expect(model.profileChanged.contains("a"))
        #expect(model.workspace("a")?.profileName == "Acme new")
        #expect(model.workspace("a")?.profileEmail == "")
    }

    @Test func deletingAWorkspaceRemovesAllOfItsTokens() throws {
        let secrets = MemorySecretStore(["a/GH_TOKEN": "ghp_1", "a/OLD_NAME": "left behind", "g/GH_TOKEN": "ghp_2"])
        let model = makeModel(secrets: secrets)
        model.data.workspaces = [
            Workspace(id: "a", name: "Acme", cliVariables: [CLIVariable(name: "GH_TOKEN")]),
            Workspace(id: "g", name: "Globex", cliVariables: [CLIVariable(name: "GH_TOKEN")]),
        ]
        model.delete("a")
        #expect(try secrets.workspaceIds() == ["g"])
        #expect(try secrets.value(workspace: "g", name: "GH_TOKEN") == "ghp_2")
    }

    @Test func launchSweepsTheTokensOfDeletedWorkspacesOnlyWhenTheDataWasRead() throws {
        let secrets = MemorySecretStore(["a/GH_TOKEN": "ghp_1", "gone/GH_TOKEN": "ghp_old"])
        try DataStore(fileURL: dataFile).save(DesktopData(workspaces: [Workspace(id: "a", name: "Acme")]))
        makeModel(secrets: secrets).load()
        #expect(try secrets.workspaceIds() == ["a"])
        // A file that can't be read keeps every token.
        let kept = MemorySecretStore(["a/GH_TOKEN": "ghp_1"])
        try Data("garbage".utf8).write(to: dataFile)
        makeModel(secrets: kept).load()
        #expect(try kept.workspaceIds() == ["a"])
    }

    @Test func typedTokensAndEditsAreWrittenBeforeQuittingOrOpeningATerminal() throws {
        let secrets = MemorySecretStore()
        let model = makeModel(secrets: secrets)
        model.data.workspaces = [Workspace(id: "a", name: "Acme", cliVariables: [CLIVariable(name: "GH_TOKEN")])]
        let acme = try #require(model.workspace("a"))
        model.stageSecret("ghp_typed", name: "GH_TOKEN", in: acme)
        #expect(model.secretValue("GH_TOKEN", in: acme) == "ghp_typed")
        #expect(try secrets.value(workspace: "a", name: "GH_TOKEN") == nil)
        var edited = acme
        edited.note = "billing owner"
        model.update(edited)
        model.flushPendingWrites()
        #expect(try secrets.value(workspace: "a", name: "GH_TOKEN") == "ghp_typed")
        #expect(DataStore(fileURL: dataFile).load().workspaces.first?.note == "billing owner")
    }

    @Test func aLinkForAWorkspaceWithoutAProfileGoesToTheChooser() throws {
        try writeLocalState([("Default", "Personal", "")])
        let model = makeModel()
        model.refreshProfiles()
        var acme = Workspace(id: "a", name: "Acme")
        acme.linkRules = ["acme.example"]
        model.data.workspaces = [acme]
        var chosen: [URL] = []
        model.onChooseLink = { chosen.append($0) }
        let link = URL(string: "https://app.acme.example/invoices/42")!
        model.routeLink(link)
        #expect(chosen == [link])
    }
}
