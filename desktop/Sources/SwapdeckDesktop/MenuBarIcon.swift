import AppKit

/// The menu bar icon: the deck of the mark drawn as a template image (macOS
/// tints it for light, dark and highlighted menu bars).
enum MenuBarIcon {
    static func image() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            // Two cards behind, stepped up and to the right as in the mark.
            NSColor.black.withAlphaComponent(0.45).setFill()
            NSBezierPath(roundedRect: NSRect(x: 8, y: 2, width: 8, height: 8), xRadius: 2, yRadius: 2).fill()
            NSColor.black.withAlphaComponent(0.7).setFill()
            NSBezierPath(roundedRect: NSRect(x: 5, y: 5, width: 8, height: 8), xRadius: 2, yRadius: 2).fill()
            // The card in front, solid, with a gap around it and the person cut out.
            NSGraphicsContext.current?.compositingOperation = .clear
            NSBezierPath(roundedRect: NSRect(x: 1, y: 7, width: 10, height: 10), xRadius: 2.6, yRadius: 2.6).fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
            let front = NSBezierPath(roundedRect: NSRect(x: 2, y: 8, width: 8, height: 8), xRadius: 2, yRadius: 2)
            NSColor.black.setFill()
            front.fill()
            NSGraphicsContext.saveGraphicsState()
            front.addClip()
            NSGraphicsContext.current?.compositingOperation = .clear
            NSBezierPath(ovalIn: NSRect(x: 4.75, y: 9.4, width: 2.5, height: 2.5)).fill()
            NSBezierPath(roundedRect: NSRect(x: 3.6, y: 13.2, width: 4.8, height: 4), xRadius: 2, yRadius: 2).fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Swapdeck"
        return image
    }
}
