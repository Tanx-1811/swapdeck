import AppKit
import SwapdeckCore
import SwiftUI
import UniformTypeIdentifiers

struct SettingsPane: View {
    @Bindable var model: AppModel

    private var t: Translator { model.t }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(t("manager.settings")).font(Theme.display(28)).foregroundStyle(Theme.ink)
                PaneCard(title: t("settings.language")) {
                    Picker(t("settings.language"), selection: binding(\.language)) {
                        Text(t("settings.languageAuto")).tag(LanguagePreference.auto)
                        Text("Tiếng Việt").tag(LanguagePreference.vi)
                        Text("English").tag(LanguagePreference.en)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(maxWidth: 360)
                }
                PaneCard(title: t("settings.hotkey")) {
                    Picker(t("settings.hotkey"), selection: binding(\.hotkey)) {
                        ForEach(HotkeyChoice.allCases, id: \.self) { choice in
                            Text(choice == .off ? t("settings.hotkeyOff") : choice.display).tag(choice)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(maxWidth: 420)
                    toggleRow(
                        t("settings.launchAtLogin"),
                        hint: t("settings.launchAtLoginHint"),
                        isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) })
                    )
                }
                PaneCard(title: t("editor.profileSection")) {
                    toggleRow(t("settings.nameWindows"), hint: t("settings.nameWindowsHint"), isOn: binding(\.nameWindows))
                    HStack {
                        Text(t("settings.defaultBrowser")).font(Theme.text(13)).foregroundStyle(Theme.ink)
                        Spacer()
                        Picker(t("settings.defaultBrowser"), selection: binding(\.defaultBrowser)) {
                            ForEach(model.installedBrowsers.isEmpty ? BrowserKind.allCases : model.installedBrowsers, id: \.self) {
                                Text($0.displayName).tag($0)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 200)
                    }
                    Divider()
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(t("settings.permission")).font(Theme.text(13)).foregroundStyle(Theme.ink)
                            Text(permissionText)
                                .font(Theme.text(12))
                                .foregroundStyle(model.automation == .denied ? Theme.warning : Theme.ink2)
                        }
                        Spacer()
                        if model.automation == .denied {
                            Button(t("switcher.permissionAction")) { model.openAutomationSettings() }
                                .buttonStyle(PaperButtonStyle(small: true))
                            Button(t("common.refresh")) { Task { await model.recheckAutomation() } }
                                .buttonStyle(GhostButtonStyle())
                        }
                    }
                }
                PaneCard(title: t("settings.links"), hint: t("settings.linksHint")) {
                    let _ = model.defaultBrowserCheck
                    HStack {
                        Label(
                            model.isDefaultBrowser ? t("settings.defaultBrowserOn") : t("settings.defaultBrowserOff"),
                            systemImage: model.isDefaultBrowser ? "checkmark.circle.fill" : "circle.dashed"
                        )
                        .font(Theme.text(13))
                        .foregroundStyle(model.isDefaultBrowser ? Theme.success : Theme.ink2)
                        Spacer()
                        if !model.isDefaultBrowser {
                            Button(t("settings.makeDefault")) { Task { await model.makeDefaultBrowser() } }
                                .buttonStyle(InkButtonStyle(small: true))
                        }
                    }
                    HStack {
                        Text(t("settings.unmatched")).font(Theme.text(13)).foregroundStyle(Theme.ink)
                        Spacer()
                        Picker(t("settings.unmatched"), selection: binding(\.unmatchedLinks)) {
                            Text(t("settings.unmatched.ask")).tag(UnmatchedLinks.ask)
                            Text(t("settings.unmatched.front")).tag(UnmatchedLinks.front)
                            Text(t("settings.unmatched.browser")).tag(UnmatchedLinks.browser)
                        }
                        .labelsHidden()
                        .frame(width: 200)
                    }
                    Text(t("settings.optionKeyHint")).font(Theme.text(12)).foregroundStyle(Theme.ink3)
                }
                PaneCard(title: t("settings.data"), hint: t("settings.dataHint")) {
                    HStack {
                        Text(model.store.fileURL.path(percentEncoded: false))
                            .font(Theme.mono(11))
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        Button(t("settings.showData")) { model.showDataInFinder() }
                            .buttonStyle(PaperButtonStyle(small: true))
                    }
                }
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "lock.shield").foregroundStyle(Theme.success).font(.system(size: 16))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("settings.privacy")).font(Theme.text(12.5)).foregroundStyle(Theme.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(t("settings.version", ["version": AppInfo.version])).font(Theme.text(11.5)).foregroundStyle(Theme.ink3)
                        HStack(spacing: 12) {
                            Link(t("settings.sourceCode"), destination: AppInfo.repository)
                            Link(t("settings.reportIssue"), destination: AppInfo.repository.appendingPathComponent("issues/new/choose"))
                        }
                        .font(Theme.text(12, .semibold))
                        .tint(Theme.accentText)
                        .padding(.top, 2)
                    }
                }
                .padding(.horizontal, 4)
            }
            .padding(.horizontal, 28)
            .padding(.top, 34)
            .padding(.bottom, 28)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }

    private var permissionText: String {
        switch model.automation {
        case .allowed: t("settings.permissionAllowed")
        case .denied: t("settings.permissionDenied")
        case .unknown: t("settings.permissionUnknown")
        }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<DesktopSettings, Value>) -> Binding<Value> {
        Binding(get: { model.data.settings[keyPath: keyPath] }, set: { value in model.setSettings { $0[keyPath: keyPath] = value } })
    }

    private func toggleRow(_ title: String, hint: String, isOn: Binding<Bool>) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.text(13)).foregroundStyle(Theme.ink)
                Text(hint).font(Theme.text(12)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 16)
            Toggle(title, isOn: isOn).toggleStyle(.switch).labelsHidden().tint(Theme.accent)
        }
    }
}

