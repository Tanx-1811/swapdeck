import Carbon.HIToolbox
import SwapdeckCore

/// A system-wide shortcut (Carbon hot key: no Accessibility permission needed).
@MainActor
final class Hotkey {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: @MainActor () -> Void
    nonisolated(unsafe) private static var current: Hotkey?

    init?(_ choice: HotkeyChoice, action: @escaping @MainActor () -> Void) {
        guard let (keyCode, modifiers) = Self.keys(for: choice) else { return nil }
        self.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        // Hot key events arrive on the main thread's event loop.
        let installed = InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            MainActor.assumeIsolated { Hotkey.current?.action() }
            return noErr
        }, 1, &spec, nil, &handler)
        let id = EventHotKeyID(signature: OSType(0x5357_4450), id: 1) // "SWDP"
        let registered = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), id, GetApplicationEventTarget(), 0, &hotKey)
        guard installed == noErr, registered == noErr else {
            unregister()
            return nil
        }
        Self.current = self
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
        hotKey = nil
        handler = nil
        if Self.current === self { Self.current = nil }
    }

    private static func keys(for choice: HotkeyChoice) -> (Int, Int)? {
        switch choice {
        case .controlOptionB: (kVK_ANSI_B, controlKey | optionKey)
        case .controlOptionCommandB: (kVK_ANSI_B, controlKey | optionKey | cmdKey)
        case .optionShiftSpace: (kVK_Space, optionKey | shiftKey)
        case .off: nil
        }
    }
}
