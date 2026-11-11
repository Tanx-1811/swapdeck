# Changelog

All notable changes to Swapdeck are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.8.0 — 2026-11-11

Two accounts of the same site, side by side: **separate tabs**.

- **Open in a separate tab** (popup or manager: ⋯ next to an account; right-click a page or a link; works for any saved
  account but the one your tabs use): the account opens in a new tab with its own sign-in, while your other tabs keep
  theirs — same window, no Chrome profile. Its tabs are grouped under the account's name and colour, the toolbar badge
  shows it, links it opens in new tabs stay with it, and important accounts keep their red strip there.
- **Scratch tab** (popup, manager, right-click, or a shortcut you set): a separate tab with nobody signed in. Sign in with
  anyone; close it and it's gone, or **Save as account** from the popup — the tab then becomes that account's.
- In a separate tab the popup says so: who is signed in there, which account your other tabs keep, and **Use in all
  tabs** (your other tabs switch to it; these tabs become ordinary ones), **Another tab**, **Close separate tab**.
- A separate tab's session is saved into its account while you use it (only when it is that account's person — someone
  else signed in there is never saved into it) and once more when it closes; switching your tabs to that account takes
  the separate tab over with its latest sign-in.
- After Chrome restarts (or Swapdeck updates), separate tabs come back in their groups; when that isn't possible (a
  locked passphrase, a scratch tab, two separate tabs whose accounts have the same name) their group is removed rather
  than claim an account the tabs no longer have.
