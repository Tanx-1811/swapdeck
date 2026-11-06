import Foundation
import Testing
@testable import SwapdeckCore

// Found in the review of Desktop 1.3.0 (each of these failed on 12eb4a0) and fixed in 1.4.0.

@Suite("Review: the data file keeps what the editor saves")
struct ReviewDataFileTests {
    /// 1.3.0 dropped a workspace whose name was over 80 characters or empty (being retyped) at the next launch.
    @Test func aWorkspaceTheEditorSavedSurvivesTheNextLaunch() throws {
        let longName = "Công ty TNHH Thương mại Dịch vụ Xuất nhập khẩu Kỹ thuật Số Toàn Cầu - Chi nhánh TP.HCM"
        #expect(longName.count > 80)
        let workspaces = [
            Workspace(id: "ws_long", name: longName, cliVariables: [CLIVariable(name: "GH_TOKEN")]),
            Workspace(id: "ws_blank", name: ""),
        ]
        let decoded = try DataFile.decode(DataFile.encode(DesktopData(settings: DesktopSettings(language: .vi), workspaces: workspaces)))
        #expect(decoded.workspaces.map(\.id) == ["ws_long", "ws_blank"])
        #expect(decoded.workspaces[0].name == String(longName.prefix(80)).trimmingCharacters(in: .whitespaces))
        #expect(decoded.workspaces[0].cliVariables.map(\.name) == ["GH_TOKEN"])
        #expect(decoded.workspaces[1].name == "Bên chưa đặt tên")
    }

    /// 1.3.0 wiped a note over 500 characters.
    @Test func aLongNoteIsCutNotWiped() throws {
        let note = String(repeating: "Hợp đồng bảo trì. ", count: 30)
        #expect(note.count > 500)
        let decoded = try DataFile.decode(DataFile.encode(DesktopData(workspaces: [Workspace(id: "ws", name: "A", note: note)])))
        #expect(decoded.workspaces.first?.note == String(note.prefix(500)))
    }

