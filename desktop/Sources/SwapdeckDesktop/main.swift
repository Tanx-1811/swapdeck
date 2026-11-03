import AppKit
import SwapdeckCore

// `--render-previews <folder>` draws the main views with sample data to PNG
// files (light and dark, Vietnamese and English) and exits.
MainActor.assumeIsolated {
    let arguments = CommandLine.arguments
    if let index = arguments.firstIndex(of: "--render-previews"), index + 1 < arguments.count {
        PreviewRenderer.render(to: URL(fileURLWithPath: arguments[index + 1]))
        exit(0)
    }
    // `--env <workspace>`: `export` lines for a workspace's terminal variables (values from
    // the Keychain), for `eval "$(… --env acme)"` in any terminal; prints nothing else.
    if let index = arguments.firstIndex(of: "--env"), index + 1 < arguments.count {
        let store = DataStore.standard()
        let data = (try? Data(contentsOf: store.fileURL)).flatMap { try? DataFile.decode($0) } ?? DesktopData()
        guard let script = TerminalEnv.environment(for: arguments[index + 1], in: data, secrets: KeychainSecretStore()) else {
            FileHandle.standardError.write(Data("Swapdeck Desktop: no workspace \"\(arguments[index + 1])\"\n".utf8))
            exit(1)
        }
        FileHandle.standardOutput.write(Data(script.utf8))
        exit(0)
    }
    // `--render-icon <file.png>`: the 1024 px app icon (used by scripts/build-app.sh).
    if let index = arguments.firstIndex(of: "--render-icon"), index + 1 < arguments.count {
        PreviewRenderer.renderIcon(to: URL(fileURLWithPath: arguments[index + 1]))
        exit(0)
    }
    let app = NSApplication.shared
    let delegate = AppDelegate(model: .standard())
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
