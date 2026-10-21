# Swapdeck — architecture

Swapdeck is a Manifest V3 Chrome extension that keeps one saved sign-in ("session") per account and swaps it into
the browser when the user switches — one app at a time, or a whole **workspace** (a client, company or project: which
account each app uses) at once. This document explains how the pieces fit, where data lives and exactly what a switch
does. Product scope and decisions are in [PLAN.md](PLAN.md); privacy in [PRIVACY.md](PRIVACY.md).

## 1. Components

| Part           | Entry                                         | Role                                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switcher       | `src/popup/` (`popup/popup.html`)             | Toolbar popup (compact or 720 px wide): workspace bar, search over workspaces/apps/accounts, app list, accounts of the selected app (switch, sign in with another account, save this session, edit/pin/delete), unlock, add this site. See section 8. |
| Side panel     | `src/sidepanel/` (`sidepanel/sidepanel.html`) | The same switcher (`mode="panel"`), kept open next to the page; follows the active tab of its window.                                                                                                                                                 |
| Manager        | `src/options/` (`options/options.html#/…`)    | Full-page UI: overview, workspaces (list, suggestions, editor), apps & accounts, add app (preset gallery with multi-select, or any site), app settings, history, backup, security (passphrase lock), settings, help.                                  |
| Service worker | `src/background/service-worker.ts`            | The only writer of state. Switching apps and workspaces, saving, watching tabs, badge, context menus (pages and toolbar button), omnibox (`swd`), commands, side-panel behaviour, auto-lock.                                                          |
| Page scripts   | `src/background/page-scripts.ts`              | Self-contained functions injected with `chrome.scripting.executeScript` (isolated world): read/write web storage and IndexedDB, probe the page, overlay, in-page toast, warning strip for important accounts.                                         |
| Core           | `src/core/`                                   | Pure, unit-tested logic: types, presets (164), domains, identity detection, save decisions, workspaces (status, suggestions, tab-group colours), search ranking, cookies, crypto, backup format, validation, settings.                                |
| Shared         | `src/shared/`                                 | Storage layout and readers (`store.ts`), typed messaging (`protocol.ts`), app helpers (`apps.ts`).                                                                                                                                                    |
| UI kit         | `src/ui/`, `src/styles/ui.css`                | Shared React components (dialogs, menus, toasts, avatars, app icons, account editor, icon and color pickers), hooks, i18n provider, design tokens (lacquer & paper, light/dark, accent colors), bundled fonts.                                        |
| i18n           | `src/i18n/en.ts`, `vi.ts`                     | Every UI string, English and Vietnamese. Manifest strings live in `public/_locales/{en,vi}`.                                                                                                                                                          |

### Service worker modules (`src/background/`)

