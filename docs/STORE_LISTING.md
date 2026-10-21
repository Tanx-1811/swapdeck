# Chrome Web Store listing

Copy-ready text and the answers the store asks for. Assets live in `brand/` (see `brand/README.md`). Lengths below were
checked with a script (characters, NFC).

## Basics

| Field                      | Value                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name (from `_locales`)     | EN: **Swapdeck — Multi-Account Switcher** (33) · VI: **Swapdeck — Đổi nhiều tài khoản** (30) — limit 75                                                             |
| Category                   | Productivity (alternative: Developer Tools)                                                                                                                         |
| Languages                  | English (default), Vietnamese                                                                                                                                       |
| Store icon                 | `brand/store/store-icon-128.png` (96 × 96 artwork, 16 px transparent padding)                                                                                       |
| Small promo tile (440×280) | `brand/store/promo-small-440x280.png` · VI: `brand/store/promo-small-440x280-vi.png`                                                                                |
| Marquee (1400×560)         | `brand/store/promo-marquee-1400x560.png` · VI: `brand/store/promo-marquee-1400x560-vi.png`                                                                          |
| Screenshots (1280×800)     | `brand/store/screenshots/{en,vi}-N-*.png` (`npm run screenshots`), in this order: 1 `popup` (wide switcher), 2 `workspaces`, 3 `accounts`, 4 `gallery`, 5 `private` |
| Privacy policy URL         | Public URL of `docs/PRIVACY.md` (needs a public repository or page)                                                                                                 |
| Support                    | Website: https://github.com/Tanx-1811/swapdeck · Support: https://github.com/Tanx-1811/swapdeck/issues                                                              |

## Short description (≤ 132 characters)

The store shows the manifest's `extDescription` (`public/_locales/{en,vi}/messages.json`), used since 1.1:

- **EN (123):** Switch accounts on Supabase, Vercel, GitHub and 160+ sites in one click — or every app of a client at once. No signing out.
- **VI (121):** Đổi tài khoản Supabase, Vercel, GitHub và hơn 160 trang chỉ với một cú nhấp — hoặc đổi mọi ứng dụng của một bên cùng lúc.

## Detailed description — English

Switch accounts in one click — on Supabase and 160+ other sites — or switch a whole client at once.

Swapdeck keeps a saved sign-in for each of your accounts and swaps it in when you switch. No signing out, no retyping
passwords, no extra Chrome profiles.

**Switch in one click**
• Click an account in the toolbar popup, right-click the page, press Alt+Shift+S for the next account, or type “swd” and
an account or workspace name in the address bar.
• Number keys 1–9 in the popup switch instantly; Alt+Shift+A opens it.
• Each account opens where you left it — or on the same page, or on the app's home page: you choose.

**Workspaces: a whole client in one click**
• A workspace is a client, company or project: the account it uses on each app. One click switches every app of it.
• Apps you have open reload with the right account; apps that aren't open switch in the background — no new tabs.
• Create workspaces in seconds: from the accounts you're using now, or from suggestions that group your accounts by
email domain.
• “Open workspace” switches the accounts and opens the workspace's pages together in a named tab group.

**Made for many apps**
• A wide popup lists every app next to its accounts, with one search box for workspaces, apps and accounts.
• Switch another app's account without leaving the page you're on.
• Keep Swapdeck open in Chrome's side panel while you work; it follows the tab you're on.

**Made for Supabase**
• Recognises which Supabase dashboard account is signed in.
• Remembers each account's recent projects and pinned pages, so you open a project with the right account directly.
• Works with your own Supabase-powered apps too (supabase-js and @supabase/ssr sessions are recognised automatically).

**Every site you use**
• 164 ready-made apps in 11 groups: databases and backends (Supabase, Neon, PlanetScale, MongoDB Atlas, Clerk…), hosting
(Vercel, Netlify, Cloudflare, Railway…), cloud and servers (AWS, DigitalOcean, Hetzner…), developer tools (GitHub,
GitLab, Atlassian, npm, Sentry…), AI (ChatGPT, Claude, Cursor, Perplexity…), work (Slack, Notion, Linear, ClickUp…),
design (Figma, Canva, Framer…), business (Stripe, PayPal, Resend, PostHog…), online stores (Shopify, Etsy…), social
networks and Vietnamese services (Shopee seller centre, Lazada, Tiki, GHN, GHTK, MISA AMIS, MoMo…).
• Pick several and add them at once, or add any other website from the popup in one click.

**Safe by design**
• “Sign in with another account” saves the current session first, then takes you to the sign-in page; on sites where
Swapdeck recognises the account, the new one is saved automatically.
• Swapdeck reads who is signed in and never files one person's session under another person's account.
• Saved sessions are kept fresh while you use an account, so switching back never restores an outdated sign-in.
• A badge on the toolbar icon shows which account the current tab uses.

**Private and secure**
• Everything stays on your computer. No account, no server, no analytics.
• No access to any site at install: each app you add asks for its own domains only.
• Optional passphrase lock encrypts saved sessions (RSA-OAEP + AES-256-GCM); auto-lock after a while.
• Encrypted backups to move your accounts to another computer.

