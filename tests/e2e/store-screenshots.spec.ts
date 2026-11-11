/**
 * Chrome Web Store screenshots (1280 × 800), captured from the real extension
 * with demo data, then framed with a caption. Run with `npm run screenshots`;
 * output goes to brand/store/screenshots/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { backgroundCss, FONTS, fontFacesCss, PALETTE } from '../../brand/templates/shared.mjs';
import { PRESETS } from '../../src/core/presets';
import { seedDemo } from './demo-data';
import { test } from './fixtures';
import { PEOPLE, sceneCss, splitWindowHtml } from './store-scenes';

const OUT = resolve(import.meta.dirname, '../../brand/store/screenshots');
const MARK = readFileSync(resolve(import.meta.dirname, '../../brand/logo/mark.svg'), 'utf8');

const SITES = PRESETS.length;

const CAPTIONS = {
  en: [
    ['Every app and account, one click away', 'Switch one app — or a whole client across every app at once.'],
    [
      'Switch a whole client at once',
      'Workspaces remember which account each app uses for every client, company or project.',
    ],
    [
      'Two accounts side by side',
      'Open an account in a separate tab — same window, each tab keeps its own sign-in, no extra profile.',
    ],
    [`${SITES} sites ready — or add any other`, 'Swapdeck only gets access to the sites you add, one by one.'],
    ['Private by design', 'Everything stays on your computer. Lock saved sessions with a passphrase.'],
  ],
  vi: [
    [
      'Mọi ứng dụng, mọi tài khoản — cách một cú nhấp',
      'Chuyển một ứng dụng — hoặc cả một bên trên mọi ứng dụng cùng lúc.',
    ],
    [
      'Chuyển cả một bên chỉ với một cú nhấp',
      'Mỗi bên nhớ tài khoản dùng trên từng ứng dụng cho khách hàng, công ty hay dự án.',
    ],
    [
      'Hai tài khoản cạnh nhau',
      'Mở một tài khoản trong tab riêng — cùng cửa sổ, mỗi tab giữ đăng nhập riêng, không cần thêm hồ sơ.',
    ],
    [
      `${SITES} trang có sẵn — thêm trang khác cũng được`,
      'Swapdeck chỉ được truy cập những trang bạn thêm, từng trang một.',
    ],
    ['Riêng tư từ thiết kế', 'Mọi thứ nằm trên máy bạn. Khóa các phiên đã lưu bằng mật khẩu.'],
  ],
} as const;

function frame(lang: 'en' | 'vi', index: number, inner: string, extraCss = ''): string {
  const [title, sub] = CAPTIONS[lang][index]!;
  // Black lacquer around the warm-paper product, captions in the brand faces.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
  ${fontFacesCss()}
  * { box-sizing: border-box; margin: 0; }
  body { position: relative; width: 1280px; height: 800px; overflow: hidden; font-family: ${FONTS.text};
    background: ${PALETTE.lacquer}; color: ${PALETTE.eggshell}; -webkit-font-smoothing: antialiased; }
  ${backgroundCss('lacquer')}
  .cap { position: absolute; left: 72px; top: 40px; right: 72px; display: flex; align-items: center; gap: 20px; }
  .cap svg { width: 52px; height: 52px; flex: none; border-radius: 13px;
    box-shadow: 0 0 0 1px rgba(241, 233, 220, .14), 0 10px 24px rgba(0, 0, 0, .5); }
  .cap h1 { font: 600 34px/1.12 ${FONTS.display}; letter-spacing: -0.02em; }
  .cap p { margin-top: 7px; font-size: 18px; color: ${PALETTE.eggshell2}; }
  .window { position: absolute; left: 72px; right: 72px; top: 142px; bottom: -14px; border-radius: 14px 14px 0 0; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0, 0, 0, .6), 0 0 0 1px rgba(241, 233, 220, .16); background: ${PALETTE.paper}; }
  .chrome { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #e8e2d7; border-bottom: 1px solid #d5ccbc; }
  .chrome i { width: 11px; height: 11px; border-radius: 50%; background: #cdc3b2; }
  .chrome span { margin-left: 14px; flex: 1; max-width: 560px; height: 24px; border-radius: 12px; background: ${PALETTE.card};
    color: ${PALETTE.ink2}; font-size: 12.5px; line-height: 24px; padding: 0 12px; }
  .chrome b { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px;
    background: ${PALETTE.card}; box-shadow: 0 0 0 2px ${PALETTE.son}; position: relative; }
  .chrome b svg { width: 18px; height: 18px; border-radius: 4px; }
  .chrome b em { position: absolute; right: -6px; bottom: -5px; font: 700 9px/1 ${FONTS.text}; font-style: normal; color: #fff;
    background: ${PALETTE.son}; border-radius: 4px; padding: 2px 4px; }
  .body img { display: block; }
  .site { position: absolute; inset: 38px 0 0 0; background: #f7f4ee; padding: 28px 34px; display: grid; grid-template-columns: 200px 1fr; gap: 26px; }
  .site .nav { display: grid; gap: 12px; align-content: start; }
  .site .nav div, .site .main div { border-radius: 10px; background: #e9e3d9; }
  .site .main { display: grid; gap: 16px; align-content: start; grid-template-columns: repeat(3, 1fr); }
  .site .main .wide { grid-column: 1 / -1; height: 46px; background: ${PALETTE.hairline}; }
  .popup { position: absolute; top: 46px; right: 16px; width: 720px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(26, 23, 20, .35), 0 0 0 1px rgba(26, 23, 20, .14); }
  ${extraCss}
  </style></head><body>
  <div class="bg"></div>
  <div class="cap">${MARK}<div><h1>${title}</h1><p>${sub}</p></div></div>
  ${inner}
  </body></html>`;
}

const toDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

function browser(address: string, body: string, badge?: string) {
  return `<div class="window"><div class="chrome"><i></i><i></i><i></i><span>${address}</span>
    <b>${MARK}${badge ? `<em>${badge}</em>` : ''}</b></div>${body}</div>`;
}

async function compose(page: Page, html: string, file: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  writeFileSync(resolve(OUT, file), await page.screenshot());
}

async function open(page: Page, url: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  await page.waitForTimeout(400);
}

for (const lang of ['en', 'vi'] as const) {
  test(`store screenshots (${lang})`, async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    mkdirSync(OUT, { recursive: true });
    const base = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${base}/options/options.html`);
    await seedDemo(page, { language: lang, theme: 'light' });

    // 1. The popup over a site.
    const popup = await context.newPage();
    await open(popup, `${base}/popup/popup.html?tab=-1&app=app_supabase`, 720, 600);
    const popupShot = await popup.locator('.popup').screenshot();
    const site = `<div class="site"><div class="nav">${'<div style="height:30px"></div>'.repeat(7)}</div>
      <div class="main"><div class="wide"></div>${'<div style="height:150px"></div>'.repeat(6)}</div></div>
      <div class="popup"><img src="${toDataUrl(popupShot)}" width="720"></div>`;
    await compose(
      page,
      frame(lang, 0, browser('supabase.com/dashboard/projects', site, lang === 'vi' ? 'CT' : 'WO')),
      `${lang}-1-popup.png`,
    );

    // 2, 4, 5. Manager pages.
    const manager = await context.newPage();
    const pages: [number, string, string, 'light' | 'dark'][] = [
      [1, '#/workspaces', `${lang}-2-workspaces.png`, 'light'],
      [3, '#/add', `${lang}-4-gallery.png`, 'light'],
      [4, '#/security', `${lang}-5-private.png`, 'dark'],
    ];
    for (const [index, hash, file, theme] of pages) {
      await seedDemo(page, { language: lang, theme });
      await open(manager, `${base}/options/options.html${hash}`, 1136, 620);
      if (hash === '#/add') await manager.locator('input[type=search]').blur();
      const shot = await manager.screenshot();
      const body = `<div class="body"><img src="${toDataUrl(shot)}" width="1136"></div>`;
      await compose(page, frame(lang, index, browser('Swapdeck', body)), file);
    }

    // 3. Separate tabs: the account's ⋯ menu in the popup, and the two tabs side by side.
    await seedDemo(page, { language: lang, theme: 'light' });
    await page.evaluate(async () => {
      const settings = (await chrome.storage.local.get('sd:settings'))['sd:settings'] as object;
      await chrome.storage.local.set({ 'sd:settings': { ...settings, popupLayout: 'compact' } });
    });
    const menuPopup = await context.newPage();
    await open(menuPopup, `${base}/popup/popup.html?tab=-1&app=app_supabase`, 380, 600);
    const row = menuPopup.locator('.account', { hasText: PEOPLE[lang].personal.email }).first();
    await row.locator('[aria-haspopup="menu"]').click();
    const menu = menuPopup.getByRole('menu');
    await menu.waitFor();
    // Point at the entry the screenshot is about.
    await menu.getByRole('menuitem', { name: lang === 'vi' ? 'Mở trong tab riêng' : 'Open in a separate tab' }).hover();
    await menuPopup.waitForTimeout(400);
    const rowBox = (await row.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    const top = Math.max(0, rowBox.y - 10);
    const clip = {
      x: 0,
      y: top,
      width: 380,
      height: Math.max(rowBox.y + rowBox.height, menuBox.y + menuBox.height) + 12 - top,
    };
    const callout = await menuPopup.screenshot({ clip, animations: 'disabled' });
    const tabsScene = `${splitWindowHtml(lang)}<div class="callout"><img src="${toDataUrl(callout)}" width="380"></div>`;
    const tabsCss = `${sceneCss(lang)}
      .tag { opacity: 1; }
      .callout { position: absolute; left: 118px; bottom: 96px; width: 380px; border-radius: 12px; overflow: hidden;
        box-shadow: 0 24px 60px rgba(26, 23, 20, .4), 0 0 0 1px rgba(26, 23, 20, .16); }`;
    await compose(page, frame(lang, 2, tabsScene, tabsCss), `${lang}-3-tabs.png`);
  });
}