| Module          | Responsibility                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router.ts`     | Answers `chrome.runtime` messages from the extension's own pages only (refuses senders in http(s) tabs and other extensions).                                  |
| `engine.ts`     | `switchTo`, `saveLive`, `cycle`, `probe`, `capture`, `persist`, `restorePrevious`, per-app locks, staging tab helper.                                          |
| `workspaces.ts` | `switchWorkspace` (every app of a workspace, background where possible, progress), `openWorkspace` (then its pages in a tab group).                            |
| `watcher.ts`    | Reacts to app page loads: detects who is signed in, auto-sync, auto-capture, mismatch flag, confirmation toasts, important-account strip, last page & recents. |
| `state.ts`      | Single write queue (`exclusive`, `update`), history, snapshot packing/sealing, vault key in session storage.                                                   |
| `admin.ts`      | Apps (incl. `addApps` in one step)/accounts/workspaces CRUD and cascades, settings, vault, backups (export/inspect/import), wipe.                              |
| `guard.ts`      | The declarativeNetRequest session rule that blocks page scripts in the tab doing a swap.                                                                       |
| `cookie-jar.ts` | Read/clear/write cookies of an app's domains through `chrome.cookies`.                                                                                         |
| `tabs.ts`       | Tab queries for an app, `navigateAndWait`, `waitForComplete`, `runInTab`.                                                                                      |
| `badge.ts`      | Per-tab toolbar badge (active account's initials and colour) and tooltip.                                                                                      |
| `menus.ts`      | Right-click menu per app (`documentUrlPatterns`) and on the toolbar button (workspaces, side panel); rebuilt only when it changes.                             |
| `omnibox.ts`    | `swd` keyword: ranked workspace and account suggestions, switch on Enter.                                                                                      |

## 2. Data model and storage

Types are in `src/core/types.ts`. An **app** (`AppDef`) is a site: its cookie `domains` (subdomains included), its
main `origin` (whose web storage is swapped), `homeUrl`, optional `loginUrl`, a `stagingPath`, which parts of the
session to swap (`storage`: cookies, localStorage, sessionStorage, IndexedDB), a `detector` (how to recognise who is
signed in) and optional `recentPattern`/`titleSuffix` for recent items. An **account** belongs to one app and holds
display data (label, colour, emoji, note), the recognised identity (`identityId`, `email`, `name`, `avatarUrl`), page
memory (`lastUrl`, `pins` ≤ 30, `recents` ≤ 6), usage and `stats` of its saved session. A **snapshot** is the saved
session itself: cookies plus a `WebStorageDump` of the main origin, and the identity detected when it was taken. A
**workspace** (`Workspace`) has a name, colour, optional emoji and note, `members` (`appId → accountId`; apps not listed
are left alone), `links` (pages for "Open workspace", ≤ 30) and usage counters.

`chrome.storage.local` (persistent, this device only, `unlimitedStorage`):

| Key                 | Contents                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sd:apps`           | `AppDef[]`                                                                                                        |
| `sd:accounts`       | `Account[]` (metadata only, no session data)                                                                      |
| `sd:active`         | `{ [appId]: accountId \| null }` — which saved account the browser is signed in as, per app                       |
| `sd:settings`       | `Settings` (language, theme, after-switch page, auto-capture, auto-sync, toasts, accent, lock reminder snooze, …) |
| `sd:history`        | Last 200 `HistoryEntry` items (switch, fresh, save, auto-save; ok or error code)                                  |
| `sd:vault`          | `VaultMeta` when the passphrase lock is on                                                                        |
| `sd:workspaces`     | `Workspace[]`                                                                                                     |
| `sd:meta`           | `{ schema: 1 }`                                                                                                   |
| `sd:snap:<account>` | `StoredSnapshot`: `{ v: 1, plain: Snapshot }` or, with the vault on, `{ v: 1, sealed: … }`                        |
| `sd:prev:<account>` | The snapshot the current one replaced (safety net, "Restore the session saved before")                            |

`chrome.storage.session` (memory only, cleared when Chrome closes; extension pages and the worker only):

