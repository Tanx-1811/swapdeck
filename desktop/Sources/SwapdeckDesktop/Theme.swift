import AppKit
import SwapdeckCore
import SwiftUI

/// The Swapdeck identity: flat and quiet — cool grey surfaces, one ink, one
/// iris accent for what is in use and the main action; no gradients, no sheen,
/// no coloured edge strips. The same tokens as the extension's ui.css.
enum Theme {
    static let paper = dynamic(light: 0xf6f7fb, dark: 0x0e0f15)
    static let card = dynamic(light: 0xffffff, dark: 0x171821)
    static let sunken = dynamic(light: 0xeef0f6, dark: 0x0a0b10)
    static let hover = dynamic(light: 0xf1f2f8, dark: 0x1e202b)
    static let selected = dynamic(light: 0xe7e9f3, dark: 0x262836)
    static let line = dynamic(light: 0xe3e5ee, dark: 0x262835)
    static let lineStrong = dynamic(light: 0xcacedc, dark: 0x3a3d4f)
    static let ink = dynamic(light: 0x10121f, dark: 0xecedf5)
    static let ink2 = dynamic(light: 0x474d63, dark: 0xa9aec2)
    static let ink3 = dynamic(light: 0x5f657b, dark: 0x8b90a6)
    static let onInk = dynamic(light: 0xffffff, dark: 0x0e0f15)
    static let accent = dynamic(light: 0x5046e5, dark: 0x8c87ff)
    static let accentText = dynamic(light: 0x4338ca, dark: 0xa5a1ff)
    static let accentSoft = dynamic(light: 0xeeedfe, dark: 0x23214a)
    static let onAccent = dynamic(light: 0xffffff, dark: 0x0e0f15)
    static let warning = dynamic(light: 0xa04d0a, dark: 0xf0b45a)
    static let warningSoft = dynamic(light: 0xfdf3e2, dark: 0x2b1f0d)
    static let danger = dynamic(light: 0xb42318, dark: 0xf38b80)
    static let success = dynamic(light: 0x047857, dark: 0x5fd3a0)
    /// The frame: switcher header and manager sidebar, in deep ink.
    static let lacquer = dynamic(light: 0x16152b, dark: 0x0a0a12)
    static let lacquerHover = dynamic(light: 0x23213f, dark: 0x1a1a28)
    static let lacquerActive = dynamic(light: 0x2c2950, dark: 0x232336)
    static let lacquerLine = dynamic(light: 0x2a2847, dark: 0x20202f)
    static let onLacquer = Color(hex: 0xf2f1ff)
    static let onLacquer2 = Color(hex: 0xa9a6cc)
    static let lacquerAccent = Color(hex: 0xaca8ff)
    static let iris = Color(hex: 0x5046e5)

    /// Titles in the system face, heavier and tighter, like Be Vietnam Pro 600 in the extension.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
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

    /// "#rrggbb" (anything else falls back to the first account colour).
    init(hexString: String) {
        let value = Palette.isHex(hexString) ? UInt32(hexString.dropFirst(), radix: 16) ?? 0xc8402b : 0xc8402b
        self.init(hex: value)
    }
}
