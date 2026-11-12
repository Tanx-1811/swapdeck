# Swapdeck brand kit

Swapdeck switches between several accounts on the same site in one click. The identity is **flat and quiet**: cool grey surfaces, one ink, one **iris** accent. The brand idea is a **deck of account cards — the account in use in front**.

Everything here is generated from `brand/templates/` and `assets/` by one command (see [Regenerating](#regenerating)). Edit the templates rather than the PNGs.

## Principles

- **Flat.** Solid colours only: no gradients, no sheen, no grain or paper texture.
- **No coloured edge strips.** No border-top or border-left accents, no bars along a page edge. State is shown with a tinted background, a soft accent ring, a dot or a label.
- **One accent.** Iris marks what is in use and the main action; everything else is ink and grey. Red is only for danger and important accounts.
- **Quiet depth.** Hairline borders first; shadows are soft and rare (raised menus, promo cards).

## Assets

| File                                                   | Size            | Use it for                                                             |
| ------------------------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| `logo/mark.svg`                                        | vector          | The mark on its own: favicons, avatars, app icons                      |
| `logo/mark-512.png`, `logo/mark-1024.png`              | 512², 1024²     | Raster mark (transparent corners)                                      |
| `logo/mark-mono-white.svg`, `logo/mark-mono-black.svg` | vector          | Single-colour mark for coloured, busy or photo backgrounds, print      |
| `logo/lockup-horizontal-light.svg` / `@2x.png`         | vector / 1200 w | Primary logo on light backgrounds                                      |
| `logo/lockup-horizontal-dark.svg` / `@2x.png`          | vector / 1200 w | Logo on dark UI surfaces (`#0E0F15`)                                   |
| `logo/lockup-horizontal-on-night.svg` / `@2x.png`      | vector / 1200 w | Logo on the deep-ink promo background (`#16152B`)                      |
| `store/store-icon-128.png`                             | 128²            | Chrome Web Store icon: 96 × 96 artwork with 16 px transparent padding  |
| `store/promo-small-440x280.png` (+ `-vi`)              | 440 × 280       | Chrome Web Store small promo tile (English / Vietnamese listing)       |
| `store/promo-marquee-1400x560.png` (+ `-vi`)           | 1400 × 560      | Chrome Web Store marquee promo tile (English / Vietnamese listing)     |
| `social/github-social-1280x640.png`                    | 1280 × 640      | GitHub repository social preview (Settings → General → Social preview) |
| `social/readme-banner-1600x500.png`                    | 1600 × 500      | README header image (rounded, transparent corners)                     |

Promo tiles and the social preview are 24-bit PNGs without alpha, as the Chrome Web Store requires. Store screenshots (1280 × 800, `store/screenshots/`) are captured from the real extension with `npm run screenshots`, not drawn.

## Logo

**The mark** is a flat iris tile (`#5046E5`, corner radius 28 of 128) holding a deck of three account cards, stepped up and to the right:

- two cards behind in tints of iris (`#8A84F0`, `#BDB9F7`) — the other saved accounts;
- the white card in front with a person cut out of it — the account in use;
- thin tile-coloured gaps (4 of 128) keep the cards apart.

The toolbar sizes (16 and 32 px) use `assets/icon-small.svg`: the same deck drawn on the 16-pixel grid. 48 and 128 px use `assets/icon.svg`, which is identical to `logo/mark.svg`. The geometry also lives in `markShapes()` in `brand/templates/shared.mjs`, in `src/ui/Logo.tsx` and in `MarkView` / `MenuBarIcon` of the desktop app, so change all of them together.

**The mono marks** are a single colour with no tints: the three cards are cut out of the tile and separated by gaps; the person stays in the tile colour.

**The lockup** pairs the mark with the wordmark _Swapdeck_ in Be Vietnam Pro Bold (700, tracking −3 %), converted to outlines, in one colour: ink `#10121F` on light backgrounds, `#ECEDF5` on dark ones, `#F2F1FF` on the night background.

- **Clear space:** at least ¼ of the mark's height on every side.
- **Minimum size:** mark 16 px; lockup 24 px tall on screen. Below that, use the mark alone.
- **Name:** always _Swapdeck_, one word with a capital S. The store name adds the descriptor: _Swapdeck — Multi-Account Switcher_.
- Don't recolour, stretch or re-letter the wordmark, add gradients, shadows or outlines to the mark, or put the full-colour mark on iris or busy backgrounds (use a mono mark there).
- Third-party sites appear only as names on plain letter tiles — never their logos — and their colours (Supabase green, …) are never Swapdeck brand colours.

## Colours

| Group         | Token             | Value                                      | Use                                                    |
| ------------- | ----------------- | ------------------------------------------ | ------------------------------------------------------ |
| Light         | Background        | `#F6F7FB`                                  | Page background                                        |
|               | Surface           | `#FFFFFF`                                  | Cards, raised surfaces                                 |
|               | Sunken            | `#EEF0F6`                                  | Wells, inputs, chips                                   |
|               | Hairline / strong | `#E3E5EE` / `#CACEDC`                      | Borders                                                |
|               | Ink / 2 / 3       | `#10121F` / `#474D63` / `#5F657B`          | Text: primary, secondary, meta                         |
| Dark          | Background        | `#0E0F15`                                  | Page background                                        |
|               | Surface           | `#171821`                                  | Cards and panels                                       |
|               | Line              | `#262835`                                  | Borders on dark                                        |
|               | Text / 2 / 3      | `#ECEDF5` / `#A9AEC2` / `#8B90A6`          | Text on dark                                           |
| Night (frame) | Deep ink          | `#16152B` (`#0A0A12` in dark mode)         | Popup header, manager sidebar, promo backgrounds       |
|               | On night / 2      | `#F2F1FF` / `#A9A6CC`                      | Text on the frame                                      |
| Accent        | Iris              | `#5046E5` (text `#4338CA`, soft `#EEEDFE`) | What is in use, the main action, focus. `#8C87FF` dark |
| Status        | Success / warning | `#047857` / `#A04D0A`                      | Results, cautions                                      |
|               | Danger            | `#B42318`                                  | Deleting, important accounts                           |
|               | Info              | `#1D4ED8`                                  | Separate tabs, hints                                   |

Settings offers three other accents (blue `#2563EB`, jade `#0F7A5F`, amber `#A15C07`); every pair of text and background meets WCAG AA (4.5 : 1), checked by `tests/e2e/a11y.spec.ts`.

## Type

| Face           | Weights  | Use                                            |
| -------------- | -------- | ---------------------------------------------- |
| Be Vietnam Pro | 400–700  | Everything: text, labels, titles, the wordmark |
| JetBrains Mono | 400, 500 | Meta: emails, hosts, counts                    |

Both cover Vietnamese (test with “Đổi tài khoản chỉ với một cú nhấp.”). Titles are Be Vietnam Pro 600–700 with tight tracking. The templates embed the Latin and Vietnamese subsets from `node_modules/@fontsource/*`, so rendering needs no network. The wordmark is outlined from `brand/fonts/BeVietnamPro-Bold-latin.ttf`, a TTF converted from `@fontsource/be-vietnam-pro` because resvg doesn't read WOFF2; Be Vietnam Pro is under the SIL Open Font License (`brand/fonts/OFL-BeVietnamPro.txt`).

## Motifs

- **The deck of account cards.** One white card per saved account: a monogram square in the account colour, the name in Be Vietnam Pro 600, the email in JetBrains Mono. The account in use is in front with the site it belongs to; the cards behind are flat tints of iris and show only their monogram, stepped up and to the right as in the mark.
- **The in-use label.** A dot and **In use** / **Đang dùng** on an iris-soft pill, sentence case, never rotated. It marks the account in use and nothing else.
- **Letter tiles** for third-party sites (Supabase, Vercel, GitHub…), plus a mono “+160 sites” / “+160 trang”.

The promo art follows one composition: a flat background (light, or night for the marquee), the headline in Be Vietnam Pro 700 (EN “Switch accounts in one click.” / VI “Đổi tài khoản chỉ với một cú nhấp.”), a sub line, and the deck of the Supabase accounts used in the store screenshots (`tests/e2e/demo-data.ts`). English and Vietnamese versions carry the same content.

## Regenerating

```sh
npm run icons   # public/icons/icon-{16,32,48,128}.png from assets/icon-small.svg and assets/icon.svg
npm run brand   # everything in brand/ (needs Playwright's Chromium: npx playwright install chromium)
node scripts/brand/render.mjs --only marquee        # one template: marquee, small, githubSocial, readmeBanner
node scripts/brand/render.mjs --html /tmp/brand     # also write the composed HTML for inspection
```

Both run offline on any OS. Copy lives in `brand/templates/shared.mjs` (`COPY`, `DECK`) with English and Vietnamese side by side.

## Store screenshots and the demo video

`npm run screenshots` captures the five store screenshots (`brand/store/screenshots/`, 1280 × 800, EN and VI) from the real extension with the demo data of `tests/e2e/demo-data.ts`. `npm run video` makes the 21-second demo (`brand/video/swapdeck-demo-{en,vi}.mp4`, 1920 × 1200, no sound, for the store's promo video and social posts; `.gif`, 880 px wide, for the README): the real popup's screens, a pretend browser and site (`tests/e2e/store-scenes.ts`, shared with screenshot 3) and a pointer, drawn frame by frame from a timeline in `tests/e2e/store-video.spec.ts`, then encoded with ffmpeg. `VIDEO_AT=2.7,9 npx playwright test --project=video` writes a few stills to `test-results/video/` instead, to check the layout.
