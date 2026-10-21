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

    init(model: AppModel) {
        self.model = model
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.load()
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
        applyHotkey()

        // First run: show where Swapdeck lives.
        if model.data.workspaces.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.showPopover() }
        }
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
