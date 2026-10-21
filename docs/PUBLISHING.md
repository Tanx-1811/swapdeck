# Nộp Swapdeck lên Chrome Web Store — hướng dẫn từng bước

Mọi thứ cần nộp đã có sẵn trong repo. Những việc chỉ chủ sở hữu làm được: đăng ký tài khoản nhà phát triển (phí một
lần), chọn email hỗ trợ, chọn nơi công khai chính sách quyền riêng tư và bấm gửi duyệt.

## 0. Chuẩn bị (đã có sẵn)

| Cần                       | Ở đâu                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Gói tải lên               | `release/swapdeck-<phiên bản>.zip` — tạo lại bằng `npm run package`                           |
| Biểu tượng cửa hàng 128px | `brand/store/store-icon-128.png`                                                              |
| Ảnh chụp 1280×800         | `brand/store/screenshots/vi-1…5-*.png` (tiếng Việt) và `en-1…5-*.png` (tiếng Anh)             |
| Ảnh quảng bá nhỏ 440×280  | `brand/store/promo-small-440x280-vi.png` / `promo-small-440x280.png`                          |
| Ảnh quảng bá lớn 1400×560 | `brand/store/promo-marquee-1400x560-vi.png` / `promo-marquee-1400x560.png`                    |
| Nội dung trang cửa hàng   | `docs/STORE_LISTING.md` (mô tả EN + VI, mục đích duy nhất, giải trình quyền, dữ liệu sử dụng) |
| Chính sách quyền riêng tư | `docs/PRIVACY.md` (EN + VI) — cần một địa chỉ công khai, xem bước 5                           |

Trước mỗi lần nộp, chạy: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e`,
rồi `npm run package`. Nên chạy thêm `npm run test:live` (kiểm tra mọi ứng dụng có sẵn trên trang thật).

## 1. Tài khoản nhà phát triển

1. Mở <https://chrome.google.com/webstore/devconsole> bằng tài khoản Google muốn đứng tên.
2. Đồng ý điều khoản và trả **phí đăng ký 5 USD một lần**.
3. Điền tên nhà phát triển (hiện trên cửa hàng) và **email liên hệ** — email này sẽ công khai. Xác minh email.

## 2. Tải gói lên

1. Bấm **Thêm mục mới** (New item) → chọn `release/swapdeck-1.5.0.zip`.
2. Cửa hàng tự đọc tên, mô tả ngắn (từ `public/_locales/*/messages.json`) và biểu tượng.

## 3. Thẻ "Trang thông tin cửa hàng" (Store listing)

- **Mô tả chi tiết:** dán phần _Detailed description — English_ trong `docs/STORE_LISTING.md`. Thêm bản địa hóa
  **Tiếng Việt** (Add localization → Vietnamese) và dán phần _Detailed description — Tiếng Việt_.
- **Danh mục:** Productivity (Năng suất). **Ngôn ngữ:** English, Vietnamese.
- **Hình ảnh:** biểu tượng 128px, 5 ảnh chụp (bản EN cho tiếng Anh, bản VI cho bản địa hóa tiếng Việt), ảnh quảng bá nhỏ
  và lớn.
- **Trang chủ / hỗ trợ:** `https://github.com/Tanx-1811/swapdeck` và `https://github.com/Tanx-1811/swapdeck/issues`.

## 4. Thẻ "Quyền riêng tư" (Privacy practices)

- **Mục đích duy nhất:** dán phần _Single purpose_.
- **Giải trình từng quyền:** dán từng mục trong _Permission justifications_ (storage, unlimitedStorage, cookies,
  scripting, activeTab, contextMenus, alarms, favicon, declarativeNetRequestWithHostAccess, sidePanel, tabGroups và quyền
  truy cập trang tùy chọn).
- **Dữ liệu sử dụng:** chọn đúng như phần _Data usage_: _Authentication information_ và _Website content_ (chỉ địa chỉ
  và tiêu đề trang của các trang đã thêm), tất cả chỉ lưu trên máy người dùng. Đánh dấu ba cam kết (không bán, không
  dùng ngoài mục đích, không dùng để xét tín dụng).
- **Chính sách quyền riêng tư:** dán địa chỉ công khai ở bước 5.

## 5. Chính sách quyền riêng tư

Repo đã công khai (mã nguồn mở, MIT), nên dùng luôn địa chỉ:
`https://github.com/Tanx-1811/swapdeck/blob/main/docs/PRIVACY.md`. Liên hệ trong chính sách là trang Issues và biểu
mẫu báo lỗ hổng riêng tư của repo; nếu muốn thêm email hỗ trợ, sửa mục cuối của `docs/PRIVACY.md`.

## 6. Phân phối và gửi duyệt

1. Thẻ **Phân phối** (Distribution): nên chọn **Không công khai** (Unlisted) cho lần đầu để tự cài thử từ cửa hàng, sau
   đó chuyển sang **Công khai**. Khu vực: tất cả.
2. Bấm **Gửi để xem xét** (Submit for review). Thời gian duyệt thường vài ngày; tiện ích dùng quyền `cookies` và quyền
   truy cập trang nên có thể lâu hơn.

## 7. Cập nhật về sau

1. Tăng `version` trong `package.json`, ghi `CHANGELOG.md`.
2. Chạy kiểm thử, `npm run screenshots` nếu giao diện đổi, rồi `npm run package`.
3. Trong bảng điều khiển: mục Swapdeck → **Gói** (Package) → **Tải gói mới lên** → gửi duyệt lại.

## GitHub Actions (CI)

Repo công khai nên GitHub Actions chạy miễn phí: mỗi lần đẩy lên `main` và mỗi pull request đều chạy lint, kiểm tra
kiểu, unit test, build, end-to-end + accessibility trên Chrome for Testing, và test của Swapdeck Desktop trên macOS.
Gói tiện ích được tải lên thành artifact `swapdeck-extension` của mỗi lần chạy.
