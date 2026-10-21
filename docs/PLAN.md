# Swapdeck — product plan

**Swapdeck** is a Chrome extension (Manifest V3) for people who use several accounts on the same website — first of all
Supabase (work, personal and client organisations), then any site. It keeps one saved sign-in per account and swaps it
into the browser in one click. Since 1.1 it also switches whole **workspaces** ("các bên"): the owner manages many apps
and switches between many clients, companies and projects, each with its own account on every app.

Tagline: **"Switch accounts in one click"** / **"Đổi tài khoản chỉ với một cú nhấp"**. Languages: Vietnamese and English
(follows Chrome, switchable in Settings). The product owner speaks Vietnamese.

## 1. Goals

1. Switching Supabase dashboard accounts takes one click and never loses a session.
2. The same works for any site the user adds — 164 verified presets (including Vietnamese services) plus custom sites.
3. Switching a whole party (client, company, project) across every app takes one click too, without opening tabs the
   user didn't ask for.
4. Safe by default: no access to any site at install, nothing leaves the device, sessions optionally encrypted.
5. Polished, comfortable UI (light/dark, VI/EN, keyboard-friendly), like the owner's other extensions (Breakpointer,
   Penmark), roomy enough for dozens of apps.

## 2. Scope of 1.0

| Surface        | What ships                                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup          | Accounts of the current tab's app with status (signed in as / unsaved / mismatch / signed out / no access), switch (click or `1`–`9`), sign in with another account, save this session, edit, pin page, start page, update session, restore previous, delete, unlock; all apps when the tab isn't one; add this site / preset.                            |
| Manager        | Overview (stats, getting started, apps, recent activity, shortcuts), apps & accounts (reorder, switch, edit, pins, recents), preset gallery and custom site, app settings (domains, main address, parts of the session, detector, advanced), history, backup (export/import, merge/replace), security (passphrase lock, auto-lock, wipe), settings, help. |
| Service worker | Switch engine with staging page + script-blocking rule and rollback, identity-checked saves, auto-capture of new sign-ins, auto-sync, last page and recent items (Supabase projects), badge, right-click menu, `swd` omnibox, shortcuts, auto-lock.                                                                                                       |
| Presets        | Supabase, Neon, MongoDB Atlas, Upstash, Clerk, Convex, Stripe, Vercel, Netlify, Cloudflare, Railway, Render, Fly.io, Heroku, DigitalOcean, GitHub, GitLab, Postman, Sentry, Linear, Figma, Notion, ChatGPT, Claude, Cursor, OpenRouter, Facebook, Instagram, X, TikTok, Discord, Shopee.                                                                  |
| Brand          | Icon (16/32 small variant), logo lockups, store promo tiles EN/VI, social images (`brand/`).                                                                                                                                                                                                                                                              |

## 3. Added in 1.1

