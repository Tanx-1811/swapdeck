# Contributing to Swapdeck

Thanks for helping! Swapdeck is a community project under the [MIT License](LICENSE): a Chrome extension that switches
between accounts on the same site (`/`), and Swapdeck Desktop, a macOS menu bar app that keeps each workspace in its
own browser profile (`desktop/`). _Tiếng Việt ở cuối trang._

## Ways to help

- **Report a problem** or **suggest an idea**: [open an issue](https://github.com/Tanx-1811/swapdeck/issues/new/choose).
  Remove emails, tokens and cookies from anything you paste.
- **Ask for a site** that should be built in (a "preset"): use the _Request a site_ form.
- **Improve the words**: every UI string lives in `src/i18n/en.ts` and `src/i18n/vi.ts` (extension) and
  `desktop/Sources/SwapdeckCore/L10n.swift` (desktop). Both languages must define every key — the tests check it.
- **Send code**: fork, branch, open a pull request. Small, focused pull requests are reviewed fastest.

Security problems are not reported in public issues: see [SECURITY.md](SECURITY.md).

## Set up

Extension (Node 24):

```sh
npm ci
npm run dev                         # rebuilds dist/ on change; load it with chrome://extensions → Load unpacked
npx playwright install chromium     # once, for end-to-end tests
```

Desktop app (macOS 14+, Xcode 16+ / Swift 6):

```sh
cd desktop
swift test
./scripts/build-app.sh              # build/Swapdeck Desktop.app
```

## Before you open a pull request

```sh
npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e
cd desktop && swift test            # when desktop/ changed
```

- Describe the change from the user's side; add screenshots for UI changes (`npm run screenshots`, or
  `--render-previews <folder>` on the desktop binary).
- Add a line to `CHANGELOG.md` under the next version.
- Update the docs your change touches (README, `docs/ARCHITECTURE.md`, `desktop/README.md`).

## How the code is organised

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching switching, storage, the vault or messaging. The
rules that matter most:

- **The service worker is the only writer** of state; pages send requests. Never nest `update()`/`exclusive()`.
- **Saving is identity-checked**: a session is never written into an account whose identity differs.
- **Data from storage, backups or pages is untrusted**: validate it (`src/core/validate.ts`).
- **Page scripts** (`src/background/page-scripts.ts`) are serialized by Chrome: keep them self-contained.
- **Presets** (`src/core/presets.ts`) must not share or nest domains and must not use Google, Microsoft or Apple
  domains. Check a new one against the live site: `node scripts/verify-presets.mjs <id>`.
- **New permission?** Update `src/manifest.ts`, `docs/PRIVACY.md`, `docs/STORE_LISTING.md` and the permissions table
  in `docs/ARCHITECTURE.md`.
- **Design**: use the tokens in `src/styles/ui.css` (and `desktop/Sources/SwapdeckDesktop/Theme.swift`); the
  accessibility tests (axe, WCAG AA, light and dark, every accent) must stay green.
- **Desktop**: only validated web addresses and profile folder names reach the command line, and AppleScript strings
  go through `BrowserScript.literal`. The app never reads or copies sign-ins.

By contributing you agree that your contribution is licensed under the MIT License.

---

## Đóng góp (tiếng Việt)

Cảm ơn bạn! Swapdeck là dự án cộng đồng, giấy phép MIT.

- **Báo lỗi, góp ý, đề xuất trang mới**: [tạo issue](https://github.com/Tanx-1811/swapdeck/issues/new/choose) theo mẫu.
  Xoá email, token, cookie khỏi mọi thứ bạn dán vào.
- **Lỗ hổng bảo mật**: không đăng công khai — xem [SECURITY.md](SECURITY.md).
- **Dịch / sửa câu chữ**: `src/i18n/vi.ts` và `en.ts` (tiện ích), `desktop/Sources/SwapdeckCore/L10n.swift` (desktop).
- **Gửi mã**: fork → nhánh mới → pull request. Trước khi gửi, chạy
  `npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e` (và `swift test` trong
  `desktop/` nếu có sửa app desktop). Đọc [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) trước khi sửa phần chuyển tài
  khoản, lưu trữ, khoá mật khẩu hay nhắn tin giữa các phần.