- **Import a sign-in** (an app's ⋯ in the manager): paste or pick an export from Cookie-Editor, EditThisCookie, Playwright
  (`storageState`, with local storage) or a `cookies.txt`, and it is saved as the account it belongs to (never one
  where nobody is signed in, nor into an account of someone else).
- **Send to someone** (⋯ of an account or a workspace): a file with just that account or workspace and its sign-ins,
  always locked with a password. Whoever receives it adds it with Backup → Import; such a file can never replace their
  data, and a sign-in in any imported file only goes into an account it belongs to.
- Closing a scratch tab where someone signed in and wasn't saved asks first; separate tabs wear their own indigo mark
  (never the red "in use" seal), and long names or emails no longer widen the popup.
- **The manager lists your separate tabs** (Overview, and an app's page): each one's account or "Scratch n", the app,
  how many tabs and who is signed in there, with **Show**, **Save as account** (a scratch tab, or someone else signed
  in to an account's tab) and **Close**. The list follows them as they open, change and close.
- **Close separate tab** asks first when its tabs hold unsaved work (an edited form, text being typed, a page that
  warns before you leave), as a switch does — from the popup, an account's ⋯ menu and the manager's list.
- **The popup in a separate tab** says what each action changes: the account list is headed "Your other … tabs",
  **Another account in a scratch tab** takes the place of "Sign in with another account" (this tab and your other tabs
  stay as they are), and opening the app says it opens an ordinary tab. "Open in a separate tab" explains itself on
  hover.
- **Import a sign-in:** a paste over 2 MB is reported as too large instead of being cut short without a word.
- New permission `webRequest` (no install warning): separate tabs read the cookies your added sites set there, so they
  stay in that tab instead of Chrome's cookie store. Privacy policy and store listing updated.
- Store screenshots and a 21-second demo video (`npm run video`) show separate tabs; the README shows the demo.

## 1.7.0 — 2026-11-06

A review of every part of Swapdeck — switching, sync, the lock, backups, every screen, and Swapdeck Desktop — found
and fixed what could mix two accounts, lose data or confuse; Swapdeck Desktop 1.4.0 comes with it.

- **The workspace in use is always shown** at the top of the Swapdeck window; click it to search and switch between all
  your workspaces. Long lists of workspaces fold into "All N", and each account shows which workspaces use it.
- **Show the account on its pages** (Settings): for important accounts only, as before, or for every account — a quiet
  strip with the workspace (or app) and the account, so you always see which client you are acting as.
- **Checked after every switch:** if the site still shows another person once the page loads, history says so.
- Apps with many accounts get a **filter box**, and the account in use is brought into view.
- Switching while saved sign-ins are locked asks for the passphrase right where you are, then carries on.
- The manager works in narrow windows (nothing runs off the right edge), and the wide window falls back to the compact
  one when the browser is zoomed in.
- Link rules typed with accents or spaces ("acme.example/dự án") match, as in Swapdeck Desktop.
- Updated dependencies (Playwright 1.65, Vite 8.3.6, Vitest 5.1, ESLint 10.14, lucide-react 1.70, jsdom 31).
- **Swapdeck Desktop 1.4.0:** safer moves to another Mac, no lost workspaces, a window per workspace, links that only
  follow the page you pinned, and terminal tokens behind a single-use pass or Touch ID (see below).

**Switching — never between two accounts**

- Re-opening the account in use after a site signed you out restores its saved sign-in instead of overwriting it with
  the signed-out session.
- A switch that fails halfway is undone; if it can't be, the site is signed out — never left half one account, half
  the other. A switch interrupted by Swapdeck restarting is undone when it starts again.
- Apps that keep data in IndexedDB: a switch that can't replace it (another tab holds it open) is undone instead of
  reported as done.
- Other windows' tabs of the app pause during a switch, so they can't write the old sign-in back; apps that swap
  per-tab session storage get the new account's in every open tab.
- The switching tab moving to another site can no longer touch that site's storage.
- "Open link as" switches first, then opens the link, so one-time invite and sign-in links are never used by the
  wrong account.
- With "Links of another account: switch right away", a switch is no longer undone by the previous account's page.
- Shortcuts, the address bar and menus ask about unsaved work when re-opening the account in use, and follow "Ask
  before every switch" — as the manager now does too.
- Being offline (a page Swapdeck can't read) no longer marks accounts as expired; auto-sync checks who is signed in
  in the session it saves; pages that hang can no longer block an app's switches.
- Workspace switches fix apps signed in as someone else, and a workspace switch where nothing could be switched says
  so (one line per app) and doesn't count as used.

**Sync of the list**

- Removing something and setting it up again while another computer was asleep no longer deletes the new one
  everywhere.
- Edits made offline (notes, pins, workspace links) are kept when another computer changes the same item in another
  way, a reorder included.
- Computers still on an older version can no longer erase newer details such as link rules.
- Workspace members whose account can't sync yet are kept rather than dropped.
- When the list outgrows Chrome Sync, what fits is still sent (apps, then accounts, then workspaces) and Settings says
  how many items wait; before, nothing was sent at all.
- A removal stays removed even when a computer that was offline for months sends the item back, a wrong clock can no
  longer cut a removal short, and a removal made during a sync is always passed on.

**Lock, backups and data**

- Changing the passphrase creates new keys and encrypts every saved session again, so the old passphrase opens
  nothing; a damaged lock is reported clearly; turning the lock on twice at once can't make sessions unreadable.
- Turning the lock off drops sessions that can't be decrypted and marks their accounts as having nothing saved.
- A backup with sessions leaves out a session that can't be read and names it, instead of failing.
- Importing a backup on a new computer no longer marks an imported account as the one in use (the first switch would
  have overwritten its session).
- "Delete all data" leaves no sign-in behind if a save finishes at the same moment; an invalid auto-lock value falls
  back to 30 minutes instead of turning auto-lock off.
- Stricter checks on who may send requests to Swapdeck and on ids read from files, storage and Chrome Sync.

**Polish**

- Pressing Enter twice no longer creates a workspace twice; menus close when you scroll; keyboard focus returns where
  it was after a dialog, and danger confirmations start on Cancel; a "Skip to content" link and focus on each page's
  heading.
- Long account names stay readable next to their Important, Expired and In use labels; the apps list shortens the
  accounts summary instead of the app's name; initials ignore punctuation; the link card keeps long names on one line.
- "Restore previous session" only shows when there is one; an app with no accounts offers to open it to sign in.
- Wording: "just now" / "vừa xong", "1 app" (singular forms in English), "Đưa lên/xuống", "Ứng dụng & tài khoản",
  "Mật khẩu Swapdeck", and more natural Vietnamese across the manager.

**Swapdeck Desktop 1.4.0**

- Moving to another Mac is safer: a workspace whose old profile folder now holds someone else's profile is left
  without a profile instead of opening the wrong account; "Match profiles again" finds it after you sign in to Chrome,
  and matching by name ignores names Chrome chose itself and names two profiles share.
- No more lost workspaces: a long or empty name no longer makes a workspace disappear at the next launch; long notes
  are kept; the editor won't accept an empty name or one another workspace already has.
- Each workspace has its own window: names are unique, a workspace moved to another profile gets a new window, and
  opening several quickly no longer mixes up window names.
- Links: a pinned page covers that page and what's under it, not its whole site; when two workspaces share the best
  rule Swapdeck asks (and the editor warns); a link for a workspace without a profile opens the chooser.
- Terminal tokens: "Open in Terminal" loads them with a single-use pass that lasts 60 seconds; any other use of
  `--env`, including "Copy command", asks for Touch ID or your password. If they can't be loaded, the terminal says so
  and stops instead of running your tools with your default account. Deleting a workspace removes all of its tokens.
- Tokens and edits typed just before quitting or opening a terminal are saved first; "Check for updates" works when the
  latest release only contains the extension.

## 1.6.0 — 2026-11-04

Links open with the right account, expired sessions show up before they bite, and Swapdeck Desktop 1.3.0 gives each
workspace its own terminal. Before release, a review of every screen and of the switching and sync code brought the
fixes and polish listed at the end.

- **Links of another account:** open a page that belongs to another saved account — a project link from Slack or an
  email, say — and Swapdeck offers to switch right on the page ("Switch to Bob" / "Always switch" / "Not now"), then
  reopens that same page with the right account. It knows from each account's recent projects and pinned pages, and
  from links you give an account in its editor ("supabase.com/dashboard/project/…", "acme.example" — the same rules
  as Swapdeck Desktop). Settings can make it switch right away, or do nothing. "Not now" on a project the account in use
  opens too stops asking about it. Right-click a link to an added site → **Open link as** an account.
- **Expired sessions:** when a site shows nobody signed in while one of your accounts is in use (its saved session no
  longer works), the account gets an **Expired** label in the popup and the manager, a warning on the page, and a place
  under **Sign in again** with a "Sign in again" button; signing in saves the new session at once and clears the label.
- **Get started with Swapdeck:** a checklist on the overview (add an app, save two accounts, create a workspace, lock,
  back up, optionally sync) that ticks itself off; hide it, and bring it back from Help.
- **Check for updates** (Help): asks GitHub for the latest release only when you press it, and explains how to update an
  unpacked copy without losing anything. Copies from the Chrome Web Store are updated by Chrome.
- A page asked for by a switch (a recent project, a link) is only followed when it belongs to that app.
- Updated dependencies (Vite 8.3.5, typescript-eslint 8.72, lucide-react 1.61, @types/chrome); TypeScript 7 waits
  until typescript-eslint supports it (Dependabot holds it back meanwhile).
- **Swapdeck Desktop 1.3.0 — a terminal per workspace:** give a workspace the tokens its command-line tools use
  (Supabase, Vercel, GitHub, Netlify, Cloudflare, Fly.io, Railway, Heroku, DigitalOcean; AWS and Google Cloud profiles;
  any other variable) and a folder; **Open in Terminal** (or iTerm) starts a shell with them, and **Copy command** gives a
  line that loads them into any terminal (`eval "$(… --env acme)"`). Tokens live in the Keychain — never in the data
  file, an exported file, a script on disk or the shell history. Also **Check for updates** in Settings.

**Fixes**

- **Sync of the list:** removing a duplicate account on one computer could remove the matching account — and its saved
  sign-in — on every computer, when that computer had matched both duplicates to one account. Two accounts of one
  computer are no longer folded into one elsewhere, and a removal only takes something away when nothing else still
  stands for it. A removal written in the same millisecond as the last change is no longer missed.
- **Adding a preset from the popup** and then refusing access no longer removes an app of that preset that was already
  there (with its accounts).
- **Saving before a switch:** when the account in use doesn't know who it is yet and someone already saved under
  another account signed in by hand, their session goes to their own account instead of taking over the one in use.
  "Save this session" no longer files a session under an account on a weak guess.
- **"Next account"** skips accounts that have no saved sign-in here instead of getting stuck on them.
- **IndexedDB:** restoring it while another tab holds the database open no longer hangs the switch (and every later
  switch of that app); it gives up after a while and the switch is undone as on any other error.
- **Backups:** merging no longer silently drops an app set up here with another main address on the same site; its
  accounts join the app here (sign-ins saved for the other address stay out). Apps that can't be imported are named.
- A session saved for an account deleted meanwhile is no longer left behind on disk; two apps checked at once no longer
  lose each other's page status.

**Polish**

- Popup: the "This page" card wraps instead of cutting off its buttons; on a site that can be added, that is the one
  primary action. The wide popup shows the app used last instead of an empty column, and asks for the passphrase up
  front when the saved sign-ins are locked. "Workspaces" is spelled out in the bar.
- Manager at half-screen width: the sidebar becomes a rail of icons (names as tooltips), and a strip of tabs on narrow
  windows, instead of wrapping.
- Shortcuts are listed in Swapdeck's language with the keys set in Chrome, the same way in Overview, Settings and Help.
- Overview: the "Get started" checklist and the lock/backup reminders no longer repeat each other, its buttons keep
  their size, the optional step is unnumbered; once set up, the banner slims down. The workspace in use wears the seal
  instead of a disabled button (also on the Workspaces page).
- Apps with nothing added offer six popular apps in one click; the gallery starts with "Another website" by address,
  shows 30 apps with "Show all", and labels the ones already added.
- Backup: the list alone (no password) is the default, and a greyed-out download says why. Empty workspaces point to
  saving accounts first; a new workspace starts with a symbol.
- Vietnamese: one word for switching ("chuyển"), one spelling (khóa, xóa), typographic quotes, "liên kết" and "cửa sổ
  Swapdeck" instead of English words, no more "Chưa dùng" next to "Đang dùng", lower-case relative times mid-sentence,
  sizes under 1 KB no longer read "1.003 B". Settings toggles all explain themselves.

## 1.5.0 — 2026-10-21

Nothing lost when Chrome or the computer changes, and Swapdeck Desktop 1.2.0.

- **Backup reminder:** a few days after the first saved sign-in, and a month after the last backup, the popup and the
  overview suggest a backup; **Back up now** downloads the list in one click (no sign-ins, so no password). The Backup
  page shows when the last one was made.
- **Moving to another computer:** the Backup page walks through it (back up the list, import it, sign in once per
  account), and **Sign in again on this computer** lists every account that has no saved sign-in here, with one
  "Sign in" button each; Swapdeck files the new sign-in under the right account by itself.
- **Sync the list across computers** (Settings, off by default): apps, accounts and workspaces stay the same on every
  computer signed in to your Chrome profile, through your own Chrome Sync. Sign-ins never travel. The same app or
  account set up on two computers is recognised (same site, same signed-in user, same workspace name) instead of
  copied; what you remove on one computer is removed on the others, while something that only went missing on one
  computer comes back instead of disappearing everywhere. **Remove from Chrome Sync** clears it there without deleting
  anything on any computer.
- Replacing everything from a backup now keeps the backup reminder's state and turns sync of the list off on that
  computer (the notice says so); deleting all data warns that Chrome Sync and other computers keep the list.
- **Swapdeck Desktop 1.2.0:** **Import & export → Move to another Mac**: export the workspaces to a file, import it on
  the new Mac, and Swapdeck finds each workspace's browser profile again by its Google account or its name, even when
  the folder differs ("Match profiles again" does it any time). Workspaces now remember their profile's name and
  account for this.

## 1.4.0 — 2026-10-21

Fewer surprises when switching, and Swapdeck Desktop 1.1.0.

- **Unsaved work:** before a switch reloads an app's tabs, Swapdeck looks at them for edited forms, text being typed
  and pages that warn before you leave, and asks first, listing the tabs ("Switch anyway" / Cancel). Works for account
  switches, "Sign in with another account" and workspaces, from the popup, the side panel and the manager. It can be
  turned off in Settings.
- **Shortcuts, the address bar and menus ask too:** switching to an important account, or away from unsaved work,
  with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, `swd` in the address bar or the toolbar button's menu now asks on
  the page itself (Escape or a timeout answers no; the page can't answer for you), or in a small Swapdeck window when
  the page can't show it.
- **Swapdeck Desktop 1.1.0:** make it the default web browser and links from Slack, Mail and other apps open in the
  workspace they belong to — by its pages and by rules you add ("acme.example", "supabase.com/dashboard/project/…");
  links that match nothing show a chooser (or go to the workspace in use, or open normally), and ⌥ Option while
  clicking always asks. Profiles it creates for a workspace now get the workspace's name and color right away.

## 1.3.0 — 2026-10-21

**First public, open-source release (MIT).** Safer day-to-day use, and a desktop companion.

- Open source: MIT license, contributor guide, code of conduct, security policy (private reporting), issue forms for
  bugs, ideas and site requests, Dependabot, CI for the extension and the desktop app. The extension's Help page and
  the desktop settings link to the source code and issues; `public/THIRD_PARTY_NOTICES.txt` ships the bundled
  licenses (React, Lucide, and the SIL OFL fonts).

- **Important accounts:** mark an account as important (production, a client's live account) in its editor. It gets a
  red label everywhere it is listed, a red strip with its name along the top of every page of the app while it is in
  use, a warning-toned confirmation on the page after switching, and Swapdeck asks before switching to it (from the
  popup, the side panel, the manager, or a workspace that would switch to it).
- **Lock reminder:** once two or more sessions are saved and no passphrase is set, the popup and the overview suggest
  turning on the passphrase lock ("Later" hides it for two weeks).
- **Swapdeck Desktop 1.0.0** (new, `desktop/`): a macOS menu bar app that keeps each workspace in its own Chrome (or
  Brave, Edge) profile and brings its window forward in one click or with <kbd>⌃⌥B</kbd> — no sign-in is ever copied.
  Names each workspace's window, opens its pages in a new window, creates profiles, imports workspaces from browser
  profiles or from an extension backup (plain or password-protected), English and Vietnamese, light and dark, in the
  same lacquer-and-paper look. See `desktop/README.md`.

## 1.2.0 — 2026-10-20

A new look with its own character: **"sơn mài & giấy dó"** (lacquer & paper).

- **Design language:** ink on warm paper in light mode, eggshell on black lacquer in dark mode, a fine paper grain, and
  one accent that marks what is in use. The popup's lid and the manager's sidebar are black lacquer.
- **Type:** Be Vietnam Pro for text (drawn for Vietnamese), Fraunces for titles and figures, JetBrains Mono for
  addresses and keys. The fonts ship inside the extension: nothing is downloaded.
- **Accounts are index cards:** the account in use sits on top of the deck and carries a vermilion **"In use" seal**
  (popup, side panel, manager, workspaces). "Sign in to another account" is a blank dashed card.
- **Accent color** (Settings): vermilion (default), jade, indigo or gold leaf, in light and dark.
- **Symbols instead of emoji** for accounts and workspaces: 20 line icons (briefcase, building, handshake, rocket…).
  Emoji chosen in earlier versions still show until you pick a symbol or initials.
- **New palette** for account, workspace and app colors (vermilion, indigo, jade, turmeric, plum…), each named in the
  color picker and readable with white text; colors you already use stay available.
- Overview hero with an illustrated deck and ledger-style figures; Fraunces page titles; quieter tables, tabs and chips.
- The switching screen and the page toasts use the same paper/lacquer palette.
- **New icon and brand kit:** a fanned deck of cards on black lacquer with a vermilion seal (toolbar icon, logo, store
  tiles, social images, store screenshots). `npm run brand` now runs offline on any OS.
- Accessibility: every page passes axe (WCAG 2.1 AA) in light and dark with each accent color.

## 1.1.0 — 2026-10-19

Made for people who manage many apps and switch between many clients, companies or projects (VI: "các bên").

- **Workspaces** ("Các bên"): a workspace is a client, company or project — the saved account it uses on each app. One
  click switches every app of the workspace: the current tab's app first, in that tab; apps with open tabs reload with
  the new account; apps that aren't open switch in one shared hidden tab, so nothing new opens. Each app reports its
  result (switched, already in use, no access, no saved session, failed) and the popup shows progress. History entries
  of a workspace switch are tagged with its name.
- Workspaces are made in the manager (pick the account for each app, or "Use the accounts in use"), from the popup
  ("New from the accounts in use"), or from **suggestions** that group accounts by email domain (free email addresses
  become "Personal"; domains that already have a workspace aren't suggested again).
- **Open workspace:** switches the accounts, then opens the workspace's pages together in a named, coloured tab group.
- Switch workspaces from the popup's workspace bar, the manager, the toolbar button's right-click menu, the address bar
  (`swd` + a workspace name) or the new "next workspace" shortcut (no key assigned by default).
- **Wide popup** (720 px): every app on the left with the account it uses, its accounts on the right. Automatic with
  three or more apps; can be set to compact or wide in Settings.
- **Search everything** in the popup: workspaces, accounts (by app, name, email or note) and apps. Switching another
  app's account from the popup happens in the background; "Switch and open" opens it as well.
- **Side panel:** the same switcher, open next to the page and following the active tab. Open it from the popup, the
  toolbar button's right-click menu or a shortcut, or make it what the toolbar button opens (Settings).
- **164 built-in apps** (was 32) in 11 groups — backend & data, hosting, cloud & servers, developer tools, AI, work &
  teams, design & sites, business, online stores, social, and **Vietnam** (Shopee Kênh Người Bán, Lazada, Tiki, Pancake,
  Haravan, Sapo, Nhanh.vn, GHN, GHTK, Viettel Post, Ahamove, MISA AMIS, Base.vn, MoMo Business, ZaloPay Merchant, Mắt
  Bão, PA Việt Nam, iNET, Tenten, Bizfly Cloud). `node scripts/verify-presets.mjs` checks every preset against the live
  sites.
- **Add several apps at once** from the gallery ("Select several": one permission prompt for all of them), and add an
  unknown site from the popup in one click ("Add this site", or "Customize…").
- Backups include workspaces (imported workspaces are mapped to the imported apps and accounts; a workspace with the
  same name isn't imported twice).
- New permissions, both without an install warning: `sidePanel` and `tabGroups`.
- **Sturdier switching page:** when a site's switching page redirects elsewhere while signed out (e.g. Xata), the switch
  falls back to `/favicon.ico`, `/robots.txt` or `/` on the same address instead of failing.
- **Live check** (`npm run test:live`): every preset is added, opened and put through a full signed-out switch on the
  real site; all 164 pass.

## 1.0.0 — 2026-10-19

First release.

- **One-click account switching** for any site, built around Supabase: saves each account's sign-in (cookies and the
  site's local storage, optionally session storage and IndexedDB) and swaps it in on a static page of the site with the
  site's scripts blocked, rolling back on any error.
- **32 presets** (Supabase, Neon, MongoDB Atlas, Upstash, Clerk, Convex, Stripe, Vercel, Netlify, Cloudflare, Railway,
  Render, Fly.io, Heroku, DigitalOcean, GitHub, GitLab, Postman, Sentry, Linear, Figma, Notion, ChatGPT, Claude, Cursor,
  OpenRouter, Facebook, Instagram, X, TikTok, Discord, Shopee) and custom sites.
- **Identity detection** (Supabase dashboard, supabase-js and `@supabase/ssr`, Firebase, JWT, GitHub) so sessions are
  always saved into the account they belong to; **auto-capture** of new sign-ins and **auto-sync** of the active
  account's session.
- **Sign in with another account** without signing out; "save this session"; restore the previously saved session.
- **Recent items** (Supabase projects) and **pinned pages** per account; each account reopens on its last page (or the
  same page, or the app's home).
- Toolbar **popup** with status, search and `1`–`9` keys; full **manager** (overview, apps & accounts, preset gallery,
  app settings, history, backup, security, settings, help).
- **Badge** with the active account, in-page confirmation toasts, **right-click menu**, `swd` **omnibox** keyword,
  shortcuts `Alt+Shift+A` (open) and `Alt+Shift+S` (next account).
- **Passphrase lock** (RSA-OAEP + AES-256-GCM, PBKDF2-SHA-256 310,000 iterations) with auto-lock; saving works while
  locked.
- **Backups**: export/import, merge or replace; sessions always password-encrypted.
- Per-site optional host access, no access at install; incognito disabled; Google/Microsoft/Apple domains refused.
- English and Vietnamese, light and dark themes; brand kit and store promo tiles.
