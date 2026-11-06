import SwapdeckCore
import SwiftUI

/// "Open this link in which workspace?": shown for links that match no
/// workspace (or with ⌥ held). Number keys pick, Escape closes.
struct ChooserView: View {
    let model: AppModel
    let url: URL
    let onDone: () -> Void
    @State private var remember = false
    @State private var highlighted = 0

    private var t: Translator { model.t }

    var body: some View {
        let workspaces = model.workspaces
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                MarkView(size: 20)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(.white.opacity(0.12)))
                Text("Swapdeck").font(Theme.display(15)).foregroundStyle(Theme.onLacquer)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Theme.lacquer)

            VStack(alignment: .leading, spacing: 10) {
                Text(t("chooser.title")).font(Theme.display(17)).foregroundStyle(Theme.ink)
                Text(display(url))
                    .font(Theme.mono(11))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Theme.sunken))
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(Array(workspaces.enumerated()), id: \.element.id) { index, workspace in
                            row(workspace, index: index)
                        }
                    }
                }
                .frame(maxHeight: 300)
                .fixedSize(horizontal: false, vertical: workspaces.count <= 6)
                Button {
                    pick(nil)
                } label: {
                    Label(t("chooser.browser", ["browser": model.data.settings.defaultBrowser.displayName]), systemImage: "safari")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(PaperButtonStyle(dashed: true))
                if let host = url.host.flatMap(LinkRouter.normalize) {
                    Toggle(t("chooser.remember", ["host": host]), isOn: $remember)
                        .toggleStyle(.checkbox)
                        .font(Theme.text(12))
                        .foregroundStyle(Theme.ink2)
                }
                HStack {
                    Text(t("chooser.hint")).font(Theme.text(11)).foregroundStyle(Theme.ink3)
                    Spacer()
                    Button(t("common.cancel")) { onDone() }
                        .buttonStyle(GhostButtonStyle())
                        .keyboardShortcut(.cancelAction)
                }
            }
            .padding(14)
        }
        .frame(width: 380)
        .background(Theme.paper)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(characters: .decimalDigits) { press in
            guard let digit = Int(press.characters), digit >= 1, digit <= workspaces.count else { return .ignored }
            pick(workspaces[digit - 1].id)
            return .handled
        }
        .onKeyPress(.downArrow) {
            highlighted = min(highlighted + 1, max(workspaces.count - 1, 0))
            return .handled
        }
        .onKeyPress(.upArrow) {
            highlighted = max(highlighted - 1, 0)
            return .handled
        }
        .onKeyPress(.return) {
            if workspaces.indices.contains(highlighted) { pick(workspaces[highlighted].id) }
            return .handled
        }
    }

    private func row(_ workspace: Workspace, index: Int) -> some View {
        // A workspace without a usable profile can't take the link (it would be lost).
        let usable = model.canOpenLinks(in: workspace)
        return Button {
            pick(workspace.id)
        } label: {
            HStack(spacing: 10) {
                WorkspaceBadge(workspace: workspace, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(workspace.name).font(Theme.text(13, .semibold)).foregroundStyle(usable ? Theme.ink : Theme.ink3).lineLimit(1)
                    if !usable {
                        Text(t("switcher.noProfile")).font(Theme.text(11)).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                }
                if model.frontId == workspace.id { Seal(text: t("switcher.inUse")) }
                Spacer()
                if index < 9 && usable { Kbd(text: "\(index + 1)") }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 9).fill(index == highlighted && usable ? Theme.hover : Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(index == highlighted ? Theme.lineStrong : Theme.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!usable)
        .accessibilityLabel(usable ? workspace.name : "\(workspace.name), \(t("switcher.noProfile"))")
    }

    private func pick(_ workspaceId: String?) {
        if let workspaceId, let workspace = model.workspace(workspaceId), !model.canOpenLinks(in: workspace) { return }
        model.openChosen(url, in: workspaceId, remember: remember && workspaceId != nil)
        onDone()
    }

    private func display(_ url: URL) -> String {
        var text = (url.host ?? "") + url.path
        if let query = url.query, !query.isEmpty { text += "?" + query }
        return text
    }
}
