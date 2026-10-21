import AppKit
import SwapdeckCore
import SwiftUI

/// Draws the main views with sample data to PNG files (for checking the design
/// and for the README), without touching the browser or the real data file.
@MainActor
enum PreviewRenderer {
    static func render(to folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        _ = NSApplication.shared
        for language in [LanguagePreference.vi, .en] {
            for dark in [false, true] {
                let suffix = "\(language.rawValue)-\(dark ? "dark" : "light")"
                let model = sampleModel(language: language)
                snapshot(SwitcherView(model: model), width: 360, height: nil, dark: dark, to: folder.appendingPathComponent("switcher-\(suffix).png"))
                snapshot(
                    ManagerView(model: model, selection: .constant(.workspace(model.workspaces[0].id))),
                    width: 900, height: 760, dark: dark,
                    to: folder.appendingPathComponent("manager-\(suffix).png")
                )
            }
        }
        let model = sampleModel(language: .vi)
        snapshot(ManagerView(model: model, selection: .constant(.settings)), width: 900, height: 760, dark: false,
                 to: folder.appendingPathComponent("settings-vi-light.png"))
        snapshot(ManagerView(model: model, selection: .constant(.importing)), width: 900, height: 640, dark: false,
                 to: folder.appendingPathComponent("import-vi-light.png"))
        let empty = sampleModel(language: .vi, empty: true)
        snapshot(SwitcherView(model: empty), width: 360, height: nil, dark: false, to: folder.appendingPathComponent("switcher-empty-vi.png"))
        let denied = sampleModel(language: .vi)
        denied.automation = .denied
        denied.frontId = nil
        denied.openIds = []
        snapshot(SwitcherView(model: denied), width: 360, height: nil, dark: false, to: folder.appendingPathComponent("switcher-denied-vi.png"))
        for (language, dark) in [(LanguagePreference.vi, false), (.en, true)] {
            let chooserModel = sampleModel(language: language)
            snapshot(
                ChooserView(model: chooserModel, url: URL(string: "https://app.globex.example/invoices/42?tab=paid")!) {},
                width: 380, height: nil, dark: dark,
                to: folder.appendingPathComponent("chooser-\(language.rawValue)-\(dark ? "dark" : "light").png")
            )
        }
        let acmeEditor = sampleModel(language: .vi)
        snapshot(ManagerView(model: acmeEditor, selection: .constant(.workspace("ws_acme"))), width: 900, height: 1180, dark: false,
                 to: folder.appendingPathComponent("editor-acme-vi-light.png"))
        let icon = MenuBarIcon.image()
        if let tiff = icon.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
            try? rep.representation(using: .png, properties: [:])?.write(to: folder.appendingPathComponent("menubar-icon.png"))
        }
    }

    /// The app icon on Apple's grid: the mark at 824 px, centered on 1024 px, with a soft shadow.
    static func renderIcon(to url: URL) {
        _ = NSApplication.shared
        let icon = ZStack {
            MarkView(size: 824)
                .clipShape(RoundedRectangle(cornerRadius: 185, style: .continuous))
                .shadow(color: .black.opacity(0.28), radius: 14, y: 10)
        }
        .frame(width: 1024, height: 1024)
        let renderer = ImageRenderer(content: icon)
        renderer.scale = 1
        guard let image = renderer.cgImage else { return }
        let rep = NSBitmapImageRep(cgImage: image)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    static func snapshot<V: View>(_ view: V, width: CGFloat, height: CGFloat?, dark: Bool, to url: URL) {
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let hosting = NSHostingView(rootView: view.frame(width: width).environment(\.colorScheme, dark ? .dark : .light))
        hosting.appearance = appearance
        let size = CGSize(width: width, height: height ?? hosting.fittingSize.height)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = appearance
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return }
        rep.size = hosting.bounds.size
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    static func sampleModel(language: LanguagePreference, empty: Bool = false) -> AppModel {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("swapdeck-preview-\(UUID().uuidString)")
        let defaults = UserDefaults(suiteName: "swapdeck-preview") ?? .standard
        let model = AppModel(
            store: DataStore(fileURL: folder.appendingPathComponent("workspaces.json")),
            applicationSupport: folder,
            defaults: defaults,
            offline: true
        )
        model.automation = .allowed
        model.installedBrowsers = [.chrome, .brave]
        model.profiles[.chrome] = [
            BrowserProfile(directory: "Default", name: "Cá nhân", email: "minh.home@example.com", color: "#2f4e86"),
            BrowserProfile(directory: "Profile 1", name: "Công ty", email: "minh@company.example", color: "#c8402b"),
            BrowserProfile(directory: "Profile 3", name: "Acme", email: "dev@acme.example", color: "#94661a"),
            BrowserProfile(directory: "Profile 4", name: "Side", color: "#1f6b52"),
            BrowserProfile(directory: "Profile 5", name: "Globex", color: "#8c2f55"),
        ]
        let vi = language != .en
        var data = DesktopData(settings: DesktopSettings(language: language))
        if !empty {
            let now = Date()
            data.workspaces = [
                Workspace(
                    id: "ws_company", name: vi ? "Công ty" : "Company", color: "#c8402b", symbol: "building",
                    note: vi ? "Tài khoản công việc chính" : "Main work accounts",
                    profileDirectory: "Profile 1",
                    links: [
                        WorkspaceLink(title: "Supabase", url: "https://supabase.com/dashboard/projects"),
                        WorkspaceLink(title: "Vercel", url: "https://vercel.com/dashboard"),
                        WorkspaceLink(title: "GitHub", url: "https://github.com/"),
                    ],
                    order: 0, lastOpenedAt: now.addingTimeInterval(-600), openCount: 42
                ),
                Workspace(
                    id: "ws_acme", name: vi ? "Khách hàng Acme" : "Client Acme", color: "#94661a", symbol: "handshake",
                    profileDirectory: "Profile 3",
                    links: [
                        WorkspaceLink(title: "Acme admin", url: "https://app.acme.example/admin"),
                        WorkspaceLink(title: "Supabase", url: "https://supabase.com/dashboard/project/acme"),
                    ],
                    linkRules: ["acme.example"],
                    order: 1, lastOpenedAt: now.addingTimeInterval(-7200), openCount: 17
                ),
                Workspace(id: "ws_me", name: vi ? "Cá nhân" : "Personal", color: "#2f4e86", symbol: "house",
                          profileDirectory: "Default", order: 2, openCount: 9),
                Workspace(id: "ws_side", name: vi ? "Dự án phụ" : "Side project", color: "#1f6b52", symbol: "rocket",
                          profileDirectory: "Profile 4",
                          links: [WorkspaceLink(title: "Landing page", url: "https://sideproject.example/")], order: 3),
                Workspace(id: "ws_globex", name: "Globex", color: "#8c2f55", order: 4),
            ]
            model.frontId = "ws_company"
            model.openIds = ["ws_company", "ws_me"]
        }
        model.data = data
        return model
    }
}
