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

/// The vermilion seal that marks what is in use, slightly tilted like a hand stamp.
struct Seal: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(Theme.caps(8.5))
            .tracking(1.1)
            .foregroundStyle(Theme.accentText)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Theme.accent, lineWidth: 1.4))
            .rotationEffect(.degrees(-2))
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

/// A note with a colored rule on its left: warnings, results, hints.
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
        .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 3).clipShape(RoundedRectangle(cornerRadius: 1.5)) }
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

/// Primary actions are written in ink.
struct InkButtonStyle: ButtonStyle {
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(small ? 11.5 : 12.5, .semibold))
            .foregroundStyle(Theme.onInk)
            .padding(.horizontal, small ? 9 : 12)
            .frame(minHeight: small ? 24 : 28)
            .background(RoundedRectangle(cornerRadius: 7).fill(Theme.ink.opacity(configuration.isPressed ? 0.85 : 1)))
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

/// The Swapdeck mark (assets/icon.svg): a fanned deck of cards on black
/// lacquer, the front card stamped with a vermilion seal.
struct MarkView: View {
    var size: CGFloat = 22

    var body: some View {
        Canvas { context, canvasSize in
            let s = canvasSize.width / 128
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                CGRect(x: x * s, y: y * s, width: w * s, height: h * s)
            }
            func rotated(_ degrees: Double, about x: CGFloat, _ y: CGFloat, draw: (inout GraphicsContext) -> Void) {
                var copy = context
                copy.translateBy(x: x * s, y: y * s)
                copy.rotate(by: .degrees(degrees))
                copy.translateBy(x: -x * s, y: -y * s)
                draw(&copy)
            }
            let tile = Path(roundedRect: rect(0, 0, 128, 128), cornerRadius: 28 * s, style: .continuous)
            context.fill(tile, with: .color(Color(hex: 0x1a1714)))
            context.fill(tile, with: .linearGradient(
                Gradient(stops: [
                    .init(color: Color(hex: 0xf1e9dc).opacity(0.1), location: 0),
                    .init(color: Color(hex: 0xf1e9dc).opacity(0), location: 0.45),
                ]),
                startPoint: .zero,
                endPoint: CGPoint(x: 0, y: canvasSize.height)
            ))
            context.stroke(
                Path(roundedRect: rect(1.5, 1.5, 125, 125), cornerRadius: 26.5 * s, style: .continuous),
                with: .color(Color(hex: 0xf1e9dc).opacity(0.16)),
                lineWidth: 3 * s
            )
            rotated(-14, about: 75, 46) { $0.fill(Path(roundedRect: rect(38, 20, 74, 52), cornerRadius: 9 * s), with: .color(Color(hex: 0xb08a3a))) }
            rotated(-6, about: 68, 57) { $0.fill(Path(roundedRect: rect(30, 30, 76, 54), cornerRadius: 9 * s), with: .color(Color(hex: 0xd9cdb8))) }
            context.fill(Path(roundedRect: rect(17, 46, 84, 58), cornerRadius: 10 * s), with: .color(Color(hex: 0xfbf9f5)))
            context.fill(Path(roundedRect: rect(28, 59, 34, 7), cornerRadius: 3.5 * s), with: .color(Color(hex: 0x1a1714)))
            context.fill(Path(roundedRect: rect(28, 72, 22, 7), cornerRadius: 3.5 * s), with: .color(Color(hex: 0x1a1714).opacity(0.35)))
            rotated(-8, about: 80, 87) {
                $0.stroke(Path(roundedRect: rect(64.5, 77, 31, 20), cornerRadius: 3.5 * s), with: .color(Color(hex: 0xc8402b)), lineWidth: 3.5 * s)
                $0.fill(Path(roundedRect: rect(70.5, 84, 19, 6), cornerRadius: 1.5 * s), with: .color(Color(hex: 0xc8402b)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
