import AppKit
import SwapdeckCore
import SwiftUI

/// "Sơn mài & giấy dó" (lacquer & paper), the Swapdeck identity: ink on warm
/// paper in light mode, eggshell on black lacquer in dark mode, one vermilion
/// accent for what is in use. The same tokens as the extension's ui.css.
enum Theme {
    static let paper = dynamic(light: 0xf4f0e8, dark: 0x141110)
    static let card = dynamic(light: 0xfbf9f5, dark: 0x1c1816)
    static let sunken = dynamic(light: 0xede7dc, dark: 0x100e0c)
    static let hover = dynamic(light: 0xeee8de, dark: 0x262019)
    static let selected = dynamic(light: 0xe7dfd2, dark: 0x2d2620)
    static let line = dynamic(light: 0xe1d9cb, dark: 0x332b25)
    static let lineStrong = dynamic(light: 0xcbbfab, dark: 0x4a3f36)
    static let ink = dynamic(light: 0x1a1714, dark: 0xf1e9dc)
    static let ink2 = dynamic(light: 0x57504a, dark: 0xc2b6a5)
    static let ink3 = dynamic(light: 0x6f665b, dark: 0x9c9080)
    static let onInk = dynamic(light: 0xfbf9f5, dark: 0x141110)
    static let accent = dynamic(light: 0xc8402b, dark: 0xe0573c)
    static let accentText = dynamic(light: 0xa8331e, dark: 0xf08a6c)
    static let accentSoft = dynamic(light: 0xf6e2d9, dark: 0x3a1d15)
    static let warning = dynamic(light: 0x8f5a12, dark: 0xe3a957)
    static let warningSoft = dynamic(light: 0xf5e9d3, dark: 0x2b2010)
    static let danger = dynamic(light: 0xb3261e, dark: 0xf07b6f)
    static let success = dynamic(light: 0x1f6b52, dark: 0x6fc39e)
    /// The lacquer frame: switcher lid and manager sidebar.
    static let lacquer = dynamic(light: 0x1a1714, dark: 0x0d0b0a)
    static let lacquerHover = dynamic(light: 0x2a241f, dark: 0x1c1815)
    static let lacquerActive = dynamic(light: 0x352d27, dark: 0x26201b)
    static let lacquerLine = dynamic(light: 0x2f2823, dark: 0x2a231e)
    static let onLacquer = Color(hex: 0xf4ede1)
    static let onLacquer2 = Color(hex: 0xbdb1a0)
    static let lacquerAccent = Color(hex: 0xef6d52)
    static let gold = Color(hex: 0xb08a3a)

    /// Titles in the system serif (New York), like Fraunces in the extension.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .serif) }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func mono(_ size: CGFloat) -> Font { .system(size: size, weight: .medium, design: .monospaced) }
    /// Small capitals: section labels, seals.
    static func caps(_ size: CGFloat = 10) -> Font { .system(size: size, weight: .bold) }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua, .vibrantLight]).map {
                $0 == .darkAqua || $0 == .vibrantDark
            } ?? false
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(nsColor: NSColor(hex: hex))
    }

    /// "#rrggbb" (anything else falls back to vermilion).
    init(hexString: String) {
        let value = Palette.isHex(hexString) ? UInt32(hexString.dropFirst(), radix: 16) ?? 0xc8402b : 0xc8402b
        self.init(hex: value)
    }
}