| Key           | Contents                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| `sd:key`      | The unlocked vault private key (PKCS#8, base64) while the vault is unlocked                 |
| `sd:live`     | Per app: last detected identity, whether it mismatches the active account, URL              |
| `sd:progress` | While a workspace switch runs: `{ workspaceId, total, done, current }` (shown in the popup) |

Everything read from storage, backups or pages is untrusted and goes through `src/core/validate.ts`
(`sanitizeApp`, `sanitizeAccount`, `sanitizeSnapshot`, …) or `parseSettings`.

**Single writer.** Only the service worker writes. `state.ts` serialises every change through one promise queue:
`update(draft => …)` reads the state, applies the change and writes back only the keys that changed;
`storeSnapshot` writes a snapshot (sealing it if a vault exists, checked inside the queue) and moves the old one to
`sd:prev:*` — except for auto-sync refreshes (`keepPrevious: false`), so "previous" stays the copy from before the last
real save. Both run inside `exclusive()`, so they must never be called from inside another `update`/`exclusive`
task (that deadlocks). Pages read state directly and subscribe to `chrome.storage.onChanged` (`useSwapdeck`).

Long operations (a switch takes a few seconds) do not hold the global queue: they hold a **per-app lock**
(`withAppLock`), which serialises switches, saves and page reconciliation of the same app. While a switch or save runs
(`busyApps`), the app's address/title changes are ignored and the staging page never counts; finished page loads wait
for the lock and are reconciled afterwards.

## 3. Switching (`engine.ts` → `switchTo`)

1. **Fail early.** Under the app lock: read state, require host access for the app's domains, and load the target
   snapshot (unsealing it needs the vault key → `LOCKED`; missing → `NO_SESSION`; unreadable → `CORRUPT`). Nothing
   has changed yet.
2. **Pick the work tab:** the requested tab, else the focused tab if it shows the app, else any active tab of the
   app, else any of its tabs. With none open: a **hidden** tab when `background` is set (the caller's `hiddenTabId` if
   given, e.g. the one a workspace switch shares between apps; else a new inactive `about:blank`), otherwise a new
   foreground tab.
3. **Park the other tabs** of the app: inactive ones are discarded (they reload with the new session when
   activated); active ones (in other windows) and undiscardable ones are reloaded at the end.
4. **Block page scripts** in the work tab: a declarativeNetRequest session rule (`guard.ts`) sets
   `Content-Security-Policy: script-src 'none'; object-src 'none'; worker-src 'none'` on main-frame responses of the
   app's domains, for that tab only, until the swap ends.
5. **Staging page.** The work tab navigates to `origin + stagingPath` (default `/robots.txt`; DigitalOcean uses
   `/manifest.json`). The app's own scripts unload, so nothing can write the old session back mid-swap; even if the
   site answers that path with its app shell, the CSP keeps its scripts from running. The page's origin is verified
   (`STAGING_FAILED` on redirects elsewhere) and a "Switching to …" overlay is drawn.
   If the page redirects to another origin (some sites send signed-out visitors to a separate sign-in host), the
   switch tries `/favicon.ico`, `/robots.txt` and `/` on the main origin before failing with `STAGING_FAILED`
   (`stagingCandidates`/`openStaging` in `engine.ts`); the watcher ignores those fallback loads while the app is busy.
6. **Capture the live session** (`capture`): localStorage (always read, for detection), sessionStorage and
   IndexedDB when the app swaps them (IndexedDB over 40 MB fails the switch), and the cookies of every app domain;
   then detect the identity.
7. **Save it where it belongs** (`decideSave`, section 5) and `persist` it: into the active account, into the saved
   account it really belongs to, or into a new account — or skip it when it is empty or signed out.
8. **Swap** (`applySnapshot`): clear the app domains' cookies, set the target's cookies (expired ones skipped,
   host-only and `__Host-`/`__Secure-` rules respected), then replace localStorage/sessionStorage/IndexedDB on the
   staging page. If the live session _is_ the target (re-opening the active account), nothing is swapped: the live
   session is newer than the saved copy.
9. **On any error** after the swap began, the captured live session is put back; then the rule is removed, the
   work tab returns to its page (or a tab Swapdeck created is closed), parked tabs reload, and a failed history entry
   is recorded.
10. **Finish:** remove the rule, record `active`, `lastUsedAt`, `switchCount` and history (tagged `via` the workspace
    name when part of a workspace switch), register a pending toast for the work tab, open the destination and reload
    parked tabs. Destination: an explicit URL, else the account's fixed start page, else per setting the account's last
    page (`last`, default), the same page (`same`) or the app's home page; "sign in with another account" opens
    `loginUrl` (or home). **Background switch of an app with no open tab:** no destination and no toast — the hidden
    tab is closed (or left to its owner when borrowed).

"Sign in with another account" is the same flow with no target (`kind: 'fresh'`): the live session is saved, the
app's cookies and storage are cleared, and the sign-in page opens.

`saveLive` ("Save this session") captures from a tab on the main origin, or from a hidden staging tab when there is
none, and saves into a new account, a chosen account (refused with `INVALID: identity` if the detected identity is a
different person) or, by default, the account the identity belongs to (else a new one). It makes that account
active.

## 4. Identity detection (`core/identity.ts`)

Detection reads only captured data (cookies and local storage), never the network. A `DetectorSpec` is one of:

- `localStorage` — entries by name (`*` wildcard); values parsed as JSON (also double/URL-encoded), JWT or Supabase's
  `base64-` format; fields read by dotted paths (defaults cover `user.id`, `user.email`, `sub`, `email`,
  `user.user_metadata.*`, …), falling back to the claims of an `access_token`. **Supabase dashboard:**
  `supabase.dashboard.auth.token-user` and `supabase.dashboard.auth.token` (the dashboard's auth-js keeps the user in
  a separate entry).
- `cookie` — cookies by name, format `plain` (value is the user, e.g. GitHub's `dotcom_user`), `json`, `jwt` or
  `supabase-ssr` (chunked `name.0`, `name.1`, … joined).
- `auto` — heuristics, in order: supabase-js `sb-*-auth-token(-user)` in local storage; `@supabase/ssr`
  `sb-*-auth-token` cookies; Firebase `firebase:authUser:*`; a JWT with an email claim in a cookie or entry named
  like a credential. These are **strong**. A user-like JSON record with an email is a **weak** guess: shown, never
  acted on.
- `none`.

`sameIdentity` compares the stable id first, then the email (case-insensitive), then the name when neither has an id
or email. `isSpecificDetector` (localStorage/cookie) means "finding nobody" can be trusted as "signed out".

## 5. Save decisions (`core/decide.ts`)

`decideSave` decides where the live session goes before it is replaced. The invariant: a session is never written
into an account it provably doesn't belong to, and a signed-in session nobody saved is never thrown away.

| Live session                                          | Decision                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| No cookies, no storage                                | skip (`empty`)                                                  |
| Strong identity = active account (or active has none) | save into the active account                                    |
| Strong identity = another saved account               | save into that account (the user signed in by hand)             |
| Strong identity, nobody saved                         | save as a new account                                           |
| No strong identity, specific detector                 | skip (`signed-out`) — never overwrite with a signed-out session |
| No strong identity, `auto`/`none` detector            | save into the active account, else a new account                |

## 6. Watching pages (`watcher.ts`)

On `tabs.onUpdated` for tabs of an added app (with access, not incognito, not the staging page):

- **On load complete** (`reconcile`, under the app lock): detect the identity (cookies, plus local storage when the
  tab is on the main origin).
  - Strong identity of the active account → **auto-sync**: re-capture and save it, at most once a minute per app and
    only on the main origin. This keeps saved sessions fresh as sites rotate refresh tokens.
  - Strong identity of someone else, with auto-capture on and the tab on the main origin → **auto-capture**: save it
    into the matching saved account or a new one, make it active, record `auto-save`, toast "Saved new account …" /
    "Now using …".
  - Otherwise mark a **mismatch** in `sd:live` (badge shows `!`, popup explains).
  - A pending switch toast for this tab (≤ 60 s old) is shown: success, "still signed in as …" (wrong account) or
    "session expired" (signed out with a specific detector), or the "signed out — sign in with another account"
    note after a fresh sign-in.
- **Important accounts** (`Account.important`): after each reconcile of an app that has any, `markImportant` injects
  `showRibbon` — a red strip and tag along the top of the page (closed shadow root, no pointer events) — when the
  account really signed in there (the recognised identity, else the active account unless the page shows nobody) is
  important, and removes it otherwise. The switch toast turns to a warning; the popup, side panel, manager and
  workspace switches confirm first (`importantTargets` in `core/workspaces.ts` lists them for a workspace).
- **Single-page apps** sign in without reloading (the Supabase dashboard does), so a tab is checked again 0.9 s after
  an address change on a loaded page, and once 2.5 s after a load that found nobody signed in (sessions written just
  after load, e.g. OAuth redirects). Choosing the account already in use records a `restore`.
- **On load and SPA navigation/title changes** (`trackPage`): remember the active account's `lastUrl` and recent
  items (`recentPattern`, e.g. Supabase project refs `^/dashboard/project/([a-z0-9]{20})` with the project name from
  the title), skipping sign-in/out paths, the staging page and mismatched tabs.

## 7. Workspaces (`core/workspaces.ts`, `background/workspaces.ts`)

A workspace is the unit for people who work for several parties ("các bên"): which saved account each app uses for a
client, company or project.

- **Status** (`workspaceStatus`): `liveMembers` keeps only members whose app and account still exist; a workspace is
  `active` when every member's account is in use (`sd:active`), `partial`, `inactive` or `empty`. Deleting an account
  or app prunes it from every workspace (`pruneMembers`).
- **Switching** (`switchWorkspace(id, tabId?)`): fails early with `NO_SESSION` for an empty workspace and with
  `LOCKED` if any member to switch has a sealed session while the vault is locked. Members already in use are reported
  as `already`. The others switch one after another — the current tab's app first, in that tab — through
  `switchTo({ background: true, via: name })`: apps with open tabs swap in one of them (the others are parked and
  reload); apps with no open tab all swap in **one hidden tab** created on demand and closed at the end. Each member
  ends as `switched`, `no-session` (account without a saved session), `no-access` (host access missing) or `failed`
  (with the error code); one failure doesn't stop the rest. Progress (`{ workspaceId, total, done, current }`) is kept
  in `sd:progress` for the popup. `lastUsedAt` and `switchCount` are updated.
- **Open workspace** (`openWorkspace`): switches, then opens the workspace's `links` in the last focused normal window
  and groups them (`chrome.tabs.group` + `chrome.tabGroups.update`) under the workspace's name, in the Chrome group
  colour closest to its own (`tabGroupColor`).
- **Creating:** the editor (`#/workspaces/new`, `#/workspaces/<id>`) picks an account per app ("Leave as it is" omits
  the app) or fills them from the accounts in use; `workspace.fromActive` saves the accounts in use under a name.
  **Suggestions** (`suggestWorkspaces`) group accounts by email domain (free-mail domains such as gmail.com together as
  "Personal"), need accounts on two or more apps, take the most recently used account per app, and skip domains for
  which a workspace already holds two or more accounts.
- **Entry points:** the popup's workspace bar and search, the manager (Workspaces page, overview card), the toolbar
  button's right-click menu (`contexts: ['action']`, the fully active workspace checked), the `swd` omnibox (workspace
  suggestions come first; plain text that matches a workspace switches it), and the `switch-workspace-next` command
  (no default key; goes to the workspace after the one fully in use).

## 8. Popup, side panel and search (`src/popup/`, `src/sidepanel/`)

`Switcher.tsx` holds the state and actions (`SwitcherContext`) and renders three layouts:

- **compact** (380 px): the current tab's app (or "this site" + the app list); the workspace bar when there is a
  workspace or more than one app; the search when there are more than two apps, more than five accounts or any
  workspace;
- **wide** (720 × 600): app list on the left (the current tab's app first, tagged "This tab", mismatch warning from
  `sd:live`), the selected app's accounts or the search results on the right. Setting `popupLayout`: `auto` (wide with
  three or more apps, default), `compact`, `wide`;
