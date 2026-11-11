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
| Lane scripts   | `src/content/lane-main.ts`, `lane-relay.ts`   | Registered while separate tabs exist, on their apps' sites: in a separate tab, the page's own view of cookies and storage (§6a).                                                                                                                      |
| Page scripts   | `src/background/page-scripts.ts`              | Self-contained functions injected with `chrome.scripting.executeScript` (isolated world): read/write web storage and IndexedDB, probe the page, overlay, in-page toast, warning strip for important accounts.                                         |
| Core           | `src/core/`                                   | Pure, unit-tested logic: types, presets (164), domains, identity detection, save decisions, workspaces (status, suggestions, tab-group colours), search ranking, cookies, crypto, backup format, validation, settings.                                |
| Shared         | `src/shared/`                                 | Storage layout and readers (`store.ts`), typed messaging (`protocol.ts`), app helpers (`apps.ts`).                                                                                                                                                    |
| UI kit         | `src/ui/`, `src/styles/ui.css`                | Shared React components (dialogs, menus, toasts, avatars, app icons, account editor, icon and color pickers), hooks, i18n provider, design tokens (lacquer & paper, light/dark, accent colors), bundled fonts.                                        |
| i18n           | `src/i18n/en.ts`, `vi.ts`                     | Every UI string, English and Vietnamese. Manifest strings live in `public/_locales/{en,vi}`.                                                                                                                                                          |

### Service worker modules (`src/background/`)

| Module              | Responsibility                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router.ts`         | Answers `chrome.runtime` messages from the extension's own pages only (`fromOwnPage`: the sender's own `url`/`origin`, never its tab's address).               |
| `engine.ts`         | `switchTo` (with parking, rollback, `recoverInterruptedSwaps`), `saveLive`, `probe`, `capture`, `persist`, `restorePrevious`, per-app locks, staging tab.      |
| `swap-journal.ts`   | The journal of a running switch in session storage (`sd:swap`), read at worker start to undo a swap left halfway.                                              |
| `workspaces.ts`     | `switchWorkspace` (every app of a workspace, background where possible, progress), `openWorkspace` (then its pages in a tab group).                            |
| `watcher.ts`        | Reacts to app page loads: detects who is signed in, auto-sync, auto-capture, mismatch flag, confirmation toasts, account strip, last page & recents.           |
| `state.ts`          | Single write queue (`exclusive`, `update`), history, snapshot packing/sealing, vault key in session storage.                                                   |
| `admin.ts`          | Apps (incl. `addApps` in one step)/accounts/workspaces CRUD and cascades, settings, vault, backups (export/inspect/import), wipe.                              |
| `guard.ts`          | The declarativeNetRequest session rule that blocks page scripts and frames in the tabs of a swap; clears rules left by a stopped worker.                       |
| `cookie-jar.ts`     | Read/clear/write cookies of an app's domains through `chrome.cookies`.                                                                                         |
| `tabs.ts`           | Tab queries for an app, `navigateAndWait`, `waitForComplete`, `runInTab`.                                                                                      |
| `badge.ts`          | Per-tab toolbar badge (active account's initials and colour) and tooltip.                                                                                      |
| `menus.ts`          | Right-click menu per app (`documentUrlPatterns`) and on the toolbar button (workspaces, side panel); rebuilt only when it changes.                             |
| `omnibox.ts`        | `swd` keyword: ranked workspace and account suggestions, switch on Enter.                                                                                      |
| `guarded.ts`        | Switches started without a page of ours (shortcuts, omnibox, menus): unsaved-work and important-account checks, the question on the page or in a small window. |
| `sync.ts`           | Optional Chrome Sync of the list (`syncNow`, `clearSyncData`): pull, apply, push through `chrome.storage.sync` (§10).                                          |
| `sync-journal.ts`   | What the user removed on purpose (`noteRemoved`, `readRemoved`), so only that is removed on other computers.                                                   |
| `links.ts`          | "Links of another account": `routeLink` (ask on the page, switch, or leave it), `openLinkAs` (right-click on a link), `ownerOfPage` (§6).                      |
| `lane-state.ts`     | The record of separate tabs (lanes) in memory and `sd:lanes`; `releaseAccountLane` for the engine (§6a).                                                       |
| `lanes.ts`          | Separate tabs: open/end lanes, their rules, jar, Set-Cookie and page relay, saving into the account, restore (§6a).                                            |
| `import-session.ts` | "Import a sign-in": an exported sign-in (core/session-import.ts) saved as an account (§10).                                                                    |
| `lane-ui.ts`        | What the popup and manager ask about separate tabs before acting: `findLaneUnsaved` (unsaved work in a lane's tabs).                                           |

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

| Key                 | Contents                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sd:apps`           | `AppDef[]`                                                                                                           |
| `sd:accounts`       | `Account[]` (metadata only, no session data)                                                                         |
| `sd:active`         | `{ [appId]: accountId \| null }` — which saved account the browser is signed in as, per app                          |
| `sd:settings`       | `Settings` (language, theme, after-switch page, auto-capture, auto-sync, toasts, accent, lock reminder snooze, …)    |
| `sd:history`        | Last 200 `HistoryEntry` items (switch, fresh, save, auto-save; ok or error code)                                     |
| `sd:vault`          | `VaultMeta` when the passphrase lock is on                                                                           |
| `sd:workspaces`     | `Workspace[]`                                                                                                        |
| `sd:meta`           | `{ schema: 1 }`                                                                                                      |
| `sd:snap:<account>` | `StoredSnapshot`: `{ v: 1, plain: Snapshot }` or, with the vault on, `{ v: 1, sealed: … }`                           |
| `sd:prev:<account>` | The snapshot the current one replaced (safety net, "Restore the session saved before")                               |
| `sd:syncMemo`       | Per sync key: the last write made or applied here (`t`, `by`), the value then (`base`) and its hash, the local thing |
| `sd:install`        | This installation's random id, written into each sync item it sends                                                  |
| `sd:syncRemoved`    | Sync keys of things the user removed → when (180 days, ≤ 3,000), noted even while sync is off                        |
| `sd:syncGoneSeen`   | Tombstone sync key → when this computer first saw it (its own clock): tombstones expire 45 days after that           |
| `sd:laneRestore`    | Separate tabs to bring back after a restart: lane token, kind, app, account, tab group title                         |
| `sd:laneLeftovers`  | Per app: tokens of ended lanes whose names may still be on the site (removed the next time a page there is scripted) |

