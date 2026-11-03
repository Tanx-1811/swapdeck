import Foundation
import Testing
@testable import SwapdeckCore

@Suite("A terminal per workspace")
struct TerminalTests {
    /// What /bin/sh makes of a quoted value: it must come back exactly, nothing run.
    private func shellEcho(_ quoted: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "printf %s \(quoted)"]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        process.waitUntilExit()
        return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    }

    @Test func quotesValuesSoTheShellRunsNothing() throws {
        for value in ["plain", "it's", "$(touch /tmp/nope)", "`id`", "a\nb", "back\\slash", "\"quoted\"", "", "'"] {
            let echoed = try shellEcho(TerminalEnv.shellQuote(value))
            #expect(echoed == value)
        }
    }

    @Test func refusesNamesThatCouldTakeOverTheShell() {
        for name in ["SUPABASE_ACCESS_TOKEN", "GH_TOKEN", "aws_profile", "_X", "A1"] {
            #expect(TerminalEnv.isAllowedName(name), "\(name)")
        }
        for name in ["", "1ABC", "MY-VAR", "MY VAR", "PATH", "path", "HOME", "IFS", "PROMPT_COMMAND", "BASH_ENV",
                     "DYLD_INSERT_LIBRARIES", "LD_PRELOAD", "ZDOTDIR", String(repeating: "A", count: 65), "Ä"] {
            #expect(!TerminalEnv.isAllowedName(name), "\(name)")
        }
        #expect(!TerminalEnv.isAllowedValue("a\0b"))
        #expect(!TerminalEnv.isAllowedValue(String(repeating: "x", count: 8193)))
    }

    @Test func exportsOnlyWhatIsAllowed() {
        let script = TerminalEnv.exports([
            (name: "SUPABASE_ACCESS_TOKEN", value: "sbp_1'2"),
            (name: "PATH", value: "/evil"),
            (name: "AWS_PROFILE", value: "acme"),
        ])
        #expect(script == "export SUPABASE_ACCESS_TOKEN='sbp_1'\\''2'\nexport AWS_PROFILE='acme'\n")
        #expect(TerminalEnv.exports([]) == "")
    }

    @Test func theTerminalScriptHoldsNoSecretAndRemovesItself() {
        let app = "/Applications/Swapdeck Desktop.app/Contents/MacOS/Swapdeck Desktop"
        let script = TerminalEnv.commandFile(executable: app, workspaceId: "ws_acme", title: "Acme\n$(evil)", folder: "/Users/me/Acme Co")
        #expect(script.hasPrefix("#!/bin/sh\n"))
        #expect(script.contains("rm -f -- \"$0\""))
        #expect(script.contains("eval \"$('\(app)' --env 'ws_acme')\" || exit 1"))
        #expect(script.contains("cd -- '/Users/me/Acme Co' 2>/dev/null"))
        // The title can't add a line or run anything.
        #expect(script.contains("printf '\\033]0;%s\\007' 'Acme$(evil)'"))
        #expect(script.hasSuffix("exec \"${SHELL:-/bin/zsh}\" -l\n"))
        #expect(!TerminalEnv.commandFile(executable: app, workspaceId: "ws_acme", title: "A", folder: "").contains("cd --"))
        #expect(TerminalEnv.evalLine(executable: "/A B/x", workspaceId: "ws_1") == "eval \"$('/A B/x' --env 'ws_1')\"")
    }

    @Test func theTerminalScriptLoadsTheVariablesAndOpensTheFolder() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("swapdeck-test-\(UUID().uuidString)")
        let folder = base.appendingPathComponent("Acme Co")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        func script(_ name: String, _ body: String) throws -> URL {
            let url = base.appendingPathComponent(name)
            try Data(body.utf8).write(to: url)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
            return url
        }
        // Stand-ins for the app (`--env`) and for the user's shell.
        let app = try script("Swapdeck Desktop", "#!/bin/sh\n[ \"$1 $2\" = \"--env ws_1\" ] && printf \"export TOKEN='a b'\\n\"\n")
        let shell = try script("fake-shell", "#!/bin/sh\nprintf '|%s|%s' \"$TOKEN\" \"$(pwd -P)\"\n")
        let command = try script("terminal.command", TerminalEnv.commandFile(
            executable: app.path, workspaceId: "ws_1", title: "Acme", folder: folder.path
        ))
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [command.path]
        process.environment = ["SHELL": shell.path, "PATH": "/usr/bin:/bin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        process.waitUntilExit()
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        // The shell got the variable and starts in the folder (/var is /private/var on macOS).
        #expect(output.contains("|a b|"))
        #expect(output.hasSuffix("\(folder.lastPathComponent)") && output.contains(base.lastPathComponent))
        #expect(output.contains("\u{1b}]0;Acme\u{07}"))
        #expect(!FileManager.default.fileExists(atPath: command.path))
    }

    @Test func findsTheWorkspaceByIdOrNameAndPrintsItsValues() throws {
        let data = DesktopData(workspaces: [
            Workspace(id: "ws_acme", name: "Khách hàng Acme", cliVariables: [
                CLIVariable(name: "SUPABASE_ACCESS_TOKEN"), CLIVariable(name: "AWS_PROFILE", secret: false),
                CLIVariable(name: "VERCEL_TOKEN"),
            ]),
        ])
        let secrets = MemorySecretStore()
        try secrets.set("sbp_x", workspace: "ws_acme", name: "SUPABASE_ACCESS_TOKEN")
        try secrets.set("acme", workspace: "ws_acme", name: "AWS_PROFILE")
        let expected = "export SUPABASE_ACCESS_TOKEN='sbp_x'\nexport AWS_PROFILE='acme'\n"
        #expect(TerminalEnv.environment(for: "ws_acme", in: data, secrets: secrets) == expected)
        #expect(TerminalEnv.environment(for: "khach hang acme", in: data, secrets: secrets) == expected)
        #expect(TerminalEnv.environment(for: "nobody", in: data, secrets: secrets) == nil)
        try secrets.removeAll(workspace: "ws_acme", names: ["SUPABASE_ACCESS_TOKEN", "AWS_PROFILE"])
        #expect(TerminalEnv.environment(for: "ws_acme", in: data, secrets: secrets) == "")
    }

    @Test func keepsTheFolderAbsolute() {
        #expect(TerminalEnv.normalizedFolder("~/Projects/acme/", home: "/Users/me") == "/Users/me/Projects/acme")
        #expect(TerminalEnv.normalizedFolder("~", home: "/Users/me") == "/Users/me")
        #expect(TerminalEnv.normalizedFolder("  ") == "")
        #expect(TerminalEnv.normalizedFolder("relative/path") == nil)
        #expect(TerminalEnv.normalizedFolder("/") == "/")
    }

    @Test func savesVariableNamesButNeverValues() throws {
        var data = DesktopData()
        data.settings.terminalApp = .iterm
        data.workspaces = [Workspace(
            id: "ws_acme", name: "Acme",
            cliVariables: [CLIVariable(name: "GH_TOKEN"), CLIVariable(name: "AWS_PROFILE", secret: false)],
            terminalFolder: "/Users/me/acme"
        )]
        let decoded = try DataFile.decode(try DataFile.encode(data))
        #expect(decoded.settings.terminalApp == .iterm)
        #expect(decoded.workspaces[0].cliVariables == data.workspaces[0].cliVariables)
        #expect(decoded.workspaces[0].terminalFolder == "/Users/me/acme")
        // Hand-edited files: bad names and folders are dropped.
        let raw = Data(#"""
        {"format":"swapdeck-desktop","version":1,"settings":{"terminalApp":"hyper"},"workspaces":[
          {"id":"ws_1","name":"One","cliVariables":[{"name":"PATH"},{"name":"GH_TOKEN"},{"name":"GH_TOKEN"},{"name":"X"}],
           "terminalFolder":"relative"}
        ]}
        """#.utf8)
        let file = try DataFile.decode(raw)
        #expect(file.settings.terminalApp == .terminal)
        #expect(file.workspaces[0].cliVariables.map(\.name) == ["GH_TOKEN", "X"])
        let allSecret = file.workspaces[0].cliVariables.allSatisfy { $0.secret }
        #expect(allSecret)
        #expect(file.workspaces[0].terminalFolder == "")
    }

    @Test func presetsAreUniqueAndAllowed() {
        let variables = CLIPresets.all.map(\.variable)
        #expect(Set(variables).count == variables.count)
        let allAllowed = variables.allSatisfy { TerminalEnv.isAllowedName($0) }
        #expect(allAllowed)
        #expect(CLIPresets.preset(for: "AWS_PROFILE")?.secret == false)
    }
}

@Suite("Updates")
struct UpdateTests {
    @Test func readsTheLatestRelease() throws {
        let json = Data(#"""
        {"tag_name":"v1.6.0","html_url":"https://github.com/Tanx-1811/swapdeck/releases/tag/v1.6.0",
         "assets":[{"name":"swapdeck-1.6.0.zip"},{"name":"swapdeck-desktop-1.3.0.zip"},{"name":"other.txt"}]}
        """#.utf8)
        let latest = try #require(Releases.parse(json))
        #expect(latest.desktop == "1.3.0")
        #expect(latest.extensionVersion == "1.6.0")
        #expect(latest.url.absoluteString == "https://github.com/Tanx-1811/swapdeck/releases/tag/v1.6.0")
        // Only this repository's release pages are linked to.
        let elsewhere = Data(#"{"tag_name":"v9.0.0","html_url":"https://evil.example/x","assets":[]}"#.utf8)
        #expect(Releases.parse(elsewhere)?.url == Releases.page)
        #expect(Releases.parse(Data("{}".utf8)) == nil)
        #expect(Releases.parse(Data("nope".utf8)) == nil)
    }

    @Test func comparesVersionsByNumber() {
        #expect(Releases.compare("1.10.0", "1.9.9") > 0)
        #expect(Releases.compare("v1.3.0", "1.3.0") == 0)
        #expect(Releases.compare("1.2.0", "1.3.0") < 0)
        #expect(Releases.compare("garbage", "0.0.1") < 0)
    }
}
