import AppKit
import SwapdeckCore
import SwiftUI

/// Menu bar item, switcher popover, manager window and the global shortcut.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, NSWindowDelegate {
    let model: AppModel
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var hotkey: Hotkey?
    private var managerWindow: NSWindow?
    private var managerSelection = ManagerSelectionBox()
    private var chooser: NSPanel?
    /// Links that arrived before the app finished launching (Swapdeck started to open them).
    private var waitingLinks: [URL] = []
    private var launched = false

    init(model: AppModel) {
        self.model = model
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        model.load()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = MenuBarIcon.image()
        item.button?.target = self
        item.button?.action = #selector(statusItemClicked(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        item.button?.setAccessibilityLabel("Swapdeck")
        statusItem = item

        let hosting = NSHostingController(rootView: SwitcherView(model: model))
        hosting.sizingOptions = [.preferredContentSize]
        popover.contentViewController = hosting
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self

        model.onClosePopover = { [weak self] in self?.popover.performClose(nil) }
        model.onShowManager = { [weak self] selection in self?.showManager(selection) }
        model.onHotkeyChange = { [weak self] in self?.applyHotkey() }
        model.onChooseLink = { [weak self] url in self?.showChooser(for: url) }
        applyHotkey()
        launched = true

        if !waitingLinks.isEmpty {
            let links = waitingLinks
            waitingLinks = []
            links.forEach { model.routeLink($0) }
        } else if model.data.workspaces.isEmpty {
            // First run: show where Swapdeck lives.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.showPopover() }
        }
    }

    /// Links from other apps, once Swapdeck is the default browser. ⌥ held: always ask.
    func application(_ application: NSApplication, open urls: [URL]) {
        let choose = NSEvent.modifierFlags.contains(.option)
        for url in urls {
            if launched { model.routeLink(url, choose: choose) } else { waitingLinks.append(url) }
        }
    }

    // MARK: Link chooser

    private func showChooser(for url: URL) {
        chooser?.close()
        let panel = ChooserPanel(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 300),
            styleMask: [.titled, .fullSizeContentView, .closable],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: ChooserView(model: model, url: url) { [weak panel] in panel?.close() })
        panel.contentView = hosting
        panel.setContentSize(hosting.fittingSize)
        // Near the pointer, where the link was clicked.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let visible = screen?.visibleFrame {
            let size = panel.frame.size
            let x = min(max(mouse.x - size.width / 2, visible.minX + 12), visible.maxX - size.width - 12)
            let y = min(max(mouse.y - size.height - 12, visible.minY + 12), visible.maxY - size.height - 12)
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
        chooser = panel
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showManager(nil)
        return true
    }

    // MARK: Popover

    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else if popover.isShown {
            popover.performClose(sender)
        } else {
            showPopover()
        }
    }

    func showPopover() {
        guard let button = statusItem?.button else { return }
        model.query = ""
        model.refreshProfiles()
        NSApp.activate()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        Task { await model.refreshWindows() }
    }

    private func showMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: model.t("switcher.manage"), action: #selector(openManagerFromMenu), keyEquivalent: ",").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: model.t("switcher.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem?.menu = menu
        statusItem?.button?.performClick(nil)
        statusItem?.menu = nil
    }

    @objc private func openManagerFromMenu() {
        showManager(nil)
    }

    private func applyHotkey() {
        hotkey?.unregister()
        hotkey = Hotkey(model.data.settings.hotkey) { [weak self] in
            guard let self else { return }
            if self.popover.isShown { self.popover.performClose(nil) } else { self.showPopover() }
        }
    }

    // MARK: Manager window

    func showManager(_ selection: ManagerSelection?) {
        popover.performClose(nil)
        let target = selection ?? managerSelection.value ?? model.workspaces.first.map { .workspace($0.id) } ?? .settings
        managerSelection.value = target
        if managerWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 900, height: 640),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.title = "Swapdeck"
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 760, height: 520)
            window.delegate = self
            window.contentView = NSHostingView(rootView: ManagerRoot(model: model, box: managerSelection))
            window.center()
            window.setFrameAutosaveName("SwapdeckManager")
            managerWindow = window
        }
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        managerWindow?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        // Back to a menu bar only app once the manager is closed.
        NSApp.setActivationPolicy(.accessory)
    }
}

/// The manager's selected page, shared with the window's SwiftUI root.
@MainActor @Observable
final class ManagerSelectionBox {
    var value: ManagerSelection?
}

private struct ManagerRoot: View {
    let model: AppModel
    @Bindable var box: ManagerSelectionBox

    var body: some View {
        ManagerView(model: model, selection: $box.value)
    }
}

/// A floating panel that takes the keyboard (for the link chooser).
final class ChooserPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func cancelOperation(_ sender: Any?) {
        close()
    }
}

