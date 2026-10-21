import SwapdeckCore
import SwiftUI

/// The manager window: a lacquer sidebar listing the workspaces, and the
/// editor, settings or import page beside it.
struct ManagerView: View {
    @Bindable var model: AppModel
    @Binding var selection: ManagerSelection?

    private var t: Translator { model.t }

    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 232)
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.paper)
        }
        .frame(minWidth: 760, minHeight: 520)
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                MarkView(size: 26)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.white.opacity(0.12)))
                Text("Swapdeck").font(Theme.display(19)).foregroundStyle(Theme.onLacquer)
            }
            .padding(.horizontal, 16)
            .padding(.top, 44)
            .padding(.bottom, 18)

            Text(t("manager.workspaces").uppercased())
                .font(Theme.caps(10))
                .tracking(1.2)
                .foregroundStyle(Theme.onLacquer2)
                .padding(.horizontal, 18)
                .padding(.bottom, 6)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(Array(model.workspaces.enumerated()), id: \.element.id) { index, workspace in
                        sidebarRow(workspace, index: index)
                    }
                    Button {
                        let workspace = model.createWorkspace()
                        selection = .workspace(workspace.id)
                    } label: {
                        Label(t("manager.new"), systemImage: "plus")
                            .font(Theme.text(12.5, .medium))
                            .foregroundStyle(Theme.onLacquer2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10)
                            .frame(height: 32)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(Theme.lacquerLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            )
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                }
                .padding(.horizontal, 10)
            }

            Spacer(minLength: 8)
            VStack(spacing: 2) {
                sidebarItem(t("manager.import"), symbol: "square.and.arrow.down", target: .importing)
                sidebarItem(t("manager.settings"), symbol: "gearshape", target: .settings)
            }
            .padding(.horizontal, 10)
            Text(t("app.tagline"))
                .font(Theme.text(11))
                .foregroundStyle(Theme.onLacquer2)
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.lacquer)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.lacquerLine).frame(width: 1) }
    }

    private func sidebarRow(_ workspace: Workspace, index: Int) -> some View {
        let selected = selection == .workspace(workspace.id)
        return Button {
            selection = .workspace(workspace.id)
        } label: {
            HStack(spacing: 9) {
                WorkspaceBadge(workspace: workspace, size: 22)
                Text(workspace.name)
                    .font(Theme.text(13, selected ? .semibold : .regular))
                    .foregroundStyle(selected ? Theme.onLacquer : Theme.onLacquer2)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if model.frontId == workspace.id {
                    Circle().fill(Theme.lacquerAccent).frame(width: 6, height: 6)
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Theme.lacquerActive : .clear))
            .overlay(alignment: .leading) {
                if selected {
                    RoundedRectangle(cornerRadius: 1.5).fill(Theme.lacquerAccent).frame(width: 3, height: 16).offset(x: -10)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(model.t("switcher.open")) { Task { await model.open(workspace) } }
            Divider()
            Button(t("manager.moveUp")) { model.move(workspace.id, to: index - 1) }.disabled(index == 0)
            Button(t("manager.moveDown")) { model.move(workspace.id, to: index + 1) }.disabled(index == model.workspaces.count - 1)
        }
    }

    private func sidebarItem(_ title: String, symbol: String, target: ManagerSelection) -> some View {
        let selected = selection == target
        return Button {
            selection = target
        } label: {
            Label(title, systemImage: symbol)
                .font(Theme.text(13, selected ? .semibold : .regular))
                .foregroundStyle(selected ? Theme.onLacquer : Theme.onLacquer2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Theme.lacquerActive : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Detail

    @ViewBuilder
    private var detail: some View {
        switch selection {
        case .workspace(let id) where model.workspace(id) != nil:
            WorkspaceEditor(model: model, id: id, selection: $selection).id(id)
        case .settings:
            SettingsPane(model: model)
        case .importing:
            ImportPane(model: model, selection: $selection)
        default:
            VStack(spacing: 12) {
                MarkView(size: 56).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                Text(t("manager.empty")).font(Theme.text(13)).foregroundStyle(Theme.ink3)
            }
        }
    }
}

/// A titled card in the manager's detail pages.
struct PaneCard<Content: View>: View {
    let title: String
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.display(16)).foregroundStyle(Theme.ink)
                if let hint {
                    Text(hint).font(Theme.text(12)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
    }
}

struct FieldLabel: View {
    let text: String

    var body: some View {
        Text(text).font(Theme.text(12, .semibold)).foregroundStyle(Theme.ink)
    }
}

/// Text field in the paper style.
struct PaperField: View {
    let placeholder: String
    @Binding var text: String
    var invalid = false
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(Theme.text(13))
            .focused($focused)
            .onSubmit(onSubmit)
            .padding(.horizontal, 9)
            .frame(height: 30)
            .background(RoundedRectangle(cornerRadius: 7).fill(Theme.card))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .strokeBorder(invalid ? Theme.danger : focused ? Theme.ink : Theme.lineStrong, lineWidth: 1)
            )
    }
}
