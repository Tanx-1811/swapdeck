import SwapdeckCore
import SwiftUI

/// A workspace's badge: a rounded square in its color, with its symbol or initials.
struct WorkspaceBadge: View {
    let workspace: Workspace
    var size: CGFloat = 32

    var body: some View {
        let foreground = Color(hexString: Palette.textColor(on: workspace.color))
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Color(hexString: workspace.color))
            .overlay {
                if let symbol = Symbols.systemName(for: workspace.symbol) {
                    Image(systemName: symbol)
                        .font(.system(size: size * 0.46, weight: .medium))
                        .foregroundStyle(foreground)
                } else {
                    Text(Initials.of(workspace.name))
                        .font(.system(size: size * 0.38, weight: .bold))
                        .tracking(0.3)
                        .foregroundStyle(foreground)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The label that marks what is in use: a dot and the words on a tinted pill, flat.
struct Seal: View {
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(Theme.accent).frame(width: 5, height: 5)
            Text(text)
                .font(Theme.text(10, .semibold))
                .foregroundStyle(Theme.accentText)
        }
        .padding(.leading, 6)
        .padding(.trailing, 7)
        .padding(.vertical, 1.5)
        .background(Capsule().fill(Theme.accentSoft))
        .fixedSize()
    }
}

/// Small capitals followed by a hairline, like a ledger heading.
struct SectionLabel: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Text(text.uppercased())
                .font(Theme.caps(10))
                .tracking(1.2)
                .foregroundStyle(Theme.ink3)
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }
}

struct Kbd: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.mono(10))
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 4).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.lineStrong, lineWidth: 1))
            .fixedSize()
    }
}

/// A note on a tinted background, its tone in the icon: warnings, results, hints. No coloured edge strip.
struct Callout<Actions: View>: View {
    enum Tone { case info, warning, danger, success }
    let tone: Tone
    let title: String
    var message: String?
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon).foregroundStyle(color).font(.system(size: 13, weight: .semibold)).padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(Theme.text(12.5, .semibold)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                if let message {
                    Text(message).font(Theme.text(12)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
                actions
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(soft))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(color.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var icon: String {
        switch tone {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .danger: "xmark.octagon"
        case .success: "checkmark.circle"
        }
    }

    private var color: Color {
        switch tone {
        case .info: Theme.ink2
        case .warning: Theme.warning
        case .danger: Theme.danger
        case .success: Theme.success
        }
    }

    private var soft: Color {
        switch tone {
        case .warning: Theme.warningSoft
        case .danger, .success, .info: Theme.sunken
        }
    }
}

extension Callout where Actions == EmptyView {
    init(tone: Tone, title: String, message: String? = nil) {
        self.init(tone: tone, title: title, message: message) { EmptyView() }
    }
}

// MARK: - Buttons

/// The main action, in the accent. Flat.
struct InkButtonStyle: ButtonStyle {
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(small ? 11.5 : 12.5, .semibold))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, small ? 9 : 12)
            .frame(minHeight: small ? 24 : 28)
            .background(RoundedRectangle(cornerRadius: 7).fill(Theme.accent.opacity(configuration.isPressed ? 0.85 : 1)))
            .contentShape(Rectangle())
    }
}

/// Everyday buttons: card stock with a hairline.
struct PaperButtonStyle: ButtonStyle {
    var small = false
    var dashed = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(small ? 11.5 : 12.5, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, small ? 9 : 12)
            .frame(minHeight: small ? 24 : 28)
            .background(RoundedRectangle(cornerRadius: 7).fill(configuration.isPressed ? Theme.hover : Theme.card))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .strokeBorder(Theme.lineStrong, style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : []))
            )
            .contentShape(Rectangle())
    }
}

struct GhostButtonStyle: ButtonStyle {
    var color: Color = Theme.ink2

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(12, .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .frame(minHeight: 24)
            .background(RoundedRectangle(cornerRadius: 6).fill(configuration.isPressed ? Theme.hover : .clear))
            .contentShape(Rectangle())
    }
}

/// Icon buttons on the lacquer lid.
struct LidButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.onLacquer2)
            .frame(width: 26, height: 26)
            .background(RoundedRectangle(cornerRadius: 6).fill(configuration.isPressed ? Theme.lacquerActive : .clear))
            .contentShape(Rectangle())
    }
}

// MARK: - The mark

/// The Swapdeck mark (assets/icon.svg): a deck of account cards on a flat
/// iris tile, the account in use in front with a person cut out of it.
struct MarkView: View {
    var size: CGFloat = 22

    var body: some View {
        Canvas { context, canvasSize in
            let s = canvasSize.width / 128
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                CGRect(x: x * s, y: y * s, width: w * s, height: h * s)
            }
            let iris = Color(hex: 0x5046e5)
            context.fill(Path(roundedRect: rect(0, 0, 128, 128), cornerRadius: 28 * s, style: .continuous), with: .color(iris))
            context.fill(Path(roundedRect: rect(51, 20, 56, 56), cornerRadius: 13 * s), with: .color(Color(hex: 0x8a84f0)))
            // Thin tile-coloured gaps keep the cards apart.
            context.fill(Path(roundedRect: rect(35, 32, 62, 62), cornerRadius: 15.5 * s), with: .color(iris))
            context.fill(Path(roundedRect: rect(37, 34, 58, 58), cornerRadius: 13.5 * s), with: .color(Color(hex: 0xbdb9f7)))
            context.fill(Path(roundedRect: rect(19, 46, 64, 64), cornerRadius: 16 * s), with: .color(iris))
            let front = Path(roundedRect: rect(21, 48, 60, 60), cornerRadius: 14 * s)
            context.fill(front, with: .color(.white))
            var person = context
            person.clip(to: front)
            person.fill(Path(ellipseIn: rect(40, 59, 22, 22)), with: .color(iris))
            person.fill(Path(roundedRect: rect(30, 86, 42, 30), cornerRadius: 15 * s), with: .color(iris))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