    @Test func namesThatRepeatAreMadeUniqueOnLoad() throws {
        let raw = Data(#"""
        {"format":"swapdeck-desktop","version":1,"workspaces":[
          {"id":"a","name":"Tan"},{"id":"b","name":"tan"},{"id":"c","name":"Tân"},{"id":"d","name":"Line\nbreak"}
        ]}
        """#.utf8)
        let names = try DataFile.decode(raw).workspaces.map(\.name)
        #expect(names == ["Tan", "tan 2", "Tân 3", "Line break"])
    }
}

@Suite("Review: finding the right profile on another Mac")
struct ReviewRematchTests {
    @Test func aMissingWorkspaceDoesNotKeepSomeoneElsesFolder() {
        let here: [BrowserKind: [BrowserProfile]] = [.chrome: [
            BrowserProfile(directory: "Default", name: "Personal", email: "me@home.example"),
            BrowserProfile(directory: "Profile 1", name: "Globex", email: "dev@globex.example"),
        ]]
        let acme = Workspace(id: "a", name: "Acme", profileDirectory: "Profile 1", profileName: "Acme", profileEmail: "dev@acme.example")
        let result = WorkspaceLogic.rematch([acme], profiles: here)
        #expect(result.missing == ["a"])
        // Cleared (it would open Globex's profile); what it remembers stays, to be matched later.
        #expect(result.workspaces[0].profileDirectory == "")
        #expect(result.workspaces[0].profileEmail == "dev@acme.example")
        #expect(result.changed.isEmpty)
    }

    @Test func matchingAgainAfterSigningInStillWorksOnceTheProfilesWereRefreshed() {
        var here: [BrowserKind: [BrowserProfile]] = [.chrome: [
            BrowserProfile(directory: "Profile 1", name: "Globex", email: "dev@globex.example"),
        ]]
        func refreshed(_ workspaces: [Workspace]) -> [Workspace] {
            workspaces.map { workspace in
                WorkspaceLogic.refreshedDetails(workspace, profile: here[.chrome]?.first { $0.directory == workspace.profileDirectory })
            }
        }
        let imported = Workspace(id: "a", name: "Acme", profileDirectory: "Profile 1", profileName: "Acme", profileEmail: "dev@acme.example")
        var workspaces = WorkspaceLogic.rematch([imported], profiles: here).workspaces
        workspaces = refreshed(workspaces) // the menu opens
        here[.chrome]!.append(BrowserProfile(directory: "Profile 2", name: "Acme", email: "dev@acme.example"))
        workspaces = refreshed(workspaces)
        let result = WorkspaceLogic.rematch(workspaces, profiles: here)
        #expect(result.workspaces[0].profileDirectory == "Profile 2")
        // Even when the folder wasn't cleared: refreshing never takes the folder's new owner for the workspace.
        let kept = refreshed([imported])
        #expect(kept[0].profileEmail == "dev@acme.example" && kept[0].profileName == "Acme")
    }

    @Test func onlyAFolderThatIsSurelySomeoneElsesIsCleared() {
        let here: [BrowserKind: [BrowserProfile]] = [.chrome: [
            BrowserProfile(directory: "Profile 1", name: "Acme Corp"),
            BrowserProfile(directory: "Profile 2", name: "Person 2", usesDefaultName: true),
        ]]
        // Same Mac, profile renamed in Chrome (nobody signed in): it may well be the same profile.
        let renamed = Workspace(id: "r", name: "Acme", profileDirectory: "Profile 1", profileName: "Acme")
        // Just imported from another Mac: "Profile 2" here is whatever profile has that folder on this Mac,
        // and "Profile 6" a folder this Mac doesn't have yet (Chrome could create someone else's there).
        let foreign = Workspace(id: "f", name: "Globex", profileDirectory: "Profile 2", profileName: "Globex")
        let unlisted = Workspace(id: "u", name: "Initech", profileDirectory: "Profile 6", profileName: "Initech")
        let result = WorkspaceLogic.rematch([renamed, foreign, unlisted], profiles: here, imported: ["f", "u"])
        #expect(result.workspaces.map(\.profileDirectory) == ["Profile 1", "", ""])
        #expect(result.missing == ["r", "f", "u"])
        // A browser whose profiles couldn't be read changes nothing.
        let unread = WorkspaceLogic.rematch([foreign], profiles: [:], imported: ["f"])
        #expect(unread.workspaces[0].profileDirectory == "Profile 2")
    }

    @Test func twoWorkspacesAreNotGivenTheSameProfile() {
        let here: [BrowserKind: [BrowserProfile]] = [.chrome: [
            BrowserProfile(directory: "Profile 1", name: "Work"),
            BrowserProfile(directory: "Profile 2", name: "Work"),
        ]]
        let first = Workspace(id: "a", name: "Acme", profileDirectory: "Profile 7", profileName: "Work")
        let second = Workspace(id: "b", name: "Globex", profileDirectory: "Profile 8", profileName: "Work")
        let result = WorkspaceLogic.rematch([first, second], profiles: here)
        #expect(result.workspaces[0].profileDirectory != result.workspaces[1].profileDirectory)
        #expect(result.missing == ["a", "b"])
    }

    @Test func aNameMatchesOnlyOnceAndNeverABrowserChosenName() {
        let here: [BrowserKind: [BrowserProfile]] = [.chrome: [
            BrowserProfile(directory: "Default", name: "Acme"),
            BrowserProfile(directory: "Profile 1", name: "Person 1", usesDefaultName: true),
            BrowserProfile(directory: "Profile 2", name: "Globex", email: "ops@globex.example"),
        ]]
        // Already on "Default" (it fits): another workspace remembering "Acme" can't take it.
        let fits = Workspace(id: "f", name: "Acme", profileDirectory: "Default", profileName: "Acme")
        let other = Workspace(id: "o", name: "Acme old", profileDirectory: "Profile 9", profileName: "acme")
        // "Person 1" is Chrome's own name: it says nothing about whose profile it is.
        let generic = Workspace(id: "g", name: "Someone", profileDirectory: "Profile 8", profileName: "Person 1")
        // A name never wins over a different Google account.
        let account = Workspace(id: "x", name: "Globex", profileDirectory: "Profile 7", profileName: "Globex", profileEmail: "dev@globex.example")
        let result = WorkspaceLogic.rematch([fits, other, generic, account], profiles: here)
        #expect(result.workspaces.map(\.profileDirectory) == ["Default", "Profile 9", "Profile 8", "Profile 7"])
        #expect(result.missing == ["o", "g", "x"])
        #expect(result.changed.isEmpty)
    }

    @Test func readsWhetherTheBrowserChoseTheName() throws {
        let localState = Data(#"""
        {"profile":{"info_cache":{
          "Default":{"name":"Person 1","is_using_default_name":true},
          "Profile 1":{"name":"Acme","is_using_default_name":false},
          "Profile 2":{"name":""}
        }}}
        """#.utf8)
        let profiles = try ProfileReader.profiles(localState: localState)
        let byDirectory = Dictionary(uniqueKeysWithValues: profiles.map { ($0.directory, $0.usesDefaultName) })
        #expect(byDirectory == ["Default": true, "Profile 1": false, "Profile 2": true])
    }
}

@Suite("Review: a workspace's window")
struct ReviewWindowTests {
    @Test func twoWorkspacesWithTheSameNameDoNotShareAWindow() {
        // Chrome names signed-in profiles after the account's first name.
        let tanAcme = BrowserProfile(directory: "Default", name: "Tan", email: "tan@acme.example")
        let tanGlobex = BrowserProfile(directory: "Profile 1", name: "Tan", email: "tan@globex.example")
        let acme = WorkspaceLogic.workspace(for: tanAcme, browser: .chrome, existing: [])
        let globex = WorkspaceLogic.workspace(for: tanGlobex, browser: .chrome, existing: [acme])
        #expect(acme.name != globex.name)
        // Acme's window, named "Tan" when Acme was opened.
        let windows = [BrowserWindow(id: "1", givenName: "Tan", minimized: false, incognito: false)]
        #expect(WorkspaceLogic.window(for: globex, in: windows) == nil)
        // An export from another Mac can't bring a second "Acme" either.
        let merged = WorkspaceLogic.merge([Workspace(id: "new", name: "TAN")], into: [acme])
        #expect(merged.map(\.name) == ["TAN 2"])
    }

    @Test func aWorkspaceWithoutANameDoesNotTakeAnUnnamedWindow() {
        let blank = Workspace(id: "a", name: "", profileDirectory: "Profile 1")
        let windows = [BrowserWindow(id: "9", givenName: "", minimized: false, incognito: false)]
        #expect(WorkspaceLogic.window(for: blank, in: windows) == nil)
        #expect(WorkspaceLogic.windowState(windows, workspaces: [blank], browser: .chrome).open.isEmpty)
    }

    @Test func namingAWindowTakesTheNameOffAnyOtherWindow() {
        let script = BrowserScript.nameWindow(.chrome, id: "12", name: "Acme")
        #expect(script.contains("if (id of w as text) is \"12\" then"))
        #expect(script.contains("set given name of w to \"Acme\""))
        #expect(script.contains("if (given name of w) is \"Acme\" then set given name of w to \"\""))
        let clear = BrowserScript.clearName(.brave, name: "Khách \"VIP\"")
        #expect(clear.contains("tell application id \"com.brave.Browser\""))
        #expect(clear.contains("if (given name of w) is \"Khách \\\"VIP\\\"\" then set given name of w to \"\""))
    }

    @Test func uniqueNamesStayWithinTheLimit() {
        let long = String(repeating: "a", count: Limits.name)
        let name = WorkspaceLogic.uniqueName(long, existing: [Workspace(name: long)])
        #expect(name.count == Limits.name && name.hasSuffix(" 2"))
    }
}

@Suite("Review: links agree with the extension (src/core/links.ts)")
struct ReviewLinkParityTests {
    /// linkOwner returns null when the best score is shared ("ties mean can't tell").
    @Test func aTieBetweenWorkspacesIsNotDecidedByTheirOrder() {
        let acme = Workspace(id: "a", name: "Acme", links: [WorkspaceLink(title: "Vercel", url: "https://vercel.com/dashboard")])
        let globex = Workspace(id: "g", name: "Globex", links: [WorkspaceLink(title: "Vercel", url: "https://vercel.com/dashboard")])
        #expect(LinkRouter.route(URL(string: "https://vercel.com/dashboard/settings")!, workspaces: [acme, globex]) == nil)
        var a = Workspace(id: "a", name: "Acme"), g = Workspace(id: "g", name: "Globex")
        a.linkRules = ["acme.example"]
        g.linkRules = ["acme.example"]
        #expect(LinkRouter.route(URL(string: "https://acme.example/x")!, workspaces: [a, g]) == nil)
        // A more specific rule still decides.
        g.linkRules.append("acme.example/billing")
        #expect(LinkRouter.route(URL(string: "https://acme.example/billing/7")!, workspaces: [a, g])?.workspaceId == "g")
    }

    /// The extension's pinned pages cover their own path and below (pinCovers), never the whole
    /// host; 1.3.0 turned one pinned GitHub repo into "every github.com link is Acme's".
    @Test func aPinnedPageDoesNotClaimTheWholeSharedSite() {
        let acme = Workspace(id: "a", name: "Acme", links: [WorkspaceLink(title: "Repo", url: "https://github.com/acme/app")])
        let personal = Workspace(id: "p", name: "Personal")
        #expect(LinkRouter.route(URL(string: "https://github.com/acme/app/pull/7")!, workspaces: [acme, personal])?.workspaceId == "a")
        #expect(LinkRouter.route(URL(string: "https://github.com/globex/site/pull/3")!, workspaces: [acme, personal]) == nil)
    }

    /// ruleScore("acme.example/a%20b", "https://acme.example/a%20b") = 6250 in the extension:
    /// paths compare percent-encoded and without dot segments, like a browser's URL.pathname.
    @Test func pathsCompareLikeTheExtension() {
        var workspace = Workspace(id: "a", name: "Acme")
        workspace.linkRules = ["acme.example/a%20b", "acme.example/caf%C3%A9", "acme.example/dashboard"]
        for link in ["https://acme.example/a%20b/c", "https://acme.example/caf%C3%A9", "https://acme.example/café",
                     "https://acme.example/x/../dashboard/1", "https://acme.example/./dashboard"] {
            #expect(LinkRouter.route(URL(string: link)!, workspaces: [workspace]) != nil, "\(link)")
        }
        #expect(LinkRouter.route(URL(string: "https://acme.example/a%2Fb")!, workspaces: [workspace]) == nil)
        // A rule typed with an accent or a space is kept as a link would spell it.
        #expect(LinkRouter.normalize("acme.example/dự án") == "acme.example/d%E1%BB%B1%20%C3%A1n")
        #expect(LinkRouter.normalize("acme.example/a%20b") == "acme.example/a%20b")
        #expect(LinkRouter.removingDotSegments("/a/b/../../c/./d") == "/c/d")
    }
}

@Suite("Review: terminal")
struct ReviewTerminalTests {
    /// 1.3.0's `eval "$(app --env id)" || exit 1` never exited: eval of an empty string succeeds.
    @Test func theTerminalDoesNotOpenWithoutItsVariablesWhenTheyCannotBeLoaded() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("swapdeck-review-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        func script(_ name: String, _ body: String) throws -> URL {
            let url = base.appendingPathComponent(name)
            try Data(body.utf8).write(to: url)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
            return url
        }
        // `--env` failing (Touch ID refused, Keychain unreadable, workspace gone).
        let app = try script("Swapdeck Desktop", "#!/bin/sh\necho 'Swapdeck Desktop: not allowed' >&2\nexit 1\n")
        let shell = try script("fake-shell", "#!/bin/sh\nprintf 'SHELL-STARTED token=[%s]' \"$GH_TOKEN\"\n")
        let command = try script("terminal.command", TerminalEnv.commandFile(
            executable: app.path, workspaceId: "ws_1", ticket: String(repeating: "0", count: 64), title: "Acme", folder: "",
            failure: "TOKENS NOT LOADED"
        ))
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [command.path]
        process.environment = ["SHELL": shell.path, "PATH": "/usr/bin:/bin"]
        let pipe = Pipe(), errors = Pipe()
        process.standardOutput = pipe
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        // Not a window titled "Acme" whose CLIs fall back to the default account.
        #expect(!output.contains("SHELL-STARTED"), "\(output)")
        #expect(process.terminationStatus != 0)
        #expect(String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).contains("TOKENS NOT LOADED"))
    }
}
