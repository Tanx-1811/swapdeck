import SwapdeckCore
import SwiftUI

/// Edits one workspace: name and look, its browser profile, its pages.
/// Changes save as you go.
struct WorkspaceEditor: View {
    @Bindable var model: AppModel
    let id: String
    @Binding var selection: ManagerSelection?
    @State private var confirmDelete = false

    private var t: Translator { model.t }

    private var workspace: Binding<Workspace> {
        Binding(
            get: { model.workspace(id) ?? Workspace(id: id, name: "") },
            set: { model.update($0) }
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                identityCard
                profileCard
                pagesCard
                HStack {
                    Spacer()
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label(t("editor.delete"), systemImage: "trash")
                    }
                    .buttonStyle(GhostButtonStyle(color: Theme.danger))
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 34)
            .padding(.bottom, 28)
            .frame(maxWidth: 720, alignment: .leading)
        }
        .alert(t("editor.delete"), isPresented: $confirmDelete) {
            Button(t("common.delete"), role: .destructive) {
                model.delete(id)
                selection = model.workspaces.first.map { .workspace($0.id) }
            }
            Button(t("common.cancel"), role: .cancel) {}
        } message: {
            Text(t("editor.deleteConfirm", ["name": workspace.wrappedValue.name]))
        }
    }

    // MARK: Header

    private var header: some View {
        let current = workspace.wrappedValue
        return HStack(alignment: .center, spacing: 14) {
            WorkspaceBadge(workspace: current, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(current.name.isEmpty ? "…" : current.name)
                        .font(Theme.display(26))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if model.frontId == current.id { Seal(text: t("switcher.inUse")) }
                }
                Text(stats(current)).font(Theme.text(12)).foregroundStyle(Theme.ink3)
            }
            Spacer()
            Button {
                Task { await model.open(current) }
            } label: {
                Label(t("editor.tryOpen"), systemImage: "arrow.up.forward.app")
            }
            .buttonStyle(InkButtonStyle())
            .disabled(model.busyId == current.id)
        }
    }

    private func stats(_ workspace: Workspace) -> String {
        guard let last = workspace.lastOpenedAt else { return t("editor.never") }
        return t("editor.stats", ["n": String(workspace.openCount), "time": t.relative(last)])
    }

    // MARK: Name and look

    private var identityCard: some View {
        PaneCard(title: t("editor.name")) {
            PaperField(placeholder: t("editor.namePlaceholder"), text: workspace.name)
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: t("editor.symbol"))
                symbolGrid
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: t("editor.color"))
                colorRow
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: t("editor.note"))
                PaperField(placeholder: t("editor.notePlaceholder"), text: workspace.note)
            }
        }
    }

    private var symbolGrid: some View {
        let selected = workspace.wrappedValue.symbol
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(30), spacing: 6), count: 14), alignment: .leading, spacing: 6) {
            swatch(selected: selected.isEmpty, label: t("editor.initials")) {
                Text(Initials.of(workspace.wrappedValue.name)).font(Theme.text(10.5, .bold))
            } action: {
                workspace.wrappedValue.symbol = ""
            }
            ForEach(Symbols.all, id: \.key) { symbol in
                swatch(selected: selected == symbol.key, label: t("symbol.\(symbol.key)")) {
                    Image(systemName: symbol.systemName).font(.system(size: 13))
                } action: {
                    workspace.wrappedValue.symbol = symbol.key
                }
            }
        }
    }

    private func swatch<Label: View>(
        selected: Bool,
        label: String,
        @ViewBuilder content: () -> Label,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            content()
                .foregroundStyle(selected ? Theme.ink : Theme.ink2)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 6).fill(selected ? Theme.selected : Theme.card))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(selected ? Theme.ink : Theme.line, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var colorRow: some View {
        let selected = workspace.wrappedValue.color
        let colors = Palette.pigments.map(\.hex) + (Palette.pigment(for: selected) == nil ? [selected] : [])
        return HStack(spacing: 8) {
            ForEach(colors, id: \.self) { hex in
                let name = Palette.pigment(for: hex).map { t("color.\($0.key)") } ?? hex.uppercased()
                Button {
                    workspace.wrappedValue.color = hex
                } label: {
                    Circle()
                        .fill(Color(hexString: hex))
                        .frame(width: 24, height: 24)
                        .padding(3)
                        .overlay(Circle().strokeBorder(selected == hex ? Theme.ink : .clear, lineWidth: 2))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help(name)
                .accessibilityLabel(name)
                .accessibilityAddTraits(selected == hex ? .isSelected : [])
            }
        }
    }

    // MARK: Profile

    private var profileCard: some View {
        let current = workspace.wrappedValue
        let browsers = model.offline ? BrowserKind.allCases : model.installedBrowsers
        let profiles = model.profiles[current.browser] ?? []
        let sharing = model.workspaces.filter {
            $0.id != current.id && $0.browser == current.browser && $0.profileDirectory == current.profileDirectory && !$0.profileDirectory.isEmpty
        }
        return PaneCard(title: t("editor.profileSection"), hint: t("editor.profileHint")) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    FieldLabel(text: t("editor.browser"))
                    Picker(t("editor.browser"), selection: workspace.browser) {
                        ForEach(browsers.isEmpty ? [current.browser] : browsers, id: \.self) { browser in
                            Text(browser.displayName).tag(browser)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 180)
                }
                VStack(alignment: .leading, spacing: 6) {
                    FieldLabel(text: t("editor.profile"))
                    Picker(t("editor.profile"), selection: workspace.profileDirectory) {
                        Text(t("editor.chooseProfile")).tag("")
                        ForEach(profiles) { profile in
                            Text(profile.email.map { "\(profile.name) — \($0)" } ?? profile.name).tag(profile.directory)
                        }
                        if !current.profileDirectory.isEmpty, !profiles.contains(where: { $0.directory == current.profileDirectory }) {
                            Text(current.profileDirectory).tag(current.profileDirectory)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 300)
                }
                Spacer(minLength: 0)
                Button {
                    model.refreshProfiles()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(PaperButtonStyle(small: true))
                .help(t("common.refresh"))
                .accessibilityLabel(t("common.refresh"))
                .padding(.top, 22)
            }
            switch model.profileStatus(current) {
            case .missing:
                Callout(tone: .warning, title: t("error.profileMissing", [
                    "browser": current.browser.displayName, "profile": current.profileDirectory, "name": current.name,
                ]))
            case .browserMissing:
                Callout(tone: .warning, title: t("editor.notInstalled", ["browser": current.browser.displayName]))
            default:
                EmptyView()
            }
            if let other = sharing.first {
                Text(t("editor.sharedProfile", ["other": other.name])).font(Theme.text(12)).foregroundStyle(Theme.warning)
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Button {
                    Task { await model.createProfile(for: current) }
                } label: {
                    Label(t("editor.createProfile"), systemImage: "person.crop.circle.badge.plus")
                }
                .buttonStyle(PaperButtonStyle(dashed: true))
                Text(t("editor.createProfileHint", ["browser": current.browser.displayName]))
                    .font(Theme.text(11.5))
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Pages

    private var pagesCard: some View {
        PaneCard(title: t("editor.pagesSection"), hint: t("editor.pagesHint")) {
            VStack(spacing: 8) {
                ForEach(workspace.links) { $link in
                    let invalid = !link.url.isEmpty && !Links.isOpenable(link.url)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            PaperField(placeholder: t("editor.pageTitle"), text: $link.title).frame(width: 170)
                            PaperField(placeholder: "https://", text: $link.url, invalid: invalid) {
                                if let normalized = Links.normalized(link.url) {
                                    link.url = normalized
                                    if link.title.isEmpty { link.title = Links.defaultTitle(for: normalized) }
                                }
                            }
                            Button {
                                workspace.wrappedValue.links.removeAll { $0.id == link.id }
                            } label: {
                                Image(systemName: "xmark")
                            }
                            .buttonStyle(GhostButtonStyle())
                            .help(t("editor.removePage"))
                            .accessibilityLabel(t("editor.removePage"))
                        }
                        if invalid {
                            Text(t("editor.invalidUrl")).font(Theme.text(11)).foregroundStyle(Theme.danger).padding(.leading, 178)
                        }
                    }
                }
            }
            HStack {
                Button {
                    workspace.wrappedValue.links.append(WorkspaceLink(title: "", url: ""))
                } label: {
                    Label(t("editor.addPage"), systemImage: "plus")
                }
                .buttonStyle(PaperButtonStyle(small: true, dashed: true))
                Spacer()
                Toggle(t("editor.openLinks"), isOn: workspace.openLinksInNewWindow)
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .tint(Theme.accent)
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.ink2)
            }
        }
    }
}