`chrome.storage.session` (memory only, cleared when Chrome closes; extension pages and the worker only):

| Key                | Contents                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `sd:key`           | The unlocked vault private key (PKCS#8, base64) while the vault is unlocked                   |
| `sd:live`          | Per app: last detected identity, whether it mismatches the active account, URL                |
| `sd:progress`      | While a workspace switch runs: `{ workspaceId, total, done, current }` (shown in the popup)   |
| `sd:ask`           | A switch waiting for the user's answer in the confirmation window                             |
| `sd:sync`          | How the last sync of the list went (`SyncStatus`, shown in Settings)                          |
| `sd:linksDeclined` | Links the user said "not now" to (app, account and what matched; ≤ 200)                       |
| `sd:swap`          | Per app, while a switch runs: its journal (tabs moved, where the live session was saved)      |
| `sd:lanes`         | Separate tabs: lanes (token, app, account, tabs, cookie jar, rule ids, groups) and tab → lane |

Everything read from storage, backups or pages is untrusted and goes through `src/core/validate.ts`
(`sanitizeApp`, `sanitizeAccount`, `sanitizeSnapshot`, …) or `parseSettings`. Ids pass `isId` (letters, digits, `_`,
`-`, ≤ 64, never `__proto__`/`constructor`/`prototype`), and records keyed by ids or by a site's own names (active
accounts, workspace members, backup sessions, web storage, sync memo) are built without a prototype (`record()` in
`core/util.ts`).

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
2. **Pick the work tab:** a blank tab the caller opened for this switch (`adoptTab`, "Open link as"), else the
   requested tab, else the focused tab if it shows the app, else any active tab of the app, else any of its tabs.
   With none open: a **hidden** tab when `background` is set (the caller's `hiddenTabId` if given, e.g. the one a
   workspace switch shares between apps; else a new inactive `about:blank`), otherwise a new foreground tab.
3. **Park the other tabs** of the app: inactive ones are discarded (they reload with the new session when
   activated); active ones (in other windows) and undiscardable ones are **parked** on `about:blank` while the swap
   runs — their scripts, timers, open databases and requests stop, so nothing writes the old session back or holds
   IndexedDB open — and sent back to their pages at the end (`park`/`unpark`). The unsaved-work question
   (`findUnsaved`) covers them beforehand. Apps that swap **sessionStorage** (one per tab) park every other tab on the
   switching page instead (discarded ones too) and, after the swap, write the target's sessionStorage into each of
   them; only tabs written so (or where the session was saved) are trusted for auto-sync (`sessionTabs`).
4. **Block page scripts** in the work tab (and the tabs parked on the switching page): a declarativeNetRequest session
   rule (`guard.ts`) sets a `Content-Security-Policy` that allows no scripts, plug-ins, workers or frames (`SWAP_CSP`:
   `script-src`, `object-src`, `worker-src`, `frame-src` and `child-src` all `'none'`) on main-frame and sub-frame
   responses of the app's domains, for those tabs only, until the swap ends. A **journal** of the switch (`sd:swap` in session storage, `swap-journal.ts`: work
   tab, parked tabs and their pages, where the live session was saved, whether the swap began) is kept until it ends.
5. **Staging page.** The work tab navigates to `origin + stagingPath` (default `/robots.txt`; DigitalOcean uses
   `/manifest.json`). The app's own scripts unload, so nothing can write the old session back mid-swap; even if the
   site answers that path with its app shell, the CSP keeps its scripts from running. The page's origin is verified
   (`STAGING_FAILED` on redirects elsewhere) and a "Switching to …" overlay is drawn.
   If the page redirects to another origin (some sites send signed-out visitors to a separate sign-in host), the
   switch tries `/favicon.ico`, `/robots.txt` and `/` on the main origin before failing with `STAGING_FAILED`
   (`stagingCandidates`/`openStaging` in `engine.ts`); the watcher ignores those fallback loads while the app is busy.
6. **Capture the live session** (`capture`): localStorage (always read, for detection), sessionStorage and
   IndexedDB when the app swaps them (IndexedDB over 40 MB fails the switch), and the cookies of every app domain;
   then detect the identity. Page scripts get `expectedOrigin` and read or write nothing on another origin, and every
   page script has a timeout (10 s; 60 s for a capture with IndexedDB; 5 s for detection), so a stuck page can't hold
   the app lock.
7. **Save it where it belongs** (`decideSave`, section 5) and `persist` it: into the active account, into the saved
   account it really belongs to, or into a new account — or skip it when it is empty or signed out. **Re-opening the
   account in use** (`restore`) without proof that the live session is that person (a strong identity matching it)
   never saves the live session into it: someone recognised becomes a new account, anything else is set aside as the
   account's "previous" copy (`storeAsPrevious`), and the saved session is put back.
