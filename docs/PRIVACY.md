# Swapdeck Privacy Policy

_Last updated: 21 October 2026 · Applies to Swapdeck 1.0.0 and later (workspaces, side panel: 1.1.0; important accounts: 1.3.0; unsaved-work check: 1.4.0; optional sync of the list: 1.5.0)_ · [Tiếng Việt](#chính-sách-quyền-riêng-tư-swapdeck)

Swapdeck is a Chrome extension for switching between several accounts on the same website. It works entirely inside
your browser.

## The short version

- Swapdeck **does not collect, sell, share or transmit** any personal or browsing data. There is **no account, no
  server, no analytics and no tracking**.
- What it saves — the sign-in data of the accounts you save, your apps and settings — stays **on your computer**, in the
  extension's own storage (`chrome.storage.local`).
- **Only if you turn it on** (Settings → Sync the list; off by default), the _list_ — apps, accounts and workspaces,
  without any sign-in — is copied to your other computers through **your own Google account's Chrome Sync**. Saved
  sessions, cookies and tokens never leave your computer. [Details](#sync-of-the-list-optional).
- At install, Swapdeck has **no access to any website**. When you add an app, it asks for access to **that app's
  domains only** (for example `supabase.com` and its subdomains), and gives the access back when you remove the app.

## What is stored on your device

| Data                                                                                                                 | Purpose                                          | When                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Apps you added (name, colour, domains, addresses, settings)                                                          | Know which sites to manage                       | When you add or edit an app                                             |
| Accounts (name you give, colour, icon, note, the email/name/user id the site shows, picture address, start page)     | Show and recognise your accounts                 | When an account is saved; edit or delete it any time                    |
| **Saved sessions**: the site's cookies and its stored data (local storage; session storage and IndexedDB if enabled) | Restore the account when you switch to it        | When you save, switch away from an account, or while you use it (fresh) |
| The session each saved one replaced                                                                                  | Undo a save ("restore the session saved before") | Replaced at the next save                                               |
| The last page, recent items (e.g. Supabase project names) and pinned pages per account                               | Open each account where you need it              | While you use an account on an added site; clear them any time          |
| History of the last 200 switches and saves (time, app, account names, result)                                        | Show what happened                               | On each switch or save; clear it in History                             |
| **Workspaces** (name, colour, icon, note, which saved account each app uses, the pages you listed)                   | Switch every app to a client's accounts at once  | When you create or edit a workspace; delete it any time                 |
| Settings, and when you last made a backup                                                                            | Remember your preferences; remind you to back up | When you change them or export a backup                                 |
| For sync of the list: an id for this installation, what was last synced, the ids of things you removed (180 days)    | Sync without copying or losing things            | While sync is on; removals are noted even while it is off               |

While Chrome is open, the extension also keeps in memory (`chrome.storage.session`, erased when Chrome closes) who was
last seen signed in on each app, the progress of a workspace switch while it runs and, while unlocked, the key that
decrypts saved sessions.

**Saved sessions are sensitive:** anyone who can use your Chrome profile could sign in with them. Turn on the
**passphrase lock** (Security) to encrypt them (RSA-OAEP and AES-256-GCM, with a key derived from your passphrase by
PBKDF2). The passphrase is never stored; if you forget it, the encrypted sessions can't be recovered.

Everything is removed when you uninstall the extension, or with **Security → Delete all Swapdeck data**.

## What Swapdeck does on websites

- Only on **sites you added**, and only to save or restore their sign-in: it reads and replaces their cookies and the
  stored data of their main address, shows a "switching" screen and a small confirmation on the page (and, for an
  account you marked important, a red warning strip along the top of the page). Before a switch reloads the site's
  tabs, it checks them for unsaved work (an edited form, text being typed, the page's own "leave site?" warning) and
  only learns yes or no; and a switch started by a shortcut can ask on the page. Besides that it
  only notes the page address and title (for each account's last page and recent items); it doesn't read page content,
  forms or anything you type.
- To find out which account is signed in, it looks at the saved sign-in data (for example the email inside the site's
  own session record). The sign-in data never leaves your computer; with sync of the list on, the email/name/user id found there goes along with the account.
- A switch opens pages of the same site in your browser (a static page such as `/robots.txt`, then the page you were
  going to), exactly as if you visited them. When you switch a workspace, its apps that have no open tab are switched in
  a background tab that closes right after. "Open workspace" opens the pages you listed for that workspace.
- Workspace suggestions are made on your computer from the email addresses of your saved accounts; nothing is looked up
  online.

## Network requests

Swapdeck has no server and sends no data anywhere (sync of the list, when you turn it on, goes through Chrome's own sync,
above). Apart from the site pages a switch opens, the only requests its own pages make are for **account pictures** at the address the site itself provides (for example your GitHub avatar),
sent without a referrer.

## Sync of the list (optional)

Off by default. When you turn on **Settings → Sync the list**, Swapdeck writes the list to `chrome.storage.sync`, which
Chrome keeps in step across the computers signed in to the same Chrome profile — through your Google account, under
[Google's privacy policy](https://policies.google.com/privacy). Swapdeck itself still has no server and receives
nothing.

- **What travels:** the apps you added (for a built-in site, just its name; for your own sites, the addresses and
  settings), accounts (the name, colour, icon and note you gave, the email/name/user id the site shows, start page,
  pinned pages, the "important" flag) and workspaces (name, colour, icon, note, members, pages).
- **What never travels:** saved sessions — cookies, local and session storage, IndexedDB, tokens — and anything else
  that signs you in, the passphrase lock, history, recent items, last pages, statistics and settings. On another
  computer you sign in to each account once; Swapdeck files the sign-in under the right account.
- What you remove on one computer is removed on the others (including the sign-in saved there). Something that only
  went missing on one computer (lost data) is not removed elsewhere; it comes back from Chrome Sync.
- Chrome Sync must be on for the profile, with Extensions included. Google encrypts synced data; set a **sync
  passphrase** in Chrome if only you should be able to read it.
- **Settings → Remove from Chrome Sync** turns sync off on this computer and deletes the list from Chrome Sync; nothing
  is deleted on any computer (another computer that still syncs sends its list again).

## Backups

You can export a backup file yourself (apps, accounts, workspaces and settings). If it includes saved sessions, it **must** be encrypted with a password you
choose (AES-256-GCM, key derived with PBKDF2). The file goes only where you save it. Importing a backup never grants
access to any site; you allow each app yourself.

## Permissions

`storage`, `unlimitedStorage` (saved data on this computer and, if you turn it on, sync of the list), `cookies` (sign-in cookies of added sites), `scripting`
(stored data of added sites, the switching screen and confirmation), `activeTab` (offer "Add this site" for the current
tab), `contextMenus`, `alarms`, `favicon` (right-click menu, auto-lock, site icons), `declarativeNetRequestWithHostAccess`
(pauses the site's own scripts in the one tab doing a switch, during the switch), `sidePanel` (shows Swapdeck in Chrome's
side panel), `tabGroups` (puts a workspace's pages in one named tab group) — these two give no access to any data — and
optional access to the sites you add. Swapdeck doesn't run in incognito windows.

## Changes and contact

Changes to this policy are listed here with a new date. Swapdeck is open source (MIT): the code that does all of the above is at <https://github.com/Tanx-1811/swapdeck>. Questions: [open an issue](https://github.com/Tanx-1811/swapdeck/issues); security problems: [report privately](https://github.com/Tanx-1811/swapdeck/security/advisories/new).

---

# Chính sách quyền riêng tư Swapdeck

_Cập nhật: 21/10/2026 · Áp dụng cho Swapdeck 1.0.0 trở lên (các bên, bảng bên: 1.1.0; tài khoản quan trọng: 1.3.0; kiểm tra nội dung chưa lưu: 1.4.0; đồng bộ danh sách tùy chọn: 1.5.0)_

Swapdeck là tiện ích Chrome giúp chuyển giữa nhiều tài khoản trên cùng một trang web. Tiện ích hoạt động hoàn toàn
trong trình duyệt của bạn.

## Tóm tắt

- Swapdeck **không thu thập, bán, chia sẻ hay gửi đi** bất kỳ dữ liệu cá nhân hay dữ liệu duyệt web nào. **Không tài
  khoản, không máy chủ, không thống kê, không theo dõi.**
- Những gì được lưu — dữ liệu đăng nhập của các tài khoản bạn lưu, ứng dụng và cài đặt — nằm **trên máy của bạn**,
  trong bộ nhớ riêng của tiện ích (`chrome.storage.local`).
- **Chỉ khi bạn bật** (Cài đặt → Đồng bộ danh sách; mặc định tắt), _danh sách_ — ứng dụng, tài khoản và các bên, không
  kèm đăng nhập nào — được chép sang các máy khác của bạn qua **Chrome Sync của chính tài khoản Google bạn**. Phiên đã
  lưu, cookie và token không bao giờ rời máy bạn. [Chi tiết](#đồng-bộ-danh-sách-tùy-chọn).
- Khi cài, Swapdeck **không có quyền trên trang web nào**. Khi bạn thêm một ứng dụng, tiện ích chỉ xin quyền **đúng
  tên miền của ứng dụng đó** (vd. `supabase.com` và tên miền con), và trả lại quyền khi bạn gỡ ứng dụng.

## Dữ liệu lưu trên máy bạn

| Dữ liệu                                                                                                              | Mục đích                                             | Khi nào                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Ứng dụng bạn thêm (tên, màu, tên miền, địa chỉ, cài đặt)                                                             | Biết cần quản lý trang nào                           | Khi bạn thêm hoặc sửa ứng dụng                                   |
| Tài khoản (tên bạn đặt, màu, biểu tượng, ghi chú, email/tên/mã người dùng trang hiển thị, địa chỉ ảnh, trang mở đầu) | Hiển thị và nhận ra tài khoản                        | Khi lưu tài khoản; sửa hoặc xóa bất cứ lúc nào                   |
| **Phiên đã lưu**: cookie và dữ liệu lưu trữ của trang (localStorage; sessionStorage và IndexedDB nếu bật)            | Khôi phục tài khoản khi bạn chuyển sang              | Khi lưu, khi chuyển khỏi tài khoản, hoặc khi đang dùng (làm mới) |
| Phiên mà bản lưu hiện tại đã thay thế                                                                                | Hoàn tác một lần lưu                                 | Bị thay ở lần lưu sau                                            |
| Trang cuối, mục gần đây (vd. tên dự án Supabase) và trang đã ghim của từng tài khoản                                 | Mở mỗi tài khoản đúng chỗ bạn cần                    | Khi bạn dùng tài khoản trên trang đã thêm; xóa bất cứ lúc nào    |
| Lịch sử 200 lần chuyển và lưu gần nhất (thời gian, ứng dụng, tên tài khoản, kết quả)                                 | Cho biết điều gì đã xảy ra                           | Mỗi lần chuyển hoặc lưu; xóa trong mục Lịch sử                   |
| **Các bên** (tên, màu, biểu tượng, ghi chú, tài khoản đã lưu mà mỗi ứng dụng dùng, các trang bạn liệt kê)            | Đổi mọi ứng dụng sang tài khoản của một bên cùng lúc | Khi bạn tạo hoặc sửa một bên; xóa bất cứ lúc nào                 |
| Cài đặt, và lần sao lưu gần nhất                                                                                     | Ghi nhớ lựa chọn; nhắc bạn sao lưu                   | Khi bạn thay đổi hoặc xuất bản sao lưu                           |
| Cho đồng bộ danh sách: mã của bản cài này, những gì đã đồng bộ lần cuối, mã của những thứ bạn đã xóa (180 ngày)      | Đồng bộ mà không chép trùng hay làm mất              | Khi bật đồng bộ; việc xóa vẫn được ghi lại khi đang tắt          |

Khi Chrome đang mở, tiện ích còn giữ trong bộ nhớ (`chrome.storage.session`, tự xóa khi đóng Chrome) ai đang đăng nhập
ở mỗi ứng dụng, tiến độ của lần đổi bên đang chạy và, khi đã mở khóa, khóa dùng để giải mã các phiên đã lưu.

**Phiên đã lưu là dữ liệu nhạy cảm:** ai dùng được hồ sơ Chrome của bạn cũng có thể đăng nhập bằng chúng. Hãy bật **khóa
bằng mật khẩu** (mục Bảo mật) để mã hóa (RSA-OAEP và AES-256-GCM, khóa sinh từ mật khẩu bằng PBKDF2). Mật khẩu không bao
giờ được lưu; nếu quên, không thể khôi phục các phiên đã mã hóa.

Mọi dữ liệu bị xóa khi gỡ tiện ích, hoặc bằng **Bảo mật → Xóa toàn bộ dữ liệu Swapdeck**.

## Swapdeck làm gì trên các trang web

- Chỉ trên **các trang bạn đã thêm**, và chỉ để lưu hoặc khôi phục đăng nhập: đọc và thay cookie cùng dữ liệu lưu trữ
  của địa chỉ chính, hiện màn hình "đang chuyển" và một thông báo nhỏ trên trang (với tài khoản bạn đánh dấu quan trọng:
  thêm một dải cảnh báo đỏ ở mép trên trang). Trước khi đổi tài khoản làm tải lại các tab của trang, tiện ích kiểm tra
  xem có nội dung chưa lưu không (biểu mẫu đã sửa, chữ đang gõ, cảnh báo "rời trang?" của chính trang) và chỉ biết có
  hay không; khi đổi bằng phím tắt, tiện ích có thể hỏi ngay trên trang. Ngoài ra chỉ ghi nhận địa chỉ và tiêu
  đề trang (cho trang cuối và mục gần đây của mỗi tài khoản); không đọc nội dung trang, biểu mẫu hay những gì bạn gõ.
- Để biết tài khoản nào đang đăng nhập, tiện ích xem dữ liệu đăng nhập đã lưu (vd. email trong bản ghi phiên của chính
  trang). Dữ liệu đăng nhập không bao giờ rời máy bạn; khi bật đồng bộ danh sách, email/tên/mã người dùng tìm được sẽ đi cùng tài khoản.
- Mỗi lần chuyển sẽ mở các trang của chính trang web đó trong trình duyệt (một trang tĩnh như `/robots.txt`, rồi trang
  bạn cần), giống như bạn tự truy cập. Khi đổi một bên, các ứng dụng của bên đó không có tab nào đang mở sẽ được đổi
  trong một tab chạy nền, đóng ngay sau đó. "Mở bên" mở các trang bạn đã liệt kê cho bên đó.
- Gợi ý tạo bên được tính ngay trên máy bạn từ địa chỉ email của các tài khoản đã lưu; không tra cứu gì trên mạng.

## Kết nối mạng

Swapdeck không có máy chủ và không gửi dữ liệu đi đâu (đồng bộ danh sách, khi bạn bật, đi qua tính năng đồng bộ của
chính Chrome, xem trên). Ngoài các trang web được mở khi chuyển, các trang của tiện ích
chỉ tải **ảnh đại diện tài khoản** từ địa chỉ do chính trang web cung cấp (vd. ảnh GitHub của bạn), không kèm thông tin
trang giới thiệu (referrer).

## Đồng bộ danh sách (tùy chọn)

Mặc định tắt. Khi bạn bật **Cài đặt → Đồng bộ danh sách**, Swapdeck ghi danh sách vào `chrome.storage.sync`, nơi Chrome
giữ cho giống nhau trên các máy đăng nhập cùng hồ sơ Chrome — qua tài khoản Google của bạn, theo
[chính sách quyền riêng tư của Google](https://policies.google.com/privacy). Bản thân Swapdeck vẫn không có máy chủ và
không nhận gì.

- **Được gửi đi:** các ứng dụng bạn thêm (với trang có sẵn chỉ là tên; với trang tự thêm là địa chỉ và cài đặt), tài
  khoản (tên, màu, biểu tượng và ghi chú bạn đặt, email/tên/mã người dùng trang hiển thị, trang mở đầu, trang đã ghim,
  dấu "quan trọng") và các bên (tên, màu, biểu tượng, ghi chú, thành viên, các trang).
- **Không bao giờ gửi đi:** phiên đã lưu — cookie, localStorage, sessionStorage, IndexedDB, token — hay bất cứ thứ gì
  giúp đăng nhập, khóa bằng mật khẩu, lịch sử, mục gần đây, trang cuối, thống kê và cài đặt. Ở máy khác, bạn đăng nhập
  mỗi tài khoản một lần; Swapdeck lưu phiên vào đúng tài khoản.
- Thứ bạn xóa ở một máy sẽ bị xóa ở các máy kia (kể cả phiên đã lưu ở đó). Thứ chỉ bị mất ở một máy (mất dữ liệu) thì
  không bị xóa ở máy khác; nó được lấy lại từ Chrome Sync.
- Cần bật Chrome Sync cho hồ sơ, có mục Tiện ích. Google mã hóa dữ liệu đồng bộ; muốn chỉ mình bạn đọc được thì đặt
  **cụm mật khẩu đồng bộ** trong Chrome.
- **Cài đặt → Xóa khỏi Chrome Sync** tắt đồng bộ ở máy này và xóa danh sách khỏi Chrome Sync; không máy nào bị xóa dữ
  liệu (máy khác còn bật đồng bộ sẽ gửi lại danh sách của nó).

## Sao lưu

Bạn có thể tự xuất tệp sao lưu (ứng dụng, tài khoản, các bên và cài đặt). Nếu tệp kèm các phiên đã lưu, tệp **bắt buộc** được mã hóa bằng mật khẩu bạn chọn
(AES-256-GCM, khóa sinh bằng PBKDF2). Tệp chỉ nằm ở nơi bạn lưu. Nhập bản sao lưu không tự cấp quyền cho trang nào; bạn
tự cho phép từng ứng dụng.

## Quyền

`storage`, `unlimitedStorage` (dữ liệu lưu trên máy và, nếu bạn bật, đồng bộ danh sách), `cookies` (cookie đăng nhập của trang đã thêm), `scripting` (dữ
liệu lưu trữ của trang đã thêm, màn hình chuyển và thông báo), `activeTab` (đề xuất "Thêm trang này" cho tab hiện tại),
`contextMenus`, `alarms`, `favicon` (menu chuột phải, tự khóa, biểu tượng trang), `declarativeNetRequestWithHostAccess`
(tạm dừng script của trang trong đúng tab đang chuyển, trong lúc chuyển), `sidePanel` (hiện Swapdeck ở bảng bên của
Chrome), `tabGroups` (gom các trang của một bên vào một nhóm tab có tên) — hai quyền này không truy cập dữ liệu nào — và
quyền tùy chọn trên các trang bạn thêm. Swapdeck không chạy trong cửa sổ ẩn danh.

## Thay đổi và liên hệ

Mọi thay đổi chính sách sẽ được ghi tại đây kèm ngày mới. Swapdeck là mã nguồn mở (MIT): toàn bộ mã thực hiện những điều trên nằm ở <https://github.com/Tanx-1811/swapdeck>. Câu hỏi: [tạo issue](https://github.com/Tanx-1811/swapdeck/issues); lỗ hổng bảo mật: [báo riêng tư](https://github.com/Tanx-1811/swapdeck/security/advisories/new).