struct ImportPane: View {
    @Bindable var model: AppModel
    @Binding var selection: ManagerSelection?
    @State private var pendingFile: Data?
    @State private var password = ""
    @State private var askPassword = false
    @State private var passwordError = false

    private var t: Translator { model.t }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(t("manager.import")).font(Theme.display(28)).foregroundStyle(Theme.ink)
                PaneCard(title: t("import.profilesTitle"), hint: t("import.profilesHint")) {
                    let browsers = model.installedBrowsers.filter { !(model.profiles[$0] ?? []).isEmpty }
                    if browsers.isEmpty {
                        Text(t("import.profilesNone")).font(Theme.text(12.5)).foregroundStyle(Theme.ink3)
                    }
                    ForEach(browsers, id: \.self) { browser in
                        let unused = WorkspaceLogic.unusedProfiles(model.profiles[browser] ?? [], workspaces: model.data.workspaces, browser: browser)
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: browser.displayName)
                            if unused.isEmpty {
                                Text(t("import.profilesNone")).font(Theme.text(12.5)).foregroundStyle(Theme.ink3)
                            } else {
                                FlowList(items: unused.map { ($0.directory, $0.name, $0.color) })
                                Button(unused.count == 1 ? t("import.createOne") : t("import.create", ["n": String(unused.count)])) {
                                    let count = model.importProfiles(browser)
                                    model.show(.info, t("import.created", ["n": String(count)]))
                                    if let first = model.workspaces.last { selection = .workspace(first.id) }
                                }
                                .buttonStyle(InkButtonStyle())
                            }
                        }
                    }
                }
                PaneCard(title: t("import.backupTitle"), hint: t("import.backupHint")) {
                    Button(t("import.chooseFile")) { chooseFile() }
                        .buttonStyle(PaperButtonStyle())
                }
                PaneCard(title: t("import.moveTitle"), hint: t("import.moveHint")) {
                    HStack(spacing: 8) {
                        Button(t("import.export")) { exportFile() }
                            .buttonStyle(InkButtonStyle())
                        Button(t("import.rematch")) {
                            let count = model.rematchProfiles()
                            model.show(.info, t("import.rematched", ["n": String(count)]))
                        }
                        .buttonStyle(PaperButtonStyle())
                    }
                    Text(t("import.macNote")).font(Theme.text(12)).foregroundStyle(Theme.ink3)
                }
                if let banner = model.banner {
                    Callout(tone: banner.tone == .error ? .danger : .success, title: banner.text)
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 34)
            .padding(.bottom, 28)
            .frame(maxWidth: 720, alignment: .leading)
        }
        .alert(t("import.password"), isPresented: $askPassword) {
            SecureField(t("import.password"), text: $password)
            Button(t("import.open")) { importPending() }
            Button(t("common.cancel"), role: .cancel) {
                pendingFile = nil
                password = ""
            }
        } message: {
            Text(passwordError ? t("import.wrongPassword") : t("import.passwordPrompt"))
        }
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        // A Swapdeck Desktop export from another Mac?
        if let result = try? model.importDesktopFile(data) {
            model.show(.info, result.added == 0 ? t("import.nothing") : t("import.desktopImported", [
                "n": String(result.added), "matched": String(result.matched), "missing": String(result.missing),
            ]))
            if result.added > 0, let last = model.workspaces.last { selection = .workspace(last.id) }
            return
        }
        do {
            if try BackupImport.isEncrypted(data) {
                pendingFile = data
                passwordError = false
                askPassword = true
            } else {
                finish(try model.importBackup(data, password: nil))
            }
        } catch {
            model.show(.error, t("import.notBackup"))
        }
    }

    private func exportFile() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        let stamp = ISO8601DateFormatter().string(from: Date()).prefix(10)
        panel.nameFieldStringValue = "swapdeck-desktop-\(stamp).json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try model.exportFile().write(to: url, options: .atomic)
            model.show(.info, t("import.exported", ["file": url.lastPathComponent]))
        } catch {
            model.show(.error, t("error.save", ["detail": error.localizedDescription]))
        }
    }

    private func importPending() {
        guard let data = pendingFile else { return }
        do {
            finish(try model.importBackup(data, password: password))
            pendingFile = nil
            password = ""
        } catch BackupImport.Failure.wrongPassword {
            passwordError = true
            password = ""
            // Ask again once the alert has gone.
            DispatchQueue.main.async { askPassword = true }
        } catch {
            pendingFile = nil
            model.show(.error, t("import.notBackup"))
        }
    }

    private func finish(_ count: Int) {
        model.show(.info, count == 0 ? t("import.nothing") : t("import.imported", ["n": String(count)]))
        if count > 0, let last = model.workspaces.last { selection = .workspace(last.id) }
    }
}

/// Small chips for profile names, wrapping onto new lines.
struct FlowList: View {
    let items: [(id: String, name: String, color: String?)]

    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(items, id: \.id) { item in
                HStack(spacing: 6) {
                    Circle().fill(item.color.map(Color.init(hexString:)) ?? Theme.ink3).frame(width: 8, height: 8)
                    Text(item.name).font(Theme.text(12, .medium)).foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.paper))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.line, lineWidth: 1))
            }
        }
    }
}

/// Lays children out left to right, wrapping like text.
struct WrapLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 600
        var x: CGFloat = 0
        var y: CGFloat = 0
        var row: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += row + spacing
                row = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            row = max(row, size.height)
        }
        return CGSize(width: min(widest, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += row + spacing
                row = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

enum AppInfo {
    static let repository = URL(string: "https://github.com/Tanx-1811/swapdeck")!

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
    }
}