| Surface    | What ships                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspaces | Create (by hand, from the accounts in use, from email-domain suggestions), edit (account per app, pages), reorder, delete; switch every app at once (current tab's app first, others in the background), per-app results and progress; "Open workspace" (pages in a named, coloured tab group); toolbar-button right-click menu, omnibox, next-workspace command. |
| Switcher   | Popup layouts auto / compact / wide (720 px, app list + accounts); search over workspaces, accounts and apps; background switching of other apps ("Switch and open" to open them); "Add this site" in one click.                                                                                                                                                  |
| Side panel | The same switcher next to the page, following the active tab; can be what the toolbar button opens.                                                                                                                                                                                                                                                               |
| Presets    | 164 presets in 11 groups (backend, hosting, cloud, devtools, AI, work, design, business, commerce, social, Vietnam), checked live by `scripts/verify-presets.mjs`; gallery multi-select adds many at once with one permission prompt.                                                                                                                             |

## 4. Decisions

| #   | Decision                                                                                                                                       | Why                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Swap sessions** (save/restore cookies + web storage) rather than isolate parallel sessions per tab (containers).                             | Containers can't be done reliably in MV3 (no per-tab cookie jars); swapping works with any site and keeps normal browsing untouched.                       |
| D2  | Swap on a **staging page** of the same origin (`/robots.txt` by default) with a **declarativeNetRequest CSP rule** blocking page scripts.      | The app's own code must not write the old session back mid-swap; the staging page unloads it, and the CSP covers sites that serve their app on every path. |
| D3  | **Identity-checked saves** (`decideSave`): sessions are saved into the account they belong to, signed-out sessions never overwrite saved ones. | The worst failure is losing or mixing up a session; detection from saved data (no network) makes it provable.                                              |
| D4  | **Auto-capture and auto-sync** (both on by default, settings to turn off).                                                                     | New sign-ins are kept without extra clicks; refresh-token rotation makes stale copies fail, so the active account's copy is refreshed while used.          |
| D5  | **Public-key vault:** RSA-OAEP key pair, private key encrypted with a PBKDF2-derived key; sessions sealed with the public key.                 | Saving (switching away, auto-sync) must work while locked; only restoring needs the passphrase.                                                            |
| D6  | **Per-site optional host access**, requested when an app is added and released when removed. No host access at install.                        | Least privilege; the store and users can see exactly which sites are touched.                                                                              |
| D7  | **Block Google, YouTube, Gmail, Microsoft Online, Live and Apple** domains.                                                                    | Chrome's own sign-in and sync depend on them; they have native account switchers.                                                                          |
| D8  | **Incognito not allowed.**                                                                                                                     | Incognito sign-ins vanish with the window; saving them would outlive the user's intent.                                                                    |
| D9  | Shortcuts **`Alt+Shift+A`** (open) and **`Alt+Shift+S`** (next account); others unassigned.                                                    | Don't clash with Penmark (`Alt+Shift+N/K/H/C`) or Breakpointer (`Alt+Shift+V/P`), which the owner also uses.                                               |
| D10 | Omnibox keyword **`swd`**.                                                                                                                     | Unusual on purpose: a common word would hijack ordinary searches (same rule as `bpt`, `pmk`).                                                              |
| D11 | Keep the **previous saved session** of each account (`sd:prev:*`) with "Restore the session saved before".                                     | A safety net if a wrong or signed-out session is ever saved.                                                                                               |
| D12 | Backups with sessions are **always password-encrypted**.                                                                                       | Sessions are as sensitive as passwords.                                                                                                                    |
| D13 | Only the app's **main origin** has its web storage swapped; cookies cover all its domains.                                                     | Keeps switching fast and predictable; covers the sites in the presets.                                                                                     |
| D14 | Store category **Productivity**, React 19 + Vite 8 stack shared with Breakpointer/Penmark.                                                     | Familiar tooling for the owner. Since 1.2.0 Swapdeck has its own look ("sơn mài & giấy dó", see CLAUDE.md → Design) instead of the shared one.             |
| D15 | **Workspaces** (VI "bên") are the multi-party unit: `appId → accountId`, apps not listed are left alone.                                       | The owner switches between clients/companies across many apps; one click must set every app, while unrelated apps keep their account.                      |
| D16 | Workspace switches are **sequential, per app, through the normal `switchTo`**; apps without open tabs swap in **one shared hidden tab**.       | Reuses the proven, identity-checked switch (no second code path); no visible tabs open; one failing app doesn't stop the others.                           |
| D17 | Workspace **suggestions by email domain**; free-mail domains grouped as "Personal"; domains that already have a workspace aren't suggested.    | Accounts at `@acme.io` belong to Acme in practice; setup for many parties should take seconds.                                                             |
| D18 | **Wide popup (720 px, automatic from three apps) and a side panel**, both the same `Switcher` component.                                       | Dozens of apps don't fit a 380 px list; heavy switchers want Swapdeck always open; one component keeps behaviour identical.                                |
| D19 | Switching **another app** from the popup happens **in the background**; "Switch and open" opens it.                                            | Preparing several apps for a client shouldn't pull the user away from the page they're on.                                                                 |
| D20 | **164 presets, each checked live** (`scripts/verify-presets.mjs`); no presets on Google/Microsoft/Apple sign-in or sharing another's domain.   | A broad catalogue only helps if every entry works; shared domains (e.g. Amazon/AWS, TikTok Shop/TikTok) would switch two apps at once.                     |
| D21 | Gallery **multi-select** with **one permission prompt** for all chosen sites (`app.addMany`).                                                  | Adding twenty apps one by one (twenty prompts) is the main friction for the owner's many apps.                                                             |
| D22 | **Open source under MIT**, public repository, Swapdeck Desktop in `desktop/` of the same repository.                                           | Community use and contributions; one place for the extension, the desktop app and the brand kit.                                                           |

## 5. Open questions for the owner

1. Confirm the name **Swapdeck** (chosen during the build).
2. Choose a **license** (none yet).
3. Create the **GitHub repository** — public or private? (The Chrome Web Store needs a public privacy-policy URL.)
4. **Chrome Web Store** developer account (one-time $5) and the submission (unlisted first?).
5. **Support email** for the listing and the privacy policy.

## 6. Ideas for later

- **Supabase CLI companion:** switch `supabase login` access tokens per account (macOS Keychain), alongside the browser.
- **Firefox port** (containers could also offer parallel sessions there).
- **Several storage origins** per app (sites that keep sign-in state on more than one subdomain).
- **Sync across devices** (encrypted, opt-in).
- Partitioned (CHIPS) cookies support; per-account notes and colours shown on the site itself; more presets on request.
- **Parallel workspace switching** (several apps at once) if sequential switching gets slow with many apps; scheduled
  workspaces (e.g. "Client A" every morning).
