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
    // `--env <workspace> [--ticket <t>]`: `export` lines for a workspace's terminal variables
    // (values from the Keychain, after a single-use ticket or Touch ID); prints nothing else.
    if arguments.contains("--env") {
        exit(EnvCommand.run(arguments: arguments))
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
