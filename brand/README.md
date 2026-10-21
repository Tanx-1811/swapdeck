# Swapdeck brand kit

Swapdeck switches between several accounts on the same site in one click. The identity is **“Sơn mài & giấy dó”** — lacquer and paper: warm handmade paper, black lacquer, ink type, a touch of gold leaf and one vermilion seal (_con dấu_). The brand idea is a **deck of index cards, one per saved account; the one in use is on top, stamped with the seal**.

Everything here is generated from `brand/templates/` and `assets/` by one command (see [Regenerating](#regenerating)). Edit the templates rather than the PNGs.

## Assets

| File                                                   | Size            | Use it for                                                             |
| ------------------------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| `logo/mark.svg`                                        | vector          | The mark on its own: favicons, avatars, app icons                      |
| `logo/mark-512.png`, `logo/mark-1024.png`              | 512², 1024²     | Raster mark (transparent corners)                                      |
| `logo/mark-mono-white.svg`, `logo/mark-mono-black.svg` | vector          | Single-colour mark for coloured, busy or photo backgrounds, print      |
| `logo/lockup-horizontal-light.svg` / `@2x.png`         | vector / 1200 w | Primary logo on paper and other light backgrounds                      |
| `logo/lockup-horizontal-dark.svg` / `@2x.png`          | vector / 1200 w | Logo on dark UI surfaces (`#1C1816`)                                   |
| `logo/lockup-horizontal-on-night.svg` / `@2x.png`      | vector / 1200 w | Logo on the black-lacquer promo background (`#141110`)                 |
| `store/store-icon-128.png`                             | 128²            | Chrome Web Store icon: 96 × 96 artwork with 16 px transparent padding  |
| `store/promo-small-440x280.png` (+ `-vi`)              | 440 × 280       | Chrome Web Store small promo tile (English / Vietnamese listing)       |
| `store/promo-marquee-1400x560.png` (+ `-vi`)           | 1400 × 560      | Chrome Web Store marquee promo tile (English / Vietnamese listing)     |
| `social/github-social-1280x640.png`                    | 1280 × 640      | GitHub repository social preview (Settings → General → Social preview) |
| `social/readme-banner-1600x500.png`                    | 1600 × 500      | README header image (rounded, transparent corners)                     |

Promo tiles and the social preview are 24-bit PNGs without alpha, as the Chrome Web Store requires. Store screenshots (1280 × 800, `store/screenshots/`) are captured from the real extension with `npm run screenshots`, not drawn.

## Logo

**The mark** is a black-lacquer tile (`#1A1714`, with a faint sheen at the top and a lighter inner edge so it keeps its shape on dark toolbars) holding a fanned deck:

- a **gold-leaf card** at the back and an **eggshell card** in the middle — the other saved accounts;
- the **paper card** in front with two ink lines — the account in use;
- the **vermilion seal** stamped in its corner: an outline frame with a bar, tilted like a hand-pressed stamp.

The toolbar sizes (16 and 32 px) use `assets/icon-small.svg`: the same deck drawn on the 16-pixel grid (three cards stepped up and to the right, a solid seal), so it stays crisp. 48 and 128 px use `assets/icon.svg`, which is identical to `logo/mark.svg`; the geometry also lives in `markShapes()` in `brand/templates/shared.mjs` and in `src/ui/Logo.tsx`, so change all of them together.

**The mono marks** are a single colour with no tints: the three cards are cut out of the tile and separated by gaps.

**The lockup** pairs the mark with the wordmark _Swapdeck_ in Fraunces SemiBold (600), converted to outlines, in one colour: ink `#1A1714` on light backgrounds, eggshell `#F1E9DC` on dark ones. The vermilion comes only from the seal in the mark.

- **Clear space:** at least ¼ of the mark's height on every side.
- **Minimum size:** mark 16 px; lockup 24 px tall on screen. Below that, use the mark alone.
- **Name:** always _Swapdeck_, one word with a capital S. The store name adds the descriptor: _Swapdeck — Multi-Account Switcher_.
- Don't recolour, stretch or re-letter the wordmark, add effects to the mark, or put the full-colour mark on vermilion or busy backgrounds (use a mono mark there).
- Third-party sites appear only as names on plain letter tiles — never their logos — and their colours (Supabase green, …) are never Swapdeck brand colours.

## Colours

| Group                | Token           | Value                                         | Use                                                   |
| -------------------- | --------------- | --------------------------------------------- | ----------------------------------------------------- |
| Paper — _giấy dó_    | Paper           | `#F4F0E8`                                     | Light backgrounds                                     |
|                      | Card stock      | `#FBF9F5`                                     | Cards, raised surfaces                                |
|                      | Sunken          | `#EDE7DC`                                     | Wells, inputs, cards further back                     |
|                      | Hairline        | `#E1D9CB`                                     | Borders, ruled lines                                  |
|                      | Strong line     | `#CBBFAB`                                     | Emphasised borders                                    |
|                      | Ink / 2 / 3     | `#1A1714` / `#57504A` / `#766D62`             | Text: primary, secondary, meta                        |
| Lacquer — _sơn mài_  | Lacquer         | `#141110`                                     | Dark backgrounds, the marquee                         |
|                      | Surface         | `#1C1816`                                     | Dark cards and panels                                 |
|                      | Line            | `#332B25`                                     | Borders on dark                                       |
|                      | Eggshell / 2    | `#F1E9DC` / `#C2B6A5`                         | Text on dark: primary, secondary                      |
| Accent               | Vermilion — son | `#C8402B` (`#E0573C` on dark, deep `#A8331E`) | The one accent: the seal, the account in use, actions |
| Secondary, sparingly | Jade            | `#1F6B52`                                     | Account colours                                       |
|                      | Indigo — _chàm_ | `#2F4E86`                                     | Account colours                                       |
|                      | Gold leaf       | `#B08A3A`                                     | The back card of the mark, account colours            |

Borders are hairlines; surfaces are warm paper. No purple, no decorative gradients and no emoji: the only textures are a fine paper grain and the faint sheen of lacquer.

## Type

| Face           | Weights       | Use                         |
| -------------- | ------------- | --------------------------- |
| Fraunces       | 600           | Headlines and the wordmark  |
| Be Vietnam Pro | 400, 600, 700 | Text, labels, the seal      |
| JetBrains Mono | 400           | Meta: emails, hosts, counts |

All three cover Vietnamese (test with “Đổi tài khoản chỉ với một cú nhấp.”). The templates embed the Latin and Vietnamese subsets from `node_modules/@fontsource/*`, so rendering needs no network. The wordmark is outlined from `brand/fonts/Fraunces-SemiBold-latin.ttf`, a TTF converted from `@fontsource/fraunces` because resvg doesn't read WOFF2; Fraunces is under the SIL Open Font License (`brand/fonts/OFL-Fraunces.txt`).

## Motifs

- **The deck of index cards.** One card per saved account: a monogram square in the account colour, the name in Be Vietnam Pro 600, the email in JetBrains Mono, a vermilion head rule and hairline ruled lines. The account in use is on top with the site it belongs to; only the monograms of the cards behind peek out of the fan.
- **The seal.** A rounded-rectangle outline stamp in vermilion, uppercase and letter-spaced — **IN USE** / **ĐANG DÙNG** — rotated about −2°, with slightly uneven ink. It marks the account in use and nothing else.
- **Letter tiles** for third-party sites (Supabase, Vercel, GitHub…), plus a mono “+160 sites” / “+160 trang”.

The promo art follows one composition: paper background (the marquee is the lacquer variant), the Fraunces headline (EN “Switch accounts in one click.” / VI “Đổi tài khoản chỉ với một cú nhấp.”), a Be Vietnam Pro sub line, and the deck of the Supabase accounts used in the store screenshots (`tests/e2e/demo-data.ts`). English and Vietnamese versions carry the same content.

## Regenerating

```sh
npm run icons   # public/icons/icon-{16,32,48,128}.png from assets/icon-small.svg and assets/icon.svg
npm run brand   # everything in brand/ (needs Playwright's Chromium: npx playwright install chromium)
node scripts/brand/render.mjs --only marquee        # one template: marquee, small, githubSocial, readmeBanner
node scripts/brand/render.mjs --html /tmp/brand     # also write the composed HTML for inspection
```

Both run offline on any OS. Copy lives in `brand/templates/shared.mjs` (`COPY`, `DECK`) with English and Vietnamese side by side.
