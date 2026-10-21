import SwapdeckCore
import SwiftUI

/// The menu bar switcher: a lacquer lid, a search field and the workspaces as
/// index cards. The workspace whose window is in front wears the seal.
struct SwitcherView: View {
    @Bindable var model: AppModel
    @FocusState private var searchFocused: Bool
    @State private var highlighted = 0

    private var t: Translator { model.t }

    var body: some View {
        VStack(spacing: 0) {
            lid
            VStack(alignment: .leading, spacing: 10) {
                if !model.workspaces.isEmpty { searchField }
                if model.automation == .denied && model.data.settings.nameWindows { permissionNote }
                if let banner = model.banner {
                    Callout(tone: banner.tone == .error ? .danger : .success, title: banner.text)
                }
                if model.workspaces.isEmpty {
                    emptyState
                } else if model.visibleWorkspaces.isEmpty {
                    Text(t("switcher.noMatch", ["query": model.query]))
                        .font(Theme.text(12.5))
                        .foregroundStyle(Theme.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 22)
                } else {
                    list
                }
            }
            .padding(12)
            footer
        }
        .frame(width: 360)
        .background(Theme.paper)
        .onAppear {
            highlighted = 0
            searchFocused = true
        }
    }

    // MARK: Parts

    private var lid: some View {
        HStack(spacing: 9) {
            MarkView(size: 22)
                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(.white.opacity(0.12)))
            Text("Swapdeck").font(Theme.display(16)).foregroundStyle(Theme.onLacquer)
            Spacer()
            Button {
                let workspace = model.createWorkspace()
                model.onShowManager?(.workspace(workspace.id))
            } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(LidButtonStyle())
            .help(t("switcher.new"))
            .accessibilityLabel(t("switcher.new"))
            Button {
                model.onShowManager?(nil)
            } label: {
                Image(systemName: "gearshape")
            }
            .buttonStyle(LidButtonStyle())
            .help(t("switcher.manage"))
            .accessibilityLabel(t("switcher.manage"))
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .frame(height: 44)
        .background(Theme.lacquer)
    }

