# Changelog

All notable changes to Swapdeck are listed here. Versions follow [Semantic Versioning](https://semver.org/).

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
