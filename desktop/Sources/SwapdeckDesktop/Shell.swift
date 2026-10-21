import Foundation
import SwapdeckCore

struct ProcessResult: Sendable {
    let status: Int32
    let output: String
    let error: String
}

/// Runs `open` and `osascript` off the main thread (osascript may wait for the
/// user to answer macOS's permission prompt). No shell is involved: the
/// executable and each argument are passed as they are.
enum Shell {
    static func run(_ executable: String, _ arguments: [String]) async -> ProcessResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                let outPipe = Pipe()
                let errPipe = Pipe()
                process.standardOutput = outPipe
                process.standardError = errPipe
                do {
                    try process.run()
                } catch {
                    continuation.resume(returning: ProcessResult(status: -1, output: "", error: error.localizedDescription))
                    return
                }
                let out = outPipe.fileHandleForReading.readDataToEndOfFile()
                let err = errPipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                continuation.resume(returning: ProcessResult(
                    status: process.terminationStatus,
                    output: String(decoding: out, as: UTF8.self).trimmingCharacters(in: .newlines),
                    error: String(decoding: err, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                ))
            }
        }
    }

    static func run(_ command: LaunchCommand) async -> ProcessResult {
        await run(command.executable, command.arguments)
    }

    enum ScriptOutcome: Sendable {
        case ok(String)
        case denied
        case failed(String)
    }

    static func appleScript(_ source: String) async -> ScriptOutcome {
        let result = await run("/usr/bin/osascript", ["-e", source])
        if result.status == 0 { return .ok(result.output) }
        return BrowserScript.isPermissionDenied(result.error) ? .denied : .failed(result.error)
    }
}
