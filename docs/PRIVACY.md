# Swapdeck Privacy Policy

_Last updated: 20 October 2026 · Applies to Swapdeck 1.0.0 and later (workspaces, side panel: 1.1.0; important accounts: 1.3.0)_ · [Tiếng Việt](#chính-sách-quyền-riêng-tư-swapdeck)

Swapdeck is a Chrome extension for switching between several accounts on the same website. It works entirely inside
your browser.

## The short version

- Swapdeck **does not collect, sell, share or transmit** any personal or browsing data. There is **no account, no
  server, no analytics and no tracking**.
- What it saves — the sign-in data of the accounts you save, your apps and settings — stays **on your computer**, in the
  extension's own storage (`chrome.storage.local`).
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
| Settings                                                                                                             | Remember your preferences                        | When you change them                                                    |

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
  account you marked important, a red warning strip along the top of the page). Besides that it
  only notes the page address and title (for each account's last page and recent items); it doesn't read page content,
  forms or anything you type.
- To find out which account is signed in, it looks at the saved sign-in data (for example the email inside the site's
  own session record). This never leaves your computer.
- A switch opens pages of the same site in your browser (a static page such as `/robots.txt`, then the page you were
  going to), exactly as if you visited them. When you switch a workspace, its apps that have no open tab are switched in
  a background tab that closes right after. "Open workspace" opens the pages you listed for that workspace.
- Workspace suggestions are made on your computer from the email addresses of your saved accounts; nothing is looked up
  online.

## Network requests

Swapdeck has no server and sends no data anywhere. Apart from the site pages a switch opens, the only requests its own
pages make are for **account pictures** at the address the site itself provides (for example your GitHub avatar),
sent without a referrer.

## Backups

You can export a backup file yourself (apps, accounts, workspaces and settings). If it includes saved sessions, it **must** be encrypted with a password you
choose (AES-256-GCM, key derived with PBKDF2). The file goes only where you save it. Importing a backup never grants
access to any site; you allow each app yourself.

## Permissions

`storage`, `unlimitedStorage` (saved data on this computer), `cookies` (sign-in cookies of added sites), `scripting`
(stored data of added sites, the switching screen and confirmation), `activeTab` (offer "Add this site" for the current
tab), `contextMenus`, `alarms`, `favicon` (right-click menu, auto-lock, site icons), `declarativeNetRequestWithHostAccess`
(pauses the site's own scripts in the one tab doing a switch, during the switch), `sidePanel` (shows Swapdeck in Chrome's
side panel), `tabGroups` (puts a workspace's pages in one named tab group) — these two give no access to any data — and
optional access to the sites you add. Swapdeck doesn't run in incognito windows.

## Changes and contact

Changes to this policy are listed here with a new date. Swapdeck is open source (MIT): the code that does all of the above is at <https://github.com/Tanx-1811/swapdeck>. Questions: [open an issue](https://github.com/Tanx-1811/swapdeck/issues); security problems: [report privately](https://github.com/Tanx-1811/swapdeck/security/advisories/new).

---

# Chính sách quyền riêng tư Swapdeck

_Cập nhật: 20/10/2026 · Áp dụng cho Swapdeck 1.0.0 trở lên (các bên, bảng bên: 1.1.0; tài khoản quan trọng: 1.3.0)_

Swapdeck là tiện ích Chrome giúp chuyển giữa nhiều tài khoản trên cùng một trang web. Tiện ích hoạt động hoàn toàn
trong trình duyệt của bạn.

## Tóm tắt

- Swapdeck **không thu thập, bán, chia sẻ hay gửi đi** bất kỳ dữ liệu cá nhân hay dữ liệu duyệt web nào. **Không tài
  khoản, không máy chủ, không thống kê, không theo dõi.**
- Những gì được lưu — dữ liệu đăng nhập của các tài khoản bạn lưu, ứng dụng và cài đặt — nằm **trên máy của bạn**,
  trong bộ nhớ riêng của tiện ích (`chrome.storage.local`).
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
| Cài đặt                                                                                                              | Ghi nhớ lựa chọn của bạn                             | Khi bạn thay đổi                                                 |

Khi Chrome đang mở, tiện ích còn giữ trong bộ nhớ (`chrome.storage.session`, tự xóa khi đóng Chrome) ai đang đăng nhập
ở mỗi ứng dụng, tiến độ của lần đổi bên đang chạy và, khi đã mở khóa, khóa dùng để giải mã các phiên đã lưu.

**Phiên đã lưu là dữ liệu nhạy cảm:** ai dùng được hồ sơ Chrome của bạn cũng có thể đăng nhập bằng chúng. Hãy bật **khóa
bằng mật khẩu** (mục Bảo mật) để mã hóa (RSA-OAEP và AES-256-GCM, khóa sinh từ mật khẩu bằng PBKDF2). Mật khẩu không bao
giờ được lưu; nếu quên, không thể khôi phục các phiên đã mã hóa.

Mọi dữ liệu bị xóa khi gỡ tiện ích, hoặc bằng **Bảo mật → Xóa toàn bộ dữ liệu Swapdeck**.

## Swapdeck làm gì trên các trang web

- Chỉ trên **các trang bạn đã thêm**, và chỉ để lưu hoặc khôi phục đăng nhập: đọc và thay cookie cùng dữ liệu lưu trữ
  của địa chỉ chính, hiện màn hình "đang chuyển" và một thông báo nhỏ trên trang (với tài khoản bạn đánh dấu quan trọng:
  thêm một dải cảnh báo đỏ ở mép trên trang). Ngoài ra chỉ ghi nhận địa chỉ và tiêu
  đề trang (cho trang cuối và mục gần đây của mỗi tài khoản); không đọc nội dung trang, biểu mẫu hay những gì bạn gõ.
- Để biết tài khoản nào đang đăng nhập, tiện ích xem dữ liệu đăng nhập đã lưu (vd. email trong bản ghi phiên của chính
  trang). Thông tin này không rời khỏi máy bạn.
- Mỗi lần chuyển sẽ mở các trang của chính trang web đó trong trình duyệt (một trang tĩnh như `/robots.txt`, rồi trang
  bạn cần), giống như bạn tự truy cập. Khi đổi một bên, các ứng dụng của bên đó không có tab nào đang mở sẽ được đổi
  trong một tab chạy nền, đóng ngay sau đó. "Mở bên" mở các trang bạn đã liệt kê cho bên đó.
- Gợi ý tạo bên được tính ngay trên máy bạn từ địa chỉ email của các tài khoản đã lưu; không tra cứu gì trên mạng.

## Kết nối mạng

Swapdeck không có máy chủ và không gửi dữ liệu đi đâu. Ngoài các trang web được mở khi chuyển, các trang của tiện ích
chỉ tải **ảnh đại diện tài khoản** từ địa chỉ do chính trang web cung cấp (vd. ảnh GitHub của bạn), không kèm thông tin
trang giới thiệu (referrer).

## Sao lưu

Bạn có thể tự xuất tệp sao lưu (ứng dụng, tài khoản, các bên và cài đặt). Nếu tệp kèm các phiên đã lưu, tệp **bắt buộc** được mã hóa bằng mật khẩu bạn chọn
(AES-256-GCM, khóa sinh bằng PBKDF2). Tệp chỉ nằm ở nơi bạn lưu. Nhập bản sao lưu không tự cấp quyền cho trang nào; bạn
tự cho phép từng ứng dụng.

## Quyền

`storage`, `unlimitedStorage` (dữ liệu lưu trên máy), `cookies` (cookie đăng nhập của trang đã thêm), `scripting` (dữ
liệu lưu trữ của trang đã thêm, màn hình chuyển và thông báo), `activeTab` (đề xuất "Thêm trang này" cho tab hiện tại),
`contextMenus`, `alarms`, `favicon` (menu chuột phải, tự khóa, biểu tượng trang), `declarativeNetRequestWithHostAccess`
(tạm dừng script của trang trong đúng tab đang chuyển, trong lúc chuyển), `sidePanel` (hiện Swapdeck ở bảng bên của
Chrome), `tabGroups` (gom các trang của một bên vào một nhóm tab có tên) — hai quyền này không truy cập dữ liệu nào — và
quyền tùy chọn trên các trang bạn thêm. Swapdeck không chạy trong cửa sổ ẩn danh.

## Thay đổi và liên hệ

Mọi thay đổi chính sách sẽ được ghi tại đây kèm ngày mới. Swapdeck là mã nguồn mở (MIT): toàn bộ mã thực hiện những điều trên nằm ở <https://github.com/Tanx-1811/swapdeck>. Câu hỏi: [tạo issue](https://github.com/Tanx-1811/swapdeck/issues); lỗ hổng bảo mật: [báo riêng tư](https://github.com/Tanx-1811/swapdeck/security/advisories/new).
