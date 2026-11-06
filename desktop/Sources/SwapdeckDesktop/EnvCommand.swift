import Foundation
import LocalAuthentication
import SwapdeckCore

/// `--env <workspace> [--ticket <t>]`: `export` lines for a workspace's terminal variables
/// (values from the Keychain), for `eval` in a shell. Prints nothing else on stdout.
///
/// The Keychain trusts this app, so anything that can run it could ask for the tokens:
/// `--env` hands them over only with a single-use ticket from "Open in Terminal"
/// (`TerminalTickets`), or after Touch ID / the Mac's password. When a declared variable
/// can't be read, nothing is printed and the exit status says so.
enum EnvCommand {
    static func run(arguments: [String]) -> Int32 {
        guard let index = arguments.firstIndex(of: "--env"), index + 1 < arguments.count else { return 2 }
        let key = arguments[index + 1]
        let ticket = arguments.firstIndex(of: "--ticket").flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil }
        let data = DataStore.standard().peek()
        let t = Translator(Language.resolve(data.settings.language))
        guard let workspace = TerminalEnv.workspace(for: key, in: data) else {
            fail(t("env.noWorkspace", ["name": key]))
            return 1
        }
        if workspace.cliVariables.isEmpty { return 0 }
        let redeemed = ticket.map { TerminalTickets.standard().redeem($0, workspaceId: workspace.id) } ?? false
        if !redeemed, !authenticate(reason: t("env.authReason", ["name": workspace.name])) {
            fail(t("env.notAllowed", ["name": workspace.name]))
            return 1
        }
        do {
            let script = try TerminalEnv.environment(of: workspace, secrets: KeychainSecretStore())
            FileHandle.standardOutput.write(Data(script.utf8))
            return 0
        } catch let error as UnreadableVariable {
            fail(t("env.unreadable", ["name": error.name, "detail": "\(error.underlying)"]))
            return 1
        } catch {
            fail("\(error)")
            return 1
        }
    }

    private static func fail(_ message: String) {
        FileHandle.standardError.write(Data("Swapdeck Desktop: \(message)\n".utf8))
    }

    /// Touch ID, else the Mac's password (`deviceOwnerAuthentication`). False when the user
    /// cancels or this Mac can't ask.
    private static func authenticate(reason: String) -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        let answer = Answer()
        let done = DispatchSemaphore(value: 0)
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
            answer.set(success)
            done.signal()
        }
        done.wait()
        return answer.value
    }

    /// The answer of the authentication callback (it arrives on another queue).
    private final class Answer: @unchecked Sendable {
        private let lock = NSLock()
        private var stored = false
        var value: Bool { lock.withLock { stored } }
        func set(_ value: Bool) { lock.withLock { stored = value } }
    }
}