- **panel** (side panel): same switcher at full height, wide from 640 px of width; it follows the active tab of its
  window (`tabs.onActivated`/`onUpdated`) and never closes itself.

Switching an account of the current tab's app happens in that tab (and closes the popup); for any other app it is a
**background** switch (`switch` with `background: true`) unless the user picks "Switch and open" (`focus: true`). The
**search** (`core/search.ts`) is accent-insensitive, every word must match, and ranks names that start with a word
first, then recent use: workspaces (name, note), accounts (app, label, email, name, note) and apps (name, domains).
"Add this site" adds an unknown site in one click (`customAppFromUrl`; the permission prompt and `app.add` start
together, and the app is removed again if access is refused); "Customize…" opens the manager's custom-site form.

The side panel opens from the popup's header, the toolbar button's right-click menu or the `open-side-panel` command
(`chrome.sidePanel.open` straight from the gesture). Setting `actionOpens: 'panel'` makes the toolbar button (and
`Alt+Shift+A`) open it: the worker sets the action popup to `''` and `openPanelOnActionClick` (`applyActionBehavior`).

## 9. Passphrase lock (vault, `core/crypto.ts`)

- The passphrase (≥ 8 characters) derives a key-encryption key with **PBKDF2-SHA-256, 310,000 iterations**, 16-byte
  salt → AES-256-GCM.