    private var searchField: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink3)
            TextField(t("switcher.search"), text: $model.query)
                .textFieldStyle(.plain)
                .font(Theme.text(13))
                .focused($searchFocused)
                .onChange(of: model.query) { highlighted = 0 }
                .onKeyPress(.downArrow) {
                    highlighted = min(highlighted + 1, max(model.visibleWorkspaces.count - 1, 0))
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    highlighted = max(highlighted - 1, 0)
                    return .handled
                }
                .onKeyPress(.return) {
                    openVisible(at: highlighted)
                    return .handled
                }
                .onKeyPress(characters: .decimalDigits) { press in
                    guard model.query.isEmpty, let digit = Int(press.characters), digit >= 1 else { return .ignored }
                    openVisible(at: digit - 1)
                    return .handled
                }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(searchFocused ? Theme.ink : Theme.lineStrong, lineWidth: 1))
    }

    @ViewBuilder
    private var list: some View {
        let workspaces = model.visibleWorkspaces
        let cards = VStack(spacing: 8) {
            ForEach(Array(workspaces.enumerated()), id: \.element.id) { index, workspace in
                WorkspaceCard(model: model, workspace: workspace, index: index, highlighted: index == highlighted)
            }
        }
        .padding(.trailing, 3)
        .padding(.bottom, 3)
        if workspaces.count > 6 {
            ScrollView { cards }.frame(height: 410).scrollIndicators(.automatic)
        } else {
            cards
        }
    }

    private var permissionNote: some View {
        let browser = model.workspaces.first?.browser.displayName ?? BrowserKind.chrome.displayName
        return Callout(
            tone: .warning,
            title: t("switcher.permissionTitle", ["browser": browser]),
            message: t("switcher.permissionBody")
        ) {
            Button(t("switcher.permissionAction")) { model.openAutomationSettings() }
                .buttonStyle(PaperButtonStyle(small: true))
                .padding(.top, 2)
        }
    }

    private var emptyState: some View {
        let browser = model.data.settings.defaultBrowser
        let unused = WorkspaceLogic.unusedProfiles(model.profiles[browser] ?? [], workspaces: [], browser: browser)
        return VStack(spacing: 10) {
            MarkView(size: 52)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
                .padding(.top, 8)
            Text(t("switcher.emptyTitle")).font(Theme.display(18)).foregroundStyle(Theme.ink)
            Text(t("switcher.emptyBody"))
                .font(Theme.text(12.5))
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 8)
            VStack(spacing: 6) {
                if !unused.isEmpty {
                    Button(t("switcher.fromProfiles", ["n": String(unused.count)])) {
                        model.importProfiles(browser)
                    }
                    .buttonStyle(InkButtonStyle())
                }
                Button {
                    let workspace = model.createWorkspace()
                    model.onShowManager?(.workspace(workspace.id))
                } label: {
                    Label(t("switcher.new"), systemImage: "plus")
                }
                .buttonStyle(PaperButtonStyle(dashed: true))
            }
            .padding(.top, 4)
            .padding(.bottom, 6)
        }
        .frame(maxWidth: .infinity)
    }

    private var footer: some View {
        HStack {
            let hotkey = model.data.settings.hotkey
            Text(hotkey == .off ? t("switcher.footerNoKey") : t("switcher.footerKeys", ["hotkey": hotkey.display]))
                .font(Theme.text(11))
                .foregroundStyle(Theme.ink3)
            Spacer()
            Button(t("switcher.manage")) { model.onShowManager?(nil) }
                .buttonStyle(GhostButtonStyle(color: Theme.accentText))
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(height: 34)
        .background(Theme.card)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func openVisible(at index: Int) {
        let workspaces = model.visibleWorkspaces
        guard workspaces.indices.contains(index) else { return }
        let workspace = workspaces[index]
        model.onClosePopover?()
        Task { await model.open(workspace) }
    }
}

/// One workspace as an index card. Click opens it; the menu offers a new
/// window, its pages and the editor.
struct WorkspaceCard: View {
    let model: AppModel
    let workspace: Workspace
    let index: Int
    var highlighted = false
    @State private var hovering = false

    private var t: Translator { model.t }

    var body: some View {
        let isFront = model.frontId == workspace.id
        let isOpen = model.openIds.contains(workspace.id)
        HStack(spacing: 0) {
            Button {
                model.onClosePopover?()
                Task { await model.open(workspace) }
            } label: {
                HStack(spacing: 11) {
                    WorkspaceBadge(workspace: workspace, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 7) {
                            Text(workspace.name)
                                .font(Theme.text(13.5, .semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            if isFront {
                                Seal(text: t("switcher.inUse"))
                            } else if isOpen {
                                HStack(spacing: 4) {
                                    Circle().fill(Theme.success).frame(width: 6, height: 6)
                                    Text(t("switcher.openNow")).font(Theme.text(10.5, .medium)).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                        Text(subtitle.text)
                            .font(Theme.text(11.5))
                            .foregroundStyle(subtitle.warning ? Theme.warning : Theme.ink2)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if model.busyId == workspace.id {
                        ProgressView().controlSize(.small)
                    } else if index < 9 {
                        Kbd(text: "\(index + 1)").opacity(hovering || highlighted ? 1 : 0.7)
                    }
                }
                .padding(.leading, 10)
                .padding(.vertical, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(workspace.name)
            .accessibilityHint(subtitle.text)

            Menu {
                menuItems
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink2)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 30, height: 30)
            .padding(.trailing, 4)
            .accessibilityLabel(t("switcher.more", ["name": workspace.name]))
        }
        .background(card(isFront: isFront))
        .contextMenu { menuItems }
        .onHover { hovering = $0 }
    }

    @ViewBuilder
    private var menuItems: some View {
        Button(t("switcher.open")) { run { await model.open(workspace) } }
        Button(t("switcher.newWindow")) { run { await model.open(workspace, newWindow: true) } }
        let links = workspace.openableLinks
        if !links.isEmpty {
            Divider()
            ForEach(links.prefix(10)) { link in
                Button(t("switcher.openPage", ["page": link.title])) { run { await model.openLink(link, in: workspace) } }
            }
        }
        Divider()
        Button(t("switcher.edit")) { model.onShowManager?(.workspace(workspace.id)) }
    }

    private func run(_ action: @escaping @MainActor () async -> Void) {
        model.onClosePopover?()
        Task { await action() }
    }

    private var subtitle: (text: String, warning: Bool) {
        switch model.profileStatus(workspace) {
        case .unassigned: return (t("switcher.noProfile"), true)
        case .missing: return (t("switcher.profileMissing"), true)
        case .browserMissing: return (t("editor.notInstalled", ["browser": workspace.browser.displayName]), true)
        case .ready(let profile):
            var parts = [workspace.browser.displayName]
            if profile.name != workspace.name { parts.append(profile.name) }
            if !workspace.links.isEmpty { parts.append(t.count(workspace.links.count, one: "switcher.onePage", many: "switcher.pages")) }
            return (parts.joined(separator: " · "), false)
        }
    }

    /// Card stock; the workspace in front sits on top of the deck.
    private func card(isFront: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        return ZStack {
            if isFront {
                shape.fill(Theme.card).overlay(shape.strokeBorder(Theme.lineStrong, lineWidth: 1)).offset(x: 3, y: 3)
            }
            shape.fill(hovering || highlighted ? Theme.hover : Theme.card)
            shape.strokeBorder(isFront || highlighted ? Theme.lineStrong : Theme.line, lineWidth: 1)
        }
        .shadow(color: .black.opacity(isFront ? 0.1 : 0.04), radius: isFront ? 6 : 1.5, y: isFront ? 4 : 1)
    }
}