**Comfortable**
• Important accounts (production, a client's live account) get a red label, a warning strip on their pages and a confirmation before switching.
• A calm lacquer-and-paper design, light and dark, a full manager with workspaces, history and settings, English and Vietnamese.

**Good to know**
Don't press a site's own “Sign out” — it ends the session on the site's server, so the saved copy stops working too. Use
“Sign in with another account” instead. Google, YouTube, Microsoft and Apple accounts aren't supported (Chrome itself uses
them, and they have their own account switchers).

## Detailed description — Tiếng Việt

Đổi tài khoản chỉ với một cú nhấp — trên Supabase và hơn 160 trang khác — hoặc đổi cả một bên cùng lúc.

Swapdeck giữ một bản đăng nhập cho mỗi tài khoản của bạn và đổi sang khi bạn chuyển. Không cần đăng xuất, không gõ lại
mật khẩu, không cần thêm hồ sơ Chrome.

**Chuyển trong một cú nhấp**
• Bấm vào tài khoản trong popup, chuột phải trên trang, nhấn Alt+Shift+S để sang tài khoản kế tiếp, hoặc gõ “swd” và tên
tài khoản hay tên bên trên thanh địa chỉ.
• Trong popup, phím số 1–9 chuyển ngay; Alt+Shift+A mở popup.
• Mỗi tài khoản mở lại đúng trang bạn đang xem lần trước — hoặc giữ nguyên trang, hoặc về trang chủ: tùy bạn chọn.

**Các bên: đổi cả một khách hàng trong một cú nhấp**
• Mỗi bên là một khách hàng, công ty hoặc dự án — gồm tài khoản dùng trên từng ứng dụng. Một cú nhấp đổi mọi ứng dụng
của bên đó.
• Ứng dụng đang mở tải lại với đúng tài khoản; ứng dụng không mở được đổi ngầm — không mở thêm tab nào.
• Tạo bên trong vài giây: từ các tài khoản đang dùng, hoặc từ gợi ý gom tài khoản theo tên miền email.
• “Mở bên” đổi tài khoản rồi mở các trang làm việc của bên đó cùng nhau trong một nhóm tab có tên.

**Dành cho người dùng nhiều ứng dụng**
• Popup rộng liệt kê mọi ứng dụng bên cạnh tài khoản của chúng, với một ô tìm kiếm chung cho bên, ứng dụng và tài khoản.
• Đổi tài khoản của ứng dụng khác mà không rời trang đang xem.
• Mở Swapdeck cố định ở bảng bên của Chrome khi làm việc; bảng bên đi theo tab bạn đang xem.

**Dành cho Supabase**
• Nhận ra tài khoản Supabase dashboard đang đăng nhập.
• Nhớ các dự án gần đây và trang đã ghim của từng tài khoản để mở thẳng một dự án bằng đúng tài khoản.
• Dùng được cả với ứng dụng Supabase của chính bạn (tự nhận ra phiên supabase-js và @supabase/ssr).

**Mọi trang web bạn dùng**
• Có sẵn 164 ứng dụng trong 11 nhóm: cơ sở dữ liệu và backend (Supabase, Neon, PlanetScale, MongoDB Atlas, Clerk…),
hosting (Vercel, Netlify, Cloudflare, Railway…), cloud và máy chủ (AWS, DigitalOcean, Hetzner…), công cụ lập trình
(GitHub, GitLab, Atlassian, npm, Sentry…), AI (ChatGPT, Claude, Cursor, Perplexity…), công việc (Slack, Notion, Linear,
ClickUp…), thiết kế (Figma, Canva, Framer…), kinh doanh (Stripe, PayPal, Resend, PostHog…), cửa hàng online (Shopify,
Etsy…), mạng xã hội và dịch vụ Việt Nam (Shopee Kênh Người Bán, Lazada, Tiki, GHN, GHTK, MISA AMIS, MoMo, Mắt Bão…).
• Chọn nhiều ứng dụng rồi thêm một lần, hoặc thêm bất kỳ trang nào khác ngay từ popup bằng một cú nhấp.

**An toàn ngay từ thiết kế**
• “Đăng nhập tài khoản khác” lưu phiên hiện tại trước, rồi đưa bạn tới trang đăng nhập; ở các trang Swapdeck nhận ra
được tài khoản, tài khoản mới được tự lưu.
• Swapdeck đọc ai đang đăng nhập và không bao giờ lưu phiên của người này vào tài khoản của người khác.
• Phiên đã lưu được làm mới khi bạn dùng tài khoản, nên chuyển về không bị phiên cũ.
• Huy hiệu trên biểu tượng cho biết tab hiện tại đang dùng tài khoản nào.

