import AppKit

/// The menu bar icon: the deck of the mark drawn as a template image (macOS
/// tints it for light, dark and highlighted menu bars).
enum MenuBarIcon {
    static func image() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            NSColor.black.setStroke()
            NSColor.black.setFill()
            // Two cards behind, as outlines.
            let back = NSBezierPath(roundedRect: NSRect(x: 7.5, y: 2.5, width: 8.5, height: 6), xRadius: 1.4, yRadius: 1.4)
            back.lineWidth = 1.2
            NSColor.black.withAlphaComponent(0.55).setStroke()
            back.stroke()
            let middle = NSBezierPath(roundedRect: NSRect(x: 4.8, y: 4.8, width: 10, height: 7), xRadius: 1.5, yRadius: 1.5)
            middle.lineWidth = 1.2
            NSColor.black.withAlphaComponent(0.8).setStroke()
            middle.stroke()
            // The card in front, solid, with a name line and the seal cut out.
            let front = NSBezierPath(roundedRect: NSRect(x: 2, y: 7.5, width: 11.5, height: 8.5), xRadius: 1.8, yRadius: 1.8)
            front.append(NSBezierPath(roundedRect: NSRect(x: 4, y: 9.8, width: 5, height: 1.4), xRadius: 0.7, yRadius: 0.7).reversed)
            front.append(NSBezierPath(rect: NSRect(x: 8.3, y: 12.4, width: 3.4, height: 1.8)).reversed)
            NSColor.black.setFill()
            front.fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Swapdeck"
        return image
    }
}
