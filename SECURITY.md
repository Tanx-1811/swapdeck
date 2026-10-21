# Security policy

Swapdeck handles sign-in data: the extension saves and restores sessions (cookies and site storage), optionally
encrypted with a passphrase; Swapdeck Desktop opens browser profiles and scripts browser windows. Please report
anything that could expose a session, weaken the passphrase lock or backups, let a page or another extension drive
Swapdeck, or make the desktop app run something it shouldn't.

## Reporting a vulnerability

**Don't open a public issue.** Use GitHub's private form: the repository's **Security** tab → **Report a
vulnerability**. Include what you found, how to reproduce it, the version (extension: manager → Help; desktop:
Settings) and your browser and OS. Leave real cookies, tokens and emails out — a made-up example is enough.

You'll get an answer within 7 days. Fixes are released as soon as they are ready, and you'll be credited in the
release notes unless you prefer otherwise.

## Supported versions

The latest release of the extension and of Swapdeck Desktop.

## Design notes

How sessions are swapped, stored and locked, and what each permission is for: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
and [`docs/PRIVACY.md`](docs/PRIVACY.md). The desktop app never reads or copies sign-ins: see
[`desktop/README.md`](desktop/README.md).

---

**Tiếng Việt:** Đừng báo lỗ hổng bảo mật bằng issue công khai. Hãy dùng biểu mẫu riêng tư của GitHub: tab
**Security** → **Report a vulnerability**, kèm cách tái hiện và phiên bản (không gửi cookie, token, email thật). Bạn sẽ
nhận phản hồi trong vòng 7 ngày.