- An **RSA-OAEP 2048 / SHA-256** key pair is generated; the public key (SPKI) is stored in clear, the private key
  (PKCS#8) encrypted with the key-encryption key (`VaultMeta`).
- Each snapshot is **sealed** with a fresh AES-256-GCM content key (96-bit IV) wrapped with the public key. So saving
  (switching away, auto-sync, auto-capture) works while locked; **restoring** needs the private key.
- Unlocking decrypts the private key into `chrome.storage.session` (`sd:key`, memory only). Auto-lock is an alarm
  (default 30 minutes, renewed on each switch from the popup, manager, menu or shortcut; 0 = until Chrome closes).
- Turning the lock on seals every saved snapshot (current and previous) in one queued step; turning it off unseals
  them; changing the passphrase re-encrypts only the private key; "forgot passphrase" deletes the vault and every
  sealed snapshot (accounts stay, without sessions).

## 10. Backups (`core/backup.ts`, `admin.ts`)

A backup file is JSON: `{ format: "swapdeck-backup", version: 1, createdAt, encrypted, payload }`. The payload is
`{ apps, accounts, active, settings, sessions, workspaces }` (sessions keyed by account id, unsealed), or — when encrypted — a
`PasswordBox` (`PBKDF2-SHA-256`, 310,000 iterations, AES-256-GCM) of that JSON. Exporting with sessions requires a
password (≥ 8 characters) and, when the passphrase lock is on, an unlocked vault. Import is validated end to end; **merge** matches apps by preset or
origin and accounts by identity (or label), and replaces a saved session only with a newer one; **replace** wipes the
current data first (keeping the vault). Imported workspaces are mapped to the imported apps and accounts; in merge mode
a workspace whose name already exists (case-insensitive) is skipped. Imported sessions are re-sealed with this
computer's vault. Host access is never granted by an import: the user allows each app afterwards.

## 11. Messaging (`shared/protocol.ts`)

Pages call `send(type, payload)` → `chrome.runtime.sendMessage({ type, ...payload })` and get
`{ ok: true, data }` or `{ ok: false, error, detail? }`. Requests: `probe`, `switch` (with `background`/`focus`),
`fresh`, `cycle`, `save`, `restorePrevious`, `app.*` (incl. `app.addMany`), `account.*`, `workspace.save`,
`workspace.fromActive`, `workspace.remove`, `workspace.reorder`, `workspace.switch`, `workspace.open` (both return a
`WorkspaceOutcome`: per-app results, `switched`, `failed`, `opened`), `settings.update`, `vault.*`, `backup.*`,
`history.clear`, `data.wipe`.
Error codes: `NO_ACCESS`, `LOCKED`, `BAD_PASSPHRASE`, `NOT_FOUND`, `NO_SESSION`, `NO_TAB`, `STAGING_FAILED`, `TIMEOUT`,
`BUSY`, `INVALID` (with a detail such as `identity`, `passphrase`, `password`, `origin`, `url`, `overlap:<app>`),
`BLOCKED_DOMAIN`, `CORRUPT`, `VAULT_EXISTS`, `NO_VAULT`, `UNKNOWN`. `ui/hooks.ts` (`errorText`) turns them into
localised messages.

`probe` tells the popup about the current tab: its app (or a matching preset), whether Swapdeck has access, the
detected identity, the active and matching accounts, and a status: `match`, `mismatch`, `unsaved`, `signed-out` or
`unknown`.

## 12. Permissions

| Permission                                | Why                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `storage`, `unlimitedStorage`             | Apps, accounts, saved sessions (snapshots can be large), settings, history — on this device           |
| `cookies`                                 | Save and restore the sign-in cookies of added sites (requires host access to those sites)             |
| `scripting`                               | Read/replace the site's web storage during a save or switch, overlay and confirmation toast           |
| `activeTab`                               | The popup can offer "Add this site" for the current tab                                               |
| `contextMenus`, `alarms`, `favicon`       | Right-click switching, auto-lock, site icons in the UI                                                |
| `declarativeNetRequestWithHostAccess`     | The script-blocking CSP rule on the staging page, in one tab, during a swap                           |
| `sidePanel`                               | The switcher in Chrome's side panel (`side_panel.default_path: sidepanel/sidepanel.html`)             |
| `tabGroups`                               | "Open workspace" names and colours the tab group of the workspace's pages                             |
| Optional host access (`*://*/*` declared) | Requested **per app** when it is added, e.g. `*://*.supabase.com/*`; released when the app is removed |

`incognito: "not_allowed"`: incognito sign-ins vanish with the window. Google, YouTube, Gmail, Microsoft Online,
Live and Apple domains are refused (`BLOCKED_DOMAIN`): Chrome itself relies on their sign-in. The e2e build
(`--mode e2e`) adds `<all_urls>` host access because tests can't click permission prompts; `npm run package`
refuses to zip a build with install-time host permissions.

## 13. Known limitations

- **Signing out on the site** ends the session on its server, so the saved copy dies too (Supabase's `signOut`
  revokes all of the user's sessions by default). Use "Sign in with another account" instead.
- **Refresh-token rotation.** A saved session works while its refresh token is unused elsewhere. Swapdeck re-saves
  the live session before every switch and auto-syncs it, but restoring an older copy ("previous", an old backup)
  can be rejected by servers with refresh-token reuse detection.
- **OAuth sign-in** ("Continue with GitHub/Google") may silently reuse the provider's current account; switch the
  provider too (add GitHub) or pick another account on its page.
- Only the **main origin's** web storage is swapped; cookies cover all app domains. Apps that keep sign-in state in
  another origin's storage need that origin as their main one.
- **Partitioned cookies** (CHIPS) are not captured or cleared.
- A site whose **service worker** answers the staging path from its cache can still run scripts there (the CSP
  rule only modifies network responses).
- **IndexedDB** is opt-in per app and limited to 40 MB.
- A **workspace switch** is sequential (a few seconds per app); an app whose tab shows a "Leave site?" prompt times out
  and is reported as failed while the others go on. Apps sharing a sign-in provider (e.g. several sites signing in with
  the same GitHub account) only switch the sites themselves, not the provider.
- No incognito; sites that bind sessions to device fingerprints may reject restored sessions.

## 14. Build and tests

- Vite 8 multi-page build: `popup/popup.html`, `sidepanel/sidepanel.html`, `options/options.html`; the service worker
  is bundled separately (ES module) so it never shares chunks with React; `manifest.json` is generated from
  `src/manifest.ts`.
- Unit tests (Vitest, jsdom) in `tests/unit/` cover the pure core (`npm test`), including workspaces, search, presets
  (unique ids, valid and non-overlapping domains, no blocked domains) and the admin/state layer.
- `node scripts/verify-presets.mjs` checks every preset against the live sites: DNS, final status, redirects leaving the
  preset's domains, and that the switching page stays on the main address for a signed-out visitor.
- End-to-end tests (Playwright, Chrome for Testing) in `tests/e2e/` load `dist-e2e/`. Every `*.test` host maps to
  a local test server (`--host-resolver-rules`) that serves a fake app with a real sign-in: an HttpOnly cookie, a
  page cookie and a supabase-js style local-storage session, plus `/robots.txt` and single-page-app sign-in pages.
  Pages are ready when `html[data-ready]` is set; the popup and the side panel are opened as tabs with `?tab=<id>` (and
  optionally `&app=<id>`). `workspaces.spec.ts` uses two fake sites (`acme.test`, `globex.test`) to switch workspaces
  with one app open and one in the background, open a workspace in a tab group, search in the wide popup, use the side
  panel and add several presets at once.