8. **Swap** (`applySnapshot`): clear the app domains' cookies, set the target's cookies (expired ones skipped,
   host-only and `__Host-`/`__Secure-` rules respected), then replace localStorage/sessionStorage/IndexedDB on the
   staging page. A database that can't be removed or rewritten (held open elsewhere: `idbFailed`) fails the swap with
   `STORAGE_BLOCKED` rather than leave the previous account's data under the new cookies. Only when the live session
   provably _is_ the target (re-opening the active account, same person recognised) is nothing swapped: it is newer
   than the saved copy.
9. **On any error** after the swap began, the captured live session is put back (`rollBack`): in the work tab, else —
   closed, or moved to another site — in a fresh switching tab under its own rule; if neither works the site is
   **signed out** (cookies and storage cleared, no account in use, history error `ROLLBACK_FAILED`), never left half
   one account and half the other. Then the rule is removed, the work tab returns to its page (or a tab opened for the
   switch is closed), parked tabs go back, and a failed history entry is recorded.
10. **Finish:** remove the rule, record `active`, `lastUsedAt`, `switchCount` and history (tagged `via` the workspace
    name when part of a workspace switch), register a pending toast for the work tab, open the destination, send
    parked tabs back and drop the journal. Destination: an explicit URL, else the account's fixed start page, else per setting the account's last
    page (`last`, default), the same page (`same`) or the app's home page; "sign in with another account" opens
    `loginUrl` (or home). **Background switch of an app with no open tab:** no destination and no toast — the hidden
    tab is closed (or left to its owner when borrowed).

"Sign in with another account" is the same flow with no target (`kind: 'fresh'`): the live session is saved, the
app's cookies and storage are cleared, and the sign-in page opens.

**Interrupted swaps.** If the worker stops in the middle of a switch, the journal is still in session storage when it
starts again: `clearStaleRules` removes rules left behind (not those of a switch the new worker runs), then
`recoverInterruptedSwaps` puts back the session saved just before the swap (history `INTERRUPTED`) — or signs the site
out when it can't (`ROLLBACK_FAILED`) — unless the end of the swap was already recorded, and sends the moved tabs back.
Session storage survives the worker stopping, not Chrome closing or the extension being reloaded.

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

| Live session                                   | Decision                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| No cookies, no storage                         | skip (`empty`)                                                  |
| Strong identity = active account               | save into the active account                                    |
| Strong identity = another saved account        | save into that account (the user signed in by hand)             |
| Strong identity, nobody saved, active has none | save into the active account (it learns who it is)              |
| Strong identity, nobody saved                  | save as a new account                                           |
| No strong identity, specific detector          | skip (`signed-out`) — never overwrite with a signed-out session |
| No strong identity, `auto`/`none` detector     | save into the active account, else a new account                |

## 6. Watching pages (`watcher.ts`)

On `tabs.onUpdated` for tabs of an added app (with access, not incognito, not the staging page):

