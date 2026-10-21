# Swapdeck — notes for AI assistants

Chrome extension (MV3) that switches between several accounts on the same site (Supabase first, 164 presets, any custom
site) by saving and restoring the site's sign-in data, and switches whole **workspaces** (VI "các bên": a client,
company or project = which account each app uses) at once. React 19 + TypeScript + Vite 8, no state library. Read
`docs/ARCHITECTURE.md` before touching switching, storage, the vault or messaging; scope and decisions are in
`docs/PLAN.md`. The product owner speaks Vietnamese.

Open source (MIT), public at github.com/Tanx-1811/swapdeck: keep real emails, tokens and personal names out of code,
tests, demo data and screenshots (use `*.example`/`*.test` addresses). Contributor docs: `CONTRIBUTING.md`,
`SECURITY.md`. Bundled third-party licenses: `npm run notices` (also run by `npm run package`).

## Commands

- `npm run build` — typecheck + production build to `dist/` (load unpacked in `chrome://extensions`); `npm run dev`
  rebuilds on change.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` (Vitest, `tests/unit/`).
- `npm run test:e2e` — builds `dist` and `dist-e2e` (host access granted up front), runs Playwright on Chrome for
  Testing (`npx playwright install chromium` once).
- `npm run package` — zips `dist/` into `release/` (refuses builds with install-time host permissions).
- `npm run icons`, `npm run brand`, `npm run screenshots` — toolbar icons, brand kit (offline, any OS), store
  screenshots.
- `node scripts/verify-presets.mjs [ids…]` — checks the built-in presets against the live sites (network; imports
  `src/core/presets.ts` with Node's type stripping).

## Conventions

- Every UI string goes in `src/i18n/en.ts` **and** `src/i18n/vi.ts` (vi must define every key). Manifest strings live
  in `public/_locales/{en,vi}/messages.json` (description ≤ 132 characters).
- **The service worker is the only writer.** Pages read storage and send requests (`send()` in
  `src/shared/protocol.ts`); every state change goes through `update()`/`exclusive()` in `src/background/state.ts`.
  Never call `update`, `exclusive`, `storeSnapshot`, `persist` or `wipeData` from inside another
  `update`/`exclusive` task: the single queue deadlocks.
- Long work (switch, save, page reconcile) holds the **per-app lock** (`withAppLock` in `engine.ts`), not the global
  queue. While a switch/save runs (`busyApps`), the watcher ignores the app's URL/title changes and the staging page;
  completed loads wait for the lock and are reconciled afterwards.
- Workspace switches go through `switchWorkspace` (`src/background/workspaces.ts`), which calls `switchTo` once per app
  with `{ background: true, via: <workspace name> }` — the current tab's app first, in that tab; apps without open tabs
  share one hidden tab (`hiddenTabId`, owned and closed by `switchWorkspace`). Progress goes to `sd:progress`
  (session storage). Don't open visible tabs from a workspace switch.
- The popup and the side panel are the same component, `src/popup/Switcher.tsx` (state + actions in
  `SwitcherContext`, layouts compact / wide 720 px / panel); `src/sidepanel/main.tsx` only mounts it with
  `mode="panel"`. Switching another app's account from it uses `background: true` unless the user asked to open it.
- Presets (`src/core/presets.ts`) must not share or nest domains (unit-tested) and must not use blocked
  Google/Microsoft/Apple domains; verify new ones with `scripts/verify-presets.mjs`.
- Functions in `src/background/page-scripts.ts` are serialized by `chrome.scripting.executeScript`: keep them
  self-contained (no imports, no outer references), JSON-safe in and out, and never rebuild arbitrary constructors from
  saved data (typed arrays use a whitelist).
- Data from storage, backups or pages is untrusted: validate it with `src/core/validate.ts`, `parseSettings`,
  `sanitizePayload`.
- Saving must stay identity-checked: route new save paths through `decideSave` (`src/core/decide.ts`) or the explicit
  checks in `saveLive`. Never write a session into an account whose identity differs.
- Pure logic lives in `src/core/` and is unit-tested; components reach Chrome only through `src/shared/`, `src/ui/` and
  messaging. Don't import React or DOM-bound code into `src/background/`.
- New permission? Update `src/manifest.ts` (comment), `docs/PRIVACY.md`, `docs/STORE_LISTING.md` and
  `docs/ARCHITECTURE.md` §12 (Permissions).

## Safety features

- `Account.important` (production / a client's live account): red `.flag-important` label, confirmation before
  switching to it from every UI path (popup `switchAccount`/`switchWorkspace`, manager `AppDetail`/`useWorkspaceSwitch`,
  via `importantTargets`), warning toast, and the `showRibbon` page strip kept by `markImportant` in `watcher.ts`.
  Shortcut, omnibox and menu switches can't ask: they rely on the strip and the toast.
- Every UI switch path asks through `useAskBeforeSwitch` (important accounts, unsaved work via the `unsaved` request,
  "ask before every switch"); non-UI paths (commands, omnibox, context menus) must call `runGuarded`/`cycleGuarded`
  (`guarded.ts`), never `switchTo`/`switchWorkspace` directly. `unsavedWork` runs in the MAIN world: keep it
  self-contained and side-effect free beyond the synthetic `beforeunload`.
- The lock reminder (`VaultNudge`, `vaultNudgeDue`) shows with ≥ 2 saved sessions and no vault; "Later" sets
  `settings.vaultNudgeUntil`. Demo data hides it unless `seedDemo(…, { vaultNudge: true })`.

## Swapdeck Desktop (`desktop/`)

- A separate macOS menu bar app in Swift (SwiftPM, macOS 14+): each workspace is its own browser profile, opened with
  `open -n -b <browser> --args --profile-directory=…` and found again by the window's AppleScript `given name`. It
  never touches sign-ins. `SwapdeckCore` (no AppKit) holds the logic and is tested with `swift test`;
  `SwapdeckDesktop` is the SwiftUI/AppKit app. Read `desktop/README.md`.
- `cd desktop && swift test`, `./scripts/build-app.sh` (universal `.app` + `release/swapdeck-desktop-<v>.zip`), and
  `--render-previews <dir>` on the built binary to check the UI without a browser.
- Only validated http(s) URLs and profile folder names reach the command line (`Launcher`, `Links`,
  `ProfileReader.isProfileDirectory`); AppleScript strings go through `BrowserScript.literal`. Keep it that way.
- UI text lives in `SwapdeckCore/L10n.swift` (en and vi must have the same keys — tested). Colors mirror the
  extension's tokens (`Theme.swift`); keep the pigment palette and symbol keys in step with `src/core/util.ts`.
- The extension's backup format (`swapdeck-backup` v1, PBKDF2-SHA-256 + AES-256-GCM) is read by `BackupImport`; if it
  changes, update both and regenerate the fixture with `node desktop/scripts/make-backup-fixture.mjs`.

## Design ("sơn mài & giấy dó", lacquer & paper)

- Colors are tokens in `src/styles/ui.css`: ink on warm paper (light), eggshell on lacquer (dark), `--lacquer*` for the
  popup lid and the manager sidebar, `--accent*` switched by `<html data-accent>` (Settings → accent: son, ngọc, chàm,
  vàng). Components use tokens, never raw colors. Keep the brand kit (`brand/README.md`) in step.
- What is in use wears the **seal** (`.seal`) and, for cards, the deck shadow (`.account--active`,
  `.account-card--active`, `.workspace-card--active`). Primary buttons are ink (`btn--primary`); "add another" is
  `btn--dashed`.
- Fonts are bundled from @fontsource (`src/styles/fonts.ts`): Be Vietnam Pro (text), Fraunces 600 (titles, figures,
  `.display`), JetBrains Mono. Never load web fonts from the network.
- Account/workspace symbols are `ACCOUNT_ICONS` (`src/core/util.ts`, drawn in `src/ui/icons.tsx`); colors come from
  `ACCOUNT_COLORS` with names in `COLOR_NAMES` (`color.*` messages) through `ColorPicker`/`IconPicker`. Emoji are legacy
  (still shown, no longer offered).
- `tests/e2e/a11y.spec.ts` audits every page in light and dark and each accent: new colors must pass WCAG AA. Don't
  animate the opacity of text (axe reads it mid-animation).

## Tests

- E2E pages are ready when `html[data-ready]` is set. The popup (`popup/popup.html`) and the side panel
  (`sidepanel/sidepanel.html`) are opened as tabs with `?tab=<tabId>` (the tab they act on) and optionally
  `&app=<appId>`; in that mode they don't close themselves. Workspaces, the wide popup, search, the side panel and bulk
  adding are covered by `tests/e2e/workspaces.spec.ts` (two fake sites, `acme.test` and `globex.test`).
- Every `*.test` host maps to the local test server (`--host-resolver-rules=MAP *.test 127.0.0.1`, HTTPS upgrades
  off). The fake app (`tests/e2e/test-server.ts`) signs in with an HttpOnly cookie, a page cookie and a supabase-js
  style `sb-acme-auth-token` in local storage, and serves `/robots.txt` as the staging page.
- `tests/e2e/demo-data.ts` seeds realistic data straight into `chrome.storage.local` for screenshots.
- Official Chrome can't load unpacked extensions from the command line; tests use Chrome for Testing.

## Pitfalls

- A switch leaves a declarativeNetRequest session rule (script-blocking CSP) on its tab until it finishes; rules from an
  interrupted switch are cleared whenever the worker starts (`clearStaleRules`).
- Supabase's dashboard stores the session in `supabase.dashboard.auth.token` and the user separately in
  `supabase.dashboard.auth.token-user` — the preset detector reads both.
- `storeSnapshot` moves the current snapshot to `sd:prev:*` unless `keepPrevious: false` (auto-sync refreshes); auto-sync
  saves at most once a minute per app.
- Single-page apps sign in without a page load: the watcher re-checks a tab after SPA address changes and once after a
  load that found nobody signed in (`checkLater` in `watcher.ts`).
- `chrome.sidePanel.open` only works straight from a user gesture: in command and menu handlers call it before any
  `await` (see `openSidePanel` in `service-worker.ts`). With "toolbar button opens: side panel" the worker sets the
  action popup to `''` and `openPanelOnActionClick` (`applyActionBehavior`).
- Workspace members are `appId → accountId`; deleting an account or an app prunes them (`pruneMembers`), and
  `liveMembers` ignores members that no longer exist. Suggestions (`suggestWorkspaces`) group accounts by email domain
  and skip domains that already have a workspace.
- The switching page falls back to `/favicon.ico`, `/robots.txt`, `/` when it redirects off the main origin
  (`stagingCandidates` in `engine.ts`). `npm run test:live` checks every preset on the real site (network; not in CI).
- Avoid common words for the omnibox keyword and keep shortcuts clear of Penmark (`Alt+Shift+N/K/H/C`) and Breakpointer
  (`Alt+Shift+V/P`); new commands get no default key (Chrome allows four suggested keys).
