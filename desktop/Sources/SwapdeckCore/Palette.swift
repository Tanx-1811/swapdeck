import Foundation

/// A lacquer pigment: the same twelve colors as the Swapdeck extension, each
/// readable with white text (WCAG AA).
public struct Pigment: Hashable, Sendable {
    /// Message key suffix (`color.<key>`).
    public let key: String
    public let hex: String
}

public enum Palette {
    public static let pigments: [Pigment] = [
        Pigment(key: "son", hex: "#c8402b"),
        Pigment(key: "cham", hex: "#2f4e86"),
        Pigment(key: "ngoc", hex: "#1f6b52"),
        Pigment(key: "nghe", hex: "#94661a"),
        Pigment(key: "man", hex: "#8c2f55"),
        Pigment(key: "lam", hex: "#3d6f8f"),
        Pigment(key: "tim", hex: "#6b4f9e"),
        Pigment(key: "reu", hex: "#55692a"),
        Pigment(key: "dat", hex: "#9a4a2a"),
        Pigment(key: "vit", hex: "#1f5f6b"),
        Pigment(key: "hong", hex: "#a34d63"),
        Pigment(key: "muc", hex: "#4a4440"),
    ]

    public static func isHex(_ text: String) -> Bool {
        text.count == 7 && text.hasPrefix("#") && text.dropFirst().allSatisfy(\.isHexDigit)
    }

    /// The first pigment no workspace uses yet.
    public static func next(after used: [String]) -> String {
        let taken = Set(used.map { $0.lowercased() })
        return pigments.first { !taken.contains($0.hex) }?.hex ?? pigments[used.count % pigments.count].hex
    }

    public static func pigment(for hex: String) -> Pigment? {
        pigments.first { $0.hex == hex.lowercased() }
    }

    /// (red, green, blue) in 0…1 for "#rrggbb".
    public static func components(_ hex: String) -> (Double, Double, Double)? {
        guard isHex(hex), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return (Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255)
    }

    /// WCAG contrast ratio between two "#rrggbb" colors.
    public static func contrast(_ a: String, _ b: String) -> Double {
        func luminance(_ hex: String) -> Double {
            guard let (r, g, b) = components(hex) else { return 0 }
            func channel(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }
        let (light, dark) = (max(luminance(a), luminance(b)), min(luminance(a), luminance(b)))
        return (light + 0.05) / (dark + 0.05)
    }

    /// White text on dark colors, ink on light ones.
    public static func textColor(on hex: String) -> String {
        contrast("#ffffff", hex) >= 4.5 ? "#ffffff" : "#1a1714"
    }

    /// A browser's signed 32-bit ARGB color (Local State) as "#rrggbb".
    public static func hex(fromARGB value: Int64) -> String {
        let rgb = UInt32(truncatingIfNeeded: value) & 0x00ff_ffff
        return String(format: "#%06x", rgb)
    }
}

/// Symbols a workspace can wear instead of initials. The keys are the Swapdeck
/// extension's (so imported workspaces keep theirs); each maps to an SF Symbol
/// available since macOS 14.
public enum Symbols {
    public static let all: [(key: String, systemName: String)] = [
        ("briefcase", "briefcase"),
        ("building", "building.2"),
        ("house", "house"),
        ("user", "person"),
        ("users", "person.2"),
        ("handshake", "signature"),
        ("store", "bag"),
        ("rocket", "paperplane"),
        ("code", "chevron.left.forwardslash.chevron.right"),
        ("flask", "testtube.2"),
        ("wrench", "wrench.and.screwdriver"),
        ("shield", "shield"),
        ("globe", "globe"),
        ("star", "star"),
        ("heart", "heart"),
        ("leaf", "leaf"),
        ("palette", "paintpalette"),
        ("graduation", "graduationcap"),
        ("coffee", "cup.and.saucer"),
        ("bug", "ladybug"),
    ]

    public static func systemName(for key: String) -> String? {
        all.first { $0.key == key }?.systemName
    }

    public static func isKnown(_ key: String) -> Bool {
        systemName(for: key) != nil
    }
}

public enum Initials {
    /// "Ngọc Ánh" → "NA", "Dự án phụ" → "DA", "Đặng" → "ĐA", "acme.example" → "AE".
    public static func of(_ label: String) -> String {
        let text = label.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let words = text.split { $0.isWhitespace || $0 == "." || $0 == "_" || $0 == "-" }.map(String.init)
        if words.count >= 2 { return (first(words[0]) + first(words[1])).uppercased() }
        let chars = (words.first ?? "").map { first(String($0)) }
        let result = chars.prefix(2).joined()
        return result.isEmpty ? "?" : result.uppercased()
    }

    /// The first letter without its accents ("ặ" → "a"), but "đ" stays "đ".
    private static func first(_ word: String) -> String {
        guard let char = word.first else { return "" }
        let stripped = String(char).decomposedStringWithCanonicalMapping.unicodeScalars
            .filter { !(0x300...0x36f).contains($0.value) }
        let base = String(String.UnicodeScalarView(stripped))
        return base.isEmpty ? String(char) : base
    }
}