- **On load complete** (`reconcile`, under the app lock): detect the identity (`detectLive`: cookies, plus local
  storage when the tab is on the main origin). `readable` is false when detection needs local storage and it couldn't
  be read (another address of the site, Chrome's error page while offline): then finding nobody means "can't tell" —
  never "signed out" (`probe`) nor expired.
  - Strong identity of the active account → **auto-sync**: re-capture and save it, at most once a minute per app and
    only on the main origin. This keeps saved sessions fresh as sites rotate refresh tokens. Who is signed in is
    decided again on the captured session (`decideSave`), not on the earlier look; an account learning who it is
    keeps its previous copy. Apps that swap sessionStorage only refresh from tabs in `sessionTabs`.
  - Strong identity of someone else, with auto-capture on and the tab on the main origin → **auto-capture**: save it
    (decided on the captured session too) into the matching saved account or a new one, make it active, record
    `auto-save`, toast "Saved new account …" / "Now using …".
  - Otherwise mark a **mismatch** in `sd:live` (badge shows `!`, popup explains).
  - A pending switch toast for this tab (≤ 60 s old) is shown: success, "still signed in as …" (wrong account — also a
    failed history entry `WRONG_ACCOUNT`) or "session expired" (signed out with a specific detector, page readable),
    or the "signed out — sign in with another account" note after a fresh sign-in.
- **Unsaved work** (`guarded.ts`, `settings.guardUnsaved`): before a switch that reloads an app's tabs, `findUnsaved`
  runs `unsavedWork` in each open tab of the app, in the page's **own (MAIN) world** so it can see the page's
  `beforeunload` handlers (a synthetic, cancelable `beforeunload`; an old-style `onbeforeunload` returning text), edited
  form fields (not search boxes) and a focused editor holding text. It returns yes/no only, 800 ms at most per tab.
  The popup, side panel and manager merge it into one confirmation (`askText` in `core/ask.ts`, `useAskBeforeSwitch`).
  "Close separate tab" (popup, an account's menu, the manager's list) asks the same about the lane's own tabs, which
  closing closes (`lane.unsaved` → `findLaneUnsaved` in `lane-ui.ts`; `laneCloseText`, `useAskBeforeLaneClose`), in
  one question with a scratch sign-in nobody saved.
- **Shortcut, address-bar and menu switches** go through `runGuarded`: the same checks (important accounts, unsaved
  work — also when re-opening the account in use, which reloads the tabs too — and "ask before switching"), then
  `askOnPage` (a closed shadow-root dialog; only trusted clicks confirm; Escape or 25 s answers no) on the current tab,
  or — when that tab can't be scripted — a small window (`popup.html?ask=<id>`) reading the pending plan from `sd:ask`
  (session storage) and answering with `ask.answer`. The `cycle` request is the guarded "next account". A cancelled
  (or failed) menu switch rebuilds the menus (`refreshMenus`): Chrome has already moved the radio check.
- **Important accounts** (`Account.important`): after each reconcile of an app that has any, `markAccount` injects
  `showRibbon` — a red strip and tag along the top of the page (closed shadow root, no pointer events) — when the
  account really signed in there (the recognised identity, else the active account unless the page shows nobody) is
  important, and removes it otherwise. With `settings.pageRibbon: 'all'` ("Show the account on its pages: every
  account") other accounts get a quiet strip in their color naming the workspace in use that holds them, else the
  app, and the account ("Client X · Work"). The switch toast turns to a warning; the popup, side panel, manager and
  workspace switches confirm first (`importantTargets` in `core/workspaces.ts` lists them for a workspace).
- **Single-page apps** sign in without reloading (the Supabase dashboard does), so a tab is checked again 0.9 s after
  an address change on a loaded page, and once 2.5 s after a load that found nobody signed in (sessions written just
  after load, e.g. OAuth redirects). Choosing the account already in use records a `restore`.
- **On load and SPA navigation/title changes** (`trackPage`): remember the active account's `lastUrl` and recent
  items (`recentPattern`, e.g. Supabase project refs `^/dashboard/project/([a-z0-9]{20})` with the project name from
  the title; `core/recents.ts`), skipping sign-in/out paths, the staging page and mismatched tabs. A page that belongs
  to another saved account (below) is not remembered for the active one: it goes to `routeLink` instead.
- **Expired sessions** (`Account.expiredAt`): when a reconcile on the main origin finds nobody at all signed in while
  an account with a saved session is in use, and `signedOutIsReliable` (a specific detector, or the automatic one when
  the account has an identity — it reads the same cookies and local storage each time), twice at least 2 s apart
  (`signedOutSince`, a follow-up check is scheduled), the account is marked expired and a warning toast shows. A strong
  identity of that account clears it and saves the new session at once (`persist` also clears it on any signed-in
  save). It is informational only: save decisions (`decideSave`) are unchanged. Expired accounts get a label, "Sign in
  again" (a fresh sign-in) and a row under **Sign in again** (`ReloginCard`).

### Links of another account (`core/links.ts`, `background/links.ts`)

`linkOwner` says which account a page belongs to, when it isn't the one in use: by the accounts' `linkRules` (host,
optionally with a path, normalised like Swapdeck Desktop's `LinkRouter`; the most specific wins, ties mean "can't
tell"), else by the only account whose recent items (`recentKey`) or pinned pages cover it (never a home or sign-in
page). `routeLink` (called by `trackPage`, only for owners with a saved session, never while the app is busy, not again
in a tab for 20 s after a switch for a link, and not for 20 s in a tab a switch just moved or reloaded while it still
shows the page — same owner — the switch sent it to: `switchedTabs`/`justSwitched`, so a switch isn't undone by the
previous account's page reloading) follows `settings.linkRouting`: `ask` shows `askLinkOnPage` (a
closed shadow-root card in the corner that doesn't block the page; only trusted clicks switch; 30 s without an answer
leaves it for that tab), `auto` switches at once, `off` does nothing. A switch goes through `runGuarded` with the page
as `url` (`switchTo` follows a requested page only when it belongs to the app). "Not now" is remembered for the Chrome
session (`sd:linksDeclined`) and, for a recent item, records it for the account in use too (shared, no more asking).
The right-click menu on links to an added app (`targetUrlPatterns`) offers "Open link as" each account with a session
(`openLinkAs`): a **blank** tab next to the page, the guarded switch (asked on the page the link was on) in that tab,
and only then the link — it is never requested with the account in use (invites and sign-in links work once). A
cancelled switch closes the blank tab.

### Getting started and updates

`core/onboarding.ts` ticks the overview's checklist off from the data (an app, two sessions of one app, a workspace,
the vault, a backup; sync optional) until `settings.onboardingHidden`. Help → **Check for updates**
(`core/version.ts`) fetches `api.github.com/repos/Tanx-1811/swapdeck/releases/latest` only when pressed (no
credentials, no referrer), parses the zip names and links only to this repository's release pages; installs with an
`update_url` (Chrome Web Store) say Chrome updates them.

## 6a. Separate tabs (`core/lanes.ts`, `background/lanes.ts`, `content/lane-*.ts`)

A **lane** is an account used in some tabs while the browser's other tabs keep the account in use (VI "tab riêng"); a
**scratch** lane is a fresh sign-in nobody saved yet ("tab nháp"), forgotten when its tabs close unless saved. Lanes live
in the worker (`lane-state.ts`: in memory, written through to `sd:lanes` in session storage) and cover only their app's
`domains`; every other site in their tabs, and every other tab, uses the browser's own sign-in.

- **Cookies never reach Chrome's store.** Each lane has a jar (`CookieRecord[]`, seeded from the account's snapshot).
  `laneRules` turns it into declarativeNetRequest session rules limited to the lane's `tabIds` (ids from
  `LANE_RULE_BASE` = 100 000 up; `clearStaleRules` never touches them): per scope (each app domain with its subdomains,
  each cookie's host or domain), cookie path and — when Secure cookies need it — scheme (WebSocket handshakes
  included: ws like http, wss like https), a rule **sets** the `Cookie` header (or removes it, so the browser's own
  cookies never go along); one rule drops `Set-Cookie` from every response of the lane's sites; two keep private
  responses out of Chrome's HTTP cache both ways. Response headers a rule sets come too late for that cache, so pages
  and frames get `If-Range` (`LANE_CACHE_GUARD`: the cache neither reads nor stores such a request; servers ignore it
  without `Range`) and `no-cache`; calls (XHR, fetch), where CORS applies, only lose their conditional headers — a
  rule never adds a header that isn't CORS-safelisted there (a cross-origin call would need a preflight) — and the
  page script keeps them out of the cache (fetch: `cache: 'no-store'`; same-origin XHR: the If-Range guard). More
  specific rules have higher priority (Chrome applies the highest rule that sets a header). The worker reads `Set-Cookie` through `webRequest.onHeadersReceived` with
  `extraHeaders` (it sees the headers before the rule drops them), parses them (`parseCookie`, RFC 6265: domain,
  path, Secure on secure origins only, prefixes, Max-Age over Expires) into the jar (`storeCookie`) and re-applies the
  rules (`syncRules`: one at a time, coalesced). Listeners are added only while lanes exist, filtered to their apps'
  sites; a 20 s heartbeat keeps the worker alive meanwhile and purges expired cookies.
