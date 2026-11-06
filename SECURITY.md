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

### Swapdeck Desktop: terminal tokens

- Token values live only in the login Keychain (service "Swapdeck Desktop CLI", one item per workspace and variable),
  never in the data file, an export, the `.command` script or process arguments. Deleting a workspace deletes all of
  its items; items of workspaces that no longer exist are removed at launch (only when the data file was read).
- The Keychain trusts the app's binary, so the binary's `--env <workspace>` mode guards them: it prints a workspace's
  `export` lines only with a **single-use ticket** from "Open in Terminal" — 32 random bytes, valid 60 seconds and for
  that workspace only, stored under the SHA-256 of the ticket in a 0600 file inside
  `~/Library/Application Support/Swapdeck Desktop/tickets/` (0700), renamed before it is read so it can't be used
  twice — or after **user presence** (LocalAuthentication `deviceOwnerAuthentication`: Touch ID or the Mac's password).
  Refused or unavailable: nothing on stdout, non-zero exit. A value that can't be read fails the whole call.
- Limits: a process running as the same user can still race a ticket during its 60 seconds (the `.command` file and the
  tickets folder are readable by that user) or ask the user for Touch ID. The tickets narrow silent access; they don't
  replace not running untrusted code.

---

**Tiếng Việt:** Đừng báo lỗ hổng bảo mật bằng issue công khai. Hãy dùng biểu mẫu riêng tư của GitHub: tab
**Security** → **Report a vulnerability**, kèm cách tái hiện và phiên bản (không gửi cookie, token, email thật). Bạn sẽ
nhận phản hồi trong vòng 7 ngày.