**Riêng tư và bảo mật**
• Mọi thứ nằm trên máy của bạn. Không tài khoản, không máy chủ, không thống kê.
• Khi cài không có quyền trên trang nào: mỗi ứng dụng bạn thêm chỉ xin quyền đúng tên miền của nó.
• Khóa bằng mật khẩu (tùy chọn) mã hóa các phiên đã lưu (RSA-OAEP + AES-256-GCM); tự khóa sau một thời gian.
• Sao lưu có mã hóa để chuyển tài khoản sang máy khác.

**Dễ dùng**
• Tài khoản quan trọng (production, tài khoản thật của khách) có nhãn đỏ, dải cảnh báo trên trang và hỏi lại trước khi chuyển.
• Giao diện “sơn mài & giấy dó” sáng/tối, trang quản lý đầy đủ với các bên, lịch sử và cài đặt, tiếng Việt và tiếng Anh.

**Cần biết**
Đừng bấm “Đăng xuất” trên trang web — việc đó kết thúc phiên trên máy chủ của trang, nên bản đã lưu cũng hết hiệu lực.
Hãy dùng “Đăng nhập tài khoản khác”. Không hỗ trợ tài khoản Google, YouTube, Microsoft và Apple (chính Chrome dùng các
tài khoản này, và chúng có sẵn tính năng đổi tài khoản).

## Single purpose

Swapdeck lets the user keep several accounts for the same website and switch the browser between them — one site at a
time, or several sites together for a saved workspace — by saving and restoring those sites' sign-in data on the user's
device.

## Permission justifications

| Permission                            | Justification                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                             | Stores the user's apps, accounts, saved sign-in sessions, history and settings locally.                                                                                                                               |
| `unlimitedStorage`                    | A saved session can include a site's local storage (and IndexedDB when the user enables it), which can exceed the default quota.                                                                                      |
| `cookies`                             | Switching saves the sign-in cookies of a site the user added and restores those of the chosen account. Works only on sites the user granted access to.                                                                |
| `scripting`                           | Reads and replaces the added site's local/session storage (and IndexedDB if enabled) during a save or switch, and shows a "switching" screen and a short confirmation on that site's page.                            |
| `activeTab`                           | Lets the popup offer "Add this site" (and the matching preset) for the tab the user is on.                                                                                                                            |
| `contextMenus`                        | Right-click menu on added sites (switch account, sign in with another account, save this session) and on the toolbar button (switch workspace, open the side panel).                                                  |
| `alarms`                              | Locks the encrypted sessions again after the auto-lock delay the user chose.                                                                                                                                          |
| `favicon`                             | Shows the icons of the user's added sites in the popup and manager.                                                                                                                                                   |
| `declarativeNetRequestWithHostAccess` | While a switch runs, adds a script-blocking Content-Security-Policy to page loads in the single tab doing the swap, on the added site only, so the site's code can't write the old session back. Removed right after. |
| `sidePanel`                           | Shows the same account switcher in Chrome's side panel, so users who switch often can keep it open next to the page. No data access.                                                                                  |
| `tabGroups`                           | “Open workspace” opens the pages the user listed for a workspace and names and colours their tab group after it. No data access.                                                                                      |
| Host permissions (optional)           | Requested per app when the user adds it (e.g. `*://*.supabase.com/*`) — required to read and restore that site's cookies and storage. Never requested at install; released when the app is removed.                   |

**Remote code:** No. All code is packaged with the extension; nothing is downloaded or evaluated.

## Data usage (privacy practices tab)

Recommended answers — re-check against the form's current wording:

- **Data handled:** Authentication information (the sign-in cookies and tokens of sites the user adds) and website
  content limited to the page address and title of those sites (for each account's last page and recent items).
  Workspaces only reference saved accounts. All of it is stored **only on the user's device** and never transmitted.
- Not collected or transmitted: personally identifiable information, health, financial, personal communications,
  location, web history, user activity.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or
  transferred to determine creditworthiness or for lending.

## Pre-submission checklist

- [x] License: MIT (open source). Privacy policy: https://github.com/Tanx-1811/swapdeck/blob/main/docs/PRIVACY.md.
- [ ] Owner decisions: name "Swapdeck", optional support email.
- [x] 1.1 summary adopted in both `_locales` (≤ 132 characters).
- [ ] Version in `package.json` updated; `CHANGELOG.md` entry written.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:e2e` all pass.
- [ ] `npm run package` → `release/swapdeck-<version>.zip` (the script refuses builds with install-time host access).
- [ ] Load the zip's contents unpacked in Chrome stable; add Supabase; save two real accounts; switch both ways; sign in
      with another account; lock/unlock; export and import a backup.
- [ ] Workspaces on real sites: make two workspaces over two or three apps (one tab open, one app closed); switch
      between them from the popup, the side panel and the toolbar button's right-click menu; "Open workspace".
- [ ] `node scripts/verify-presets.mjs` reports no problems.
- [ ] Screenshots (1280 × 800, EN and VI) regenerated with `npm run screenshots` into `brand/store/screenshots/`.
- [ ] Promo tiles and store icon from `brand/store/`.
- [ ] Listing text (EN default + VI), category, single purpose, permission justifications, data usage, privacy URL.
- [ ] Consider an unlisted release first, then public.