- **Only the lane's own requests feed its jar.** A tab's rules count from when Chrome has applied them
  (`coveredAt`); a request the tab sent before (a tab that just joined, from `openerTabId`) carried the browser's
  cookies, so `onSendHeaders` marks it (`uncovered`, per redirect hop) and its response's `Set-Cookie` is ignored. Rule
  updates go through one queue (`syncRules`/`runRules`): a lane that ended meanwhile gets its rules removed, never
  re-added (`retired`); ids waiting for removal are never reused; a failure only fails that lane's callers; rules of the
  lane range that no lane owns are removed when the worker starts.
- **Pages that went out with stale cookies load again.** `onSendHeaders` (main frames, GET only) compares the `Cookie`
  header actually sent (after the rules) with the jar: a redirect that set cookies, or a tab that joined the lane
  mid-load, is re-navigated once its rules are in step (`reloadOnce`: at most every 5 s per tab).
- **The page's own view** (`content/lane-main.ts`, MAIN world, `document_start`, all frames, registered with
  `scripting.registerContentScripts` only while lanes exist): the lane's document rules also set a `Server-Timing`
  entry `swapdeck-lane;desc="<token>|<document.cookie value>"` on top-level pages (frames get the token only: their
  timing can be visible to the page around them), which the script reads synchronously from the navigation entry
  (about:blank frames take their parent's). The relay asks the worker what `document.cookie` reads (`sync`) when the page
  starts and whenever the site sets cookies in the lane (`changed`, sent to the lane's tabs), and every answer to a write
  or flush carries it too, so cookies set by responses (CSRF tokens) show up. In a lane it redefines `document.cookie` (reads the lane's non-HttpOnly
  cookies; writes go to the worker through `lane-relay.ts` → `runtime.sendMessage`, parsed as a script would, never
  over an HttpOnly cookie), removes `cookieStore` (`'cookieStore' in window` is false), makes `fetch`/XHR wait for
  pending cookie writes and, after non-GET
  requests, for the response's `Set-Cookie` ("flush"), and keeps `localStorage`, IndexedDB names, BroadcastChannel names
  and Web Locks under `__sdl:<token>:` (storage events translated). Service workers can't be registered there; a page
  a service worker controls is reported (`workerWarning`). In other tabs, when lane keys exist, it only hides them
  (and keeps them out of the page's `clear()`). Its `localStorage` views are Proxies: `Storage.prototype`'s methods
  and `length` are wrapped to act on a view when called with one as `this` (and are the browser's own otherwise), and
  the views use the natives captured at `document_start`. Its own timers, promises and events use the originals
  captured then too, so page instrumentation (New Relic, Sentry) never sees them. The relay also says hello with the token it saw: a lane page without it
  (served from cache, or before the tab joined) is reloaded bypassing the cache. The worker checks every relay message
  against the sender tab's lane and the app's domains (`onRelay`).
- **Page scripts and normal switches leave lanes alone.** `readPageStorage`/`writePageStorage` take `lane` (only that
  lane's names, prefix stripped) and otherwise skip every `__sdl:` key and database; `dropLaneData` removes a lane's.
  `queryAppTabs` leaves lane tabs out, so switches never park, reload, save from or swap in them; the watcher and links
  ignore them (`lanes.ts` watches them: identity from the jar and the lane's storage, `status` ok / other-person /
  signed-out, last page and recents of the account, toast once per tab, the ribbon for important accounts, the badge).
- **Opening** (`openLane`): the account in use by the browser's own tabs is refused (`INVALID: in-use`); an account
  that already has a lane gets another tab in it. Otherwise the snapshot is loaded (`LOCKED`/`NO_SESSION` as for a
  switch), a blank tab joins the new lane, the lane's storage is written on the switching page (scripts blocked, as in a
  switch) under the lane's names, leftovers of ended lanes are dropped, and the tab opens the account's start or last
  page. Its tabs form a tab group named "label · app" in the account's colour. Tabs a lane page opens (`openerTabId`,
  http(s) or about:blank) join its lane.
- **Saving.** An account lane's session (its jar and its storage, read from a lane tab on the origin, else a hidden
  staging tab) is saved into its account like auto-sync: only a strong identity of that account (`decideSave` with the
  lane's account as "active"; sites with detector `none` as they are), 4 s after its cookies change, at most every
  30 s, with auto-sync on — and always when the lane ends. Someone else signed in there is never saved into it
  (`status: other-person`); "Save as account" (`saveLane`) files any lane's sign-in by identity (or a chosen account,
  refused for another person) and turns a scratch lane into that account's lane when it isn't in use elsewhere.
- **Ending** (last tab closed, "Close separate tab", account or app removed, wipe): save (account lanes); then its
  pages leave **before** its rules go — closed, or (kept tabs) their sessionStorage cleared and moved to `about:blank`
  — so no lane page ever runs with the browser's cookies; then the rules go (through the queue), restore info is
  recorded and the lane's names are removed from the site (from any page of the origin, else a hidden staging tab,
  else noted in `sd:laneLeftovers`). Kept tabs go back to their pages with the browser's sign-in. **A switch of the
  browser's tabs to an account that has a lane** (`switchTo`, after the target snapshot loaded) ends that lane with a
  save (`releaseAccountLane`), loads the snapshot again (the lane's is newer) and adds the lane's tabs to its parked
  tabs: they come back once the account is in place (or the rollback is).
- **Restarts.** Session rules, `sd:lanes` and registered scripts go when Chrome restarts or the extension updates; tab
  groups come back. `restoreLanes` (on start-up and on update) re-opens account lanes in the tabs of their groups (by
  title, `sd:laneRestore`): the tabs first leave the site (their pages run the browser's account), then join the lane,
  its storage is written from the saved session, and they go back to their pages. A lane that can't come back (scratch,
  locked vault, account in use, site unreachable, a title two lanes shared) has its tabs ungrouped and back on their
  pages, so no group claims an account its tabs don't have. A worker that starts while Chrome runs re-applies every
  lane's rules (it doesn't know since when their tabs were covered, `coveredAt`). `openLane` holds the app's lock (no switch changes the account in use meanwhile).

## 7. Workspaces (`core/workspaces.ts`, `background/workspaces.ts`)

A workspace is the unit for people who work for several parties ("các bên"): which saved account each app uses for a
client, company or project.

- **Status** (`workspaceStatus`): `liveMembers` keeps only members whose app and account still exist; a workspace is
  `active` when every member's account is in use (`sd:active`), `partial`, `inactive` or `empty`. A switch still
  switches members whose app shows someone else signed in (`pendingMembers`, `sd:live` mismatch). Deleting an account
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
  three or more apps, default), `compact`, `wide`. When Chrome can't give the popup 720 px (page zoom past ~110 %,
  popups are capped at 800 screen pixels), it falls back to compact (`usePopupTooNarrow`);
- **panel** (side panel): same switcher at full height, wide from 640 px of width; it follows the active tab of its
  window (`tabs.onActivated`/`onUpdated`) and never closes itself.

The lid shows the workspace fully in use as a pill that opens `WorkspacePicker` (search, arrows, Enter); with more than
six workspaces (`WS_BAR_MAX`) the bar keeps the three in use or used last and an "All N" chip that opens the same picker.

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
  Unlocking (and changing the passphrase) first checks that the private key opens what the public key seals
  (`keysMatch`); a vault whose halves don't belong together is refused with `CORRUPT`.
- Turning the lock on seals every saved snapshot (current and previous) in one queued step — the "is there a vault
  already?" check is repeated inside that step, so two requests at once never make two vaults; turning it off
  unseals them; changing the passphrase makes a **new key pair** and seals every snapshot (current and previous)
  again with it in one queued step (a copy of the old vault plus the old passphrase opens nothing saved afterwards;
  a snapshot the old key can't open is dropped and its account marked as having nothing saved); "forgot passphrase"
  deletes the vault and every sealed snapshot (accounts stay, without sessions).

## 10. Backups, moving and sync of the list (`core/backup.ts`, `core/sync.ts`, `admin.ts`, `sync.ts`)

A backup file is JSON: `{ format: "swapdeck-backup", version: 1, createdAt, encrypted, payload }`. The payload is
`{ apps, accounts, active, settings, sessions, workspaces }` (sessions keyed by account id, unsealed), or — when encrypted — a
`PasswordBox` (`PBKDF2-SHA-256`, 310,000 iterations, AES-256-GCM) of that JSON. Exporting with sessions requires a
password (≥ 8 characters) and, when the passphrase lock is on, an unlocked vault. Import is validated end to end; **merge** matches apps by preset or
origin and accounts by identity (or label), and replaces a saved session only with a newer one; **replace** wipes the
current data first (keeping the vault). Imported workspaces are mapped to the imported apps and accounts; in merge mode
a workspace whose name already exists (case-insensitive) is skipped. Imported sessions are re-sealed with this
computer's vault. Which account was in use (`active`) is exported but never imported: it describes the browser the
backup came from (taken over, the first switch would save whatever is signed in here into that account, and a
workspace switch would skip it as already in use). Host access is never granted by an import: the user allows each app afterwards. A replace keeps what
belongs to this computer (`lastBackupAt`, reminder snoozes) and turns sync of the list off (turned on again, it would
bring back what the replace removed); the response says so (`syncOff`).

**Reminders and moving.** `backupNudgeDue` (`core/settings.ts`) shows the backup reminder (`BackupNudge`, through
`Reminders` after the lock reminder) a few days after the first saved session and a month after the last backup;
"Back up now" exports the list without sessions (no password) and `exportBackup` records `lastBackupAt`; "Later"
sets `backupNudgeUntil`. The Backup page explains moving to another computer, and `ReloginCard` (Backup and Overview)
lists accounts without a saved session here with a "Sign in" (a fresh sign-in; the identity check files the new
session under the matching account).

**Sending an account** (`backup.export` with `only: { accountId | workspaceId }`): the same file, with only that
account (or the workspace, its member accounts and their apps), their sessions, default settings and no `active`;
always encrypted, marked `shared: true`, and it doesn't count as a backup (`lastBackupAt` unchanged). A shared file can
only be merged: `importBackup` refuses `replace` (`INVALID: shared`) and the Backup page hides it.

**Importing a sign-in** (`session.import`, `background/import-session.ts`): `parseSessionExport` reads Cookie-Editor /
EditThisCookie JSON, Playwright storage state (cookies and the main origin's localStorage), Netscape `cookies.txt`
(`#HttpOnly_` lines too) or a `Cookie:` header; keeps only unexpired cookies of the app's domains; and the snapshot is
filed by identity like "Save this session" (an explicit account is refused for another person; a specific detector
that finds nobody refuses with `NO_SESSION`). The browser isn't touched and no account becomes active.

### Sync of the list

Off unless `settings.syncList`. Never synced: snapshots, cookies, tokens, the vault, history, recents, last pages,
stats, settings. One `chrome.storage.sync` item per thing — `sd1:a:<appId>`, `sd1:c:<accountId>`, `sd1:w:<workspaceId>`
— holding `{ v, t, by, f }` (value, time, installation id, and the fields the writer's version sends: `SYNC_FIELDS`);
a preset app nobody changed travels as
`{ presetId, name, color, order, createdAt, preset: true }` and is rebuilt from the local preset (keeps items small:
`chrome.storage.sync` allows 100 KB and 512 items, 8 KB each — larger things stay local and are counted in the status).

- `syncNow` (debounced: 1 s after a sync change, 4 s after a local change, at startup, on turning it on, "Sync now")
  pulls, then pushes; one sync at a time.
- **Pull** (`planPull`, `applyPull` inside one `update()`): applies every write it hasn't seen (by `t` + `by`, so
  clocks don't matter), apps first. Something arriving for a thing that is already here under another id — the same
  preset, origin or domain; the same signed-in user (`sameIdentity`); the same name or label once — is applied to it
  (an alias stored in the memo) instead of copied — but two things written by the same computer never fold into one
  here (`takenBy`): there they are two, and removing either would remove both here. Ids are translated (an account's app, a workspace's members); an
  account whose app hasn't arrived waits. A workspace member whose app or account isn't here (too big to sync, a
  preset this version lacks, not arrived yet) is kept as it came in `Workspace.foreignMembers` (never shown or
  switched): it travels back with every write of the workspace, so a computer never sends fewer members than it
  received, and becomes a real member once its account arrives (the workspace is also applied again, `again`);
  members whose app or account was removed here on purpose are dropped. An account keeps its local fields (session
  stats, recents, last page) and, when it has a session here, its identity; it is never moved to another app; app
  rules (blocked domains, overlap) are enforced.
- **Merging edits:** each memo entry keeps the value as last synced (`base`, as it travels from here). A write that
  arrives for something changed here since is merged field by field (`mergeFields`): a field changed here and not in
  the incoming write keeps its value here, anything else takes the incoming one (both changed: the incoming wins);
  the merged thing is then sent. So an offline edit (a note, a pin, a workspace's links) survives another computer's
  unrelated change of the same thing, a reorder included. Memo entries from before 1.7 have no `base`: the next push
  fills it in for everything unchanged since it was synced (until then, the incoming write wins as before).
- **Older versions:** each item carries its writer's sync schema `s` (`SYNC_SCHEMA`, a number — a field list would cost
  ~50 % more of Chrome Sync's 100 KB). A field the writer's schema doesn't know (`writerFields`, `SCHEMA_FIELDS`) keeps
  its value here (`withLocalUnknown`), so a computer still on an older version can't erase a newer field (`linkRules`)
  by writing the whole item; a newer schema knows at least every field this version does. Items without `s` were
  written by 1.5/1.6: they count as knowing `LEGACY_SYNC_FIELDS` plus the fields they carry. Never change
  `LEGACY_SYNC_FIELDS` or an entry of `SCHEMA_FIELDS`; a new synced field goes into the current list, bumps
  `SYNC_SCHEMA` with a new `SCHEMA_FIELDS` entry, and gets a merge rule and a two-computer test.
- **Removals:** removing an app/account/workspace notes it in `sd:syncRemoved` (`noteRemoved`, inside the removal's
  `update()`); the push writes a tombstone `{ gone, t, by }` for every key that maps to it, even over a concurrent
  edit. A tombstone removes the thing on the other computers (through `removeApp`/`removeAccount`/`removeWorkspace`,
  sessions included) — unless another live key still maps to the same thing there (`stillStandsFor`, settled with
  `settleDeletes` against the memo **including the writes the same pull applied**): then only that key is forgotten.
  Nothing new is ever matched to a thing a tombstone of the same pull removes (`applyPull`'s `removing`): something
  removed and set up again on another computer while this one slept stays two things here, the old one removed and
  the new one added (an app on the same site waits for a second round of the pull, `deferred`, since two apps can't
  share a site). A tombstone is never "already seen" (memo entries describe live writes only). A tombstone is dropped
  from Chrome Sync 45 days after the computer dropping it first saw it (`sd:syncGoneSeen`, its own clock: the writer's
  `t` doesn't count, so a clock far ahead or behind can't cut a tombstone's life short). Anything that disappears
  **without** a tombstone is forgotten, never removed: a key gone from Chrome Sync (cleared, an old tombstone dropped)
  is just dropped from the memo, and a thing missing here that wasn't removed on purpose (lost data) is taken back
  from Chrome Sync by a second pull. The removal journal still counts after the tombstone is gone: a write for
  something removed here on purpose (within 180 days) is refused, and the push sends its tombstone again — a computer
  that was offline longer than 45 days can bring a removed thing back to the others for a while, never to the
  computer it was removed on, which removes it everywhere again.
- **Push** (`planPush`): writes what changed since the memo (hash), skips keys another computer changed that the pull
  hasn't taken yet, writes tombstones, drops old ones. Status goes to `sd:sync`; a quota error is reported, not retried
  in a loop.
- "Remove from Chrome Sync" (`sync.clear`) turns sync off here, removes every `sd1:` item, the memo and the tombstone
  sightings. Wiping data or
  a replace import clears the memo, the journal and the installation id.

## 11. Messaging (`shared/protocol.ts`)

Pages call `send(type, payload)` → `chrome.runtime.sendMessage({ type, ...payload })` and get
`{ ok: true, data }` or `{ ok: false, error, detail? }`. Only the extension's own pages send requests (popup, side
panel, manager, the confirmation window); the router answers a sender only when its own `url` is under
`chrome.runtime.getURL('')` (and its `origin`, when given, is the extension's) — scripts run in web pages answer
through `executeScript`'s return value, never by message. Requests: `probe`, `switch` (with `background`/`focus`),
`fresh`, `cycle`, `save`, `restorePrevious`, `app.*` (incl. `app.addMany`), `account.*`, `workspace.save`,
`workspace.fromActive`, `workspace.remove`, `workspace.reorder`, `workspace.switch`, `workspace.open` (both return a
`WorkspaceOutcome`: per-app results, `switched`, `failed`, `opened`), `settings.update`, `vault.*`, `backup.*`,
`history.clear`, `data.wipe`, `unsaved`, `ask.answer`, `switch.guarded`, `sync.now`, `sync.clear`, `lane.open`,
`lane.close`, `lane.focus`, `lane.save`, `lane.unsaved`, `session.import`. Lane page relays send `{ swapdeckLane: true, kind }`
messages, answered by `lanes.ts` only for content scripts in lane tabs (§6a); the router never answers them.
Error codes: `NO_ACCESS`, `LOCKED`, `BAD_PASSPHRASE`, `NOT_FOUND`, `NO_SESSION`, `NO_TAB`, `STAGING_FAILED`, `TIMEOUT`,
`BUSY`, `INVALID` (with a detail such as `identity`, `passphrase`, `password`, `origin`, `url`, `overlap:<app>`),
`BLOCKED_DOMAIN`, `CORRUPT`, `VAULT_EXISTS`, `NO_VAULT`, `UNKNOWN`. `ui/hooks.ts` (`errorText`) turns them into
localised messages.

`probe` tells the popup about the current tab: its app (or a matching preset), whether Swapdeck has access, the
detected identity, the active and matching accounts, and a status: `match`, `mismatch`, `unsaved`, `signed-out` or
`unknown`.

## 12. Permissions

| Permission                                | Why                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`, `unlimitedStorage`             | Apps, accounts, saved sessions (snapshots can be large), settings, history — on this device                                                           |
| `cookies`                                 | Save and restore the sign-in cookies of added sites (requires host access to those sites)                                                             |
| `scripting`                               | Read/replace the site's web storage during a save or switch, overlay, confirmation toast, unsaved-work check (page's own world), on-page confirmation |
| `activeTab`                               | The popup can offer "Add this site" for the current tab                                                                                               |
| `contextMenus`, `alarms`, `favicon`       | Right-click switching, auto-lock, site icons in the UI                                                                                                |
| `declarativeNetRequestWithHostAccess`     | The script-blocking CSP rule on the staging page, in one tab, during a swap                                                                           |
| `sidePanel`                               | The switcher in Chrome's side panel (`side_panel.default_path: sidepanel/sidepanel.html`)                                                             |
| `tabGroups`                               | "Open workspace" names and colours the tab group of the workspace's pages; each separate tab's pages are grouped under its account                    |
| `webRequest`                              | Separate tabs: reads `Set-Cookie` of the added sites' responses in those tabs (with `extraHeaders`), to keep them in the lane's jar (§6a)             |
| Optional host access (`*://*/*` declared) | Requested **per app** when it is added, e.g. `*://*.supabase.com/*`; released when the app is removed                                                 |

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
- **IndexedDB** is opt-in per app and limited to 40 MB. A database another tab keeps open (outside the app's own
  tabs, which are parked) fails the switch with `STORAGE_BLOCKED`.
- **sessionStorage** belongs to one tab: a tab opened after a switch starts without it.
- A **workspace switch** is sequential (a few seconds per app); an app whose tab shows a "Leave site?" prompt times out
  and is reported as failed while the others go on. Apps sharing a sign-in provider (e.g. several sites signing in with
  the same GitHub account) only switch the sites themselves, not the provider.
- No incognito; sites that bind sessions to device fingerprints may reject restored sessions.
- **Separate tabs** cover the app's own domains: a sign-in provider on another domain (GitHub, Google…) uses the
  browser's account there. Requests made by the site's service worker or shared workers carry no tab, so they use the
  browser's sign-in (Swapdeck warns when a lane page is controlled by one); dedicated workers' `indexedDB` and
  `BroadcastChannel` aren't renamed. SameSite isn't applied to the lane's cookies (they go with every request to the
  app's sites from that tab, even one asking for no credentials). A page served from a service worker without its lane
  is reloaded once. An XHR of a lane page to another origin of the app can't be kept out of the HTTP cache (no header
  can be added there without a CORS preflight). A page that was open before the lane's keys existed doesn't hide them
  (its `localStorage.clear()` also removes them).
  A lane's cookies live in memory; what changed since its last save is lost if Chrome crashes.

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
