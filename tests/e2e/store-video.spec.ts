/**
 * A short demo video (≈ 20 s) for the README, the store listing and social posts, made from the
 * real extension's screens with demo data: one account to another in one click, a whole client at
 * once, two accounts side by side, then the promise. Frames are rendered one by one from a
 * timeline (no screen recording), so the result is the same on every run.
 *
 *   npm run video        →  brand/video/swapdeck-demo-{en,vi}.mp4 (1920 × 1200) and .gif (880 wide)
 *
 * Needs ffmpeg on the PATH for the encoding; without it the frames are left in test-results/video.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';
import { backgroundCss, FONTS, fontFacesCss, PALETTE } from '../../brand/templates/shared.mjs';
import { PRESETS } from '../../src/core/presets';
import { initials } from '../../src/core/util';
import { seedDemo } from './demo-data';
import { test } from './fixtures';
import { chromeBar, MARK, PEOPLE, sceneCss, siteHtml, tab, splitWindowHtml } from './store-scenes';

const OUT = resolve(import.meta.dirname, '../../brand/video');
const FRAMES = resolve(import.meta.dirname, '../../test-results/video');
const FPS = 30;
const SCALE = 1.5; // 1280 × 800 layout, rendered at 1920 × 1200.
const SCREEN_SCALE = 2; // Extension screens are captured sharper than they are shown.

const COPY = {
  en: {
    scenes: [
      [
        'Many accounts on the same site?',
        'Switch in one click — no signing out, no passwords, no extra Chrome profile.',
      ],
      ['A whole client at once', 'A workspace remembers the account each app uses. One click switches them all.'],
      ['Two accounts side by side', 'Open an account in a separate tab: same window, each tab keeps its own sign-in.'],
    ],
    end: {
      title: 'Swapdeck',
      tagline: 'Switch accounts in one click',
      points: [
        'Free and open source',
        'Everything stays on your computer',
        `${PRESETS.length} sites ready — or any other`,
      ],
      where: 'Chrome Web Store · github.com/Tanx-1811/swapdeck',
    },
  },
  vi: {
    scenes: [
      [
        'Nhiều tài khoản trên cùng một trang?',
        'Chuyển trong một cú nhấp — không đăng xuất, không gõ mật khẩu, không thêm hồ sơ Chrome.',
      ],
      ['Cả một bên trong một lần', 'Mỗi bên nhớ tài khoản dùng trên từng ứng dụng. Một cú nhấp đổi tất cả.'],
      ['Hai tài khoản cạnh nhau', 'Mở một tài khoản trong tab riêng: cùng cửa sổ, mỗi tab giữ đăng nhập riêng.'],
    ],
    end: {
      title: 'Swapdeck',
      tagline: 'Đổi tài khoản chỉ với một cú nhấp',
      points: [
        'Miễn phí, mã nguồn mở',
        'Mọi thứ nằm trên máy bạn',
        `${PRESETS.length} trang có sẵn — thêm trang khác cũng được`,
      ],
      where: 'Chrome Web Store · github.com/Tanx-1811/swapdeck',
    },
  },
} as const;

type Shot = { src: string; width: number; height: number };
type Point = { x: number; y: number };

type Sharp = { page: Page; cdp: CDPSession };

/**
 * A page drawn at `scale` device pixels per CSS pixel. Playwright's own screenshots stay at its
 * scale of 1, so pictures are taken through the DevTools protocol (`png`).
 */
async function sharpen(context: BrowserContext, page: Page, width: number, height: number, scale: number) {
  // After Playwright's own viewport, which would put the scale back to 1.
  await page.setViewportSize({ width, height });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  return { page, cdp };
}

async function png(sharp: Sharp, clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const { data } = await sharp.cdp.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  return Buffer.from(data, 'base64');
}

async function openScreen(context: BrowserContext, url: string, width: number, height: number): Promise<Sharp> {
  const page = await context.newPage();
  const sharp = await sharpen(context, page, width, height, SCREEN_SCALE);
  await page.goto(url);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return sharp;
}

async function shot(sharp: Sharp, target: Locator): Promise<Shot> {
  const box = (await target.boundingBox())!;
  const picture = await png(sharp, box);
  return { src: `data:image/png;base64,${picture.toString('base64')}`, width: box.width, height: box.height };
}

/** Centre of `inner`, relative to `outer`'s top left (CSS pixels). */
async function centreIn(outer: Locator, inner: Locator): Promise<Point> {
  const a = (await outer.boundingBox())!;
  const b = (await inner.boundingBox())!;
  return { x: b.x - a.x + Math.min(b.width / 2, 90), y: b.y - a.y + b.height / 2 };
}

async function patch(page: Page, items: Record<string, unknown>) {
  await page.evaluate(async (values) => {
    const settings = (await chrome.storage.local.get('sd:settings'))['sd:settings'] as Record<string, unknown>;
    const { settings: changes, ...rest } = values as { settings?: Record<string, unknown> };
    await chrome.storage.local.set({ ...rest, ...(changes ? { 'sd:settings': { ...settings, ...changes } } : {}) });
  }, items);
}

const ACTIVE = {
  app_supabase: 'acc_work',
  app_vercel: 'acc_vercel_team',
  app_github: 'acc_gh_main',
  app_netlify: 'acc_netlify',
  app_chatgpt: 'acc_gpt_work',
};

type Captures = {
  compact: Shot;
  compactTarget: Point;
  wideBefore: Shot;
  wideAfter: Shot;
  wideTarget: Point;
};

function stageHtml(lang: 'en' | 'vi', cap: Captures) {
  const copy = COPY[lang];
  const people = PEOPLE[lang];
  const captions = copy.scenes
    .map(
      ([title, sub], index) =>
        `<div class="cap" id="cap${index}">${MARK}<div><h1>${title}</h1><p>${sub}</p></div></div>`,
    )
    .join('');
  const browserOne = `<div class="window" id="win1">${chromeBar('supabase.com/dashboard/projects', tab('Supabase', 'on'))}
      <div class="view">${siteHtml(people.work, lang, 's1-work')}${siteHtml(people.personal, lang, 's1-personal')}
      ${siteHtml(people.client, lang, 's1-client')}</div>
      <img class="popup" id="compact" src="${cap.compact.src}" style="width:${cap.compact.width}px">
      <img class="popup" id="wideBefore" src="${cap.wideBefore.src}" style="width:${cap.wideBefore.width}px">
      <img class="popup" id="wideAfter" src="${cap.wideAfter.src}" style="width:${cap.wideAfter.width}px">
    </div>`;
  const end = `<div id="end"><div class="lockup">${MARK}<span>${copy.end.title}</span></div>
      <p class="tagline">${copy.end.tagline}</p>
      <ul>${copy.end.points.map((point) => `<li><span class="dot"></span>${point}</li>`).join('')}</ul>
      <p class="where">${copy.end.where}</p></div>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
  ${fontFacesCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { position: relative; width: 1280px; height: 800px; overflow: hidden; font-family: ${FONTS.text};
    background: ${PALETTE.lacquer}; color: ${PALETTE.eggshell}; -webkit-font-smoothing: antialiased; }
  ${backgroundCss('lacquer')}
  #stage { position: absolute; inset: 0; }
  .cap { position: absolute; left: 72px; top: 40px; right: 72px; display: flex; align-items: center; gap: 20px; opacity: 0; }
  .cap svg { width: 52px; height: 52px; flex: none; border-radius: 13px;
    box-shadow: 0 0 0 1px rgba(241, 233, 220, .14), 0 10px 24px rgba(0, 0, 0, .5); }
  .cap h1 { font: 600 34px/1.12 ${FONTS.display}; letter-spacing: -0.02em; }
  .cap p { margin-top: 7px; font-size: 18px; color: ${PALETTE.eggshell2}; }
  ${sceneCss(lang)}
  .popup { position: absolute; top: 78px; right: 14px; border-radius: 12px; opacity: 0; transform-origin: top right;
    box-shadow: 0 24px 60px rgba(26, 23, 20, .35), 0 0 0 1px rgba(26, 23, 20, .14); }
  #cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; z-index: 10; opacity: 0;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  #ripple { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; z-index: 9;
    border: 3px solid ${PALETTE.son}; opacity: 0; }
  #end { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; opacity: 0; }
  .lockup { display: flex; align-items: center; gap: 22px; }
  .lockup svg { width: 96px; height: 96px; border-radius: 24px; box-shadow: 0 0 0 1px rgba(241, 233, 220, .14), 0 16px 40px rgba(0,0,0,.5); }
  .lockup span { font: 600 72px/1 ${FONTS.display}; letter-spacing: -0.02em; }
  .tagline { margin-top: 18px; font-size: 24px; color: ${PALETTE.eggshell2}; }
  #end ul { list-style: none; margin-top: 40px; display: grid; gap: 14px; justify-items: start; font-size: 20px; }
  #end li { display: flex; align-items: center; gap: 14px; }
  .dot { width: 12px; height: 12px; border-radius: 3px; background: ${PALETTE.sonOnDark}; transform: rotate(45deg); }
  .where { margin-top: 44px; font: 500 16px/1 ${FONTS.mono}; color: ${PALETTE.eggshell2}; }
  #fade { position: absolute; inset: 0; background: #000; z-index: 20; }
  </style></head><body>
  <div class="bg"></div>
  <div id="stage">${captions}${browserOne}${splitWindowHtml(lang)}${end}
    <div id="ripple"></div>
    <svg id="cursor" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.6 20.3 L11.7 13.6 L18 13.6 Z"
      fill="#fff" stroke="#1a1714" stroke-width="1.4" stroke-linejoin="round"/></svg>
  </div>
  <div id="fade"></div>
  <script>window.CAP = ${JSON.stringify({
    compact: { w: cap.compact.width, target: cap.compactTarget },
    wide: { w: cap.wideBefore.width, target: cap.wideTarget },
    badges: {
      work: initials(people.work.label),
      personal: initials(people.personal.label),
      client: initials(people.client.label),
    },
    colors: { work: people.work.color, personal: people.personal.color, client: people.client.color },
  })};</script>
  </body></html>`;
}

/**
 * The timeline, run inside the stage page: sets every layer for time `t` (seconds). Pure: the same
 * `t` always gives the same picture.
 */
function render(t: number) {
  type Cap = {
    compact: { w: number; target: { x: number; y: number } };
    wide: { w: number; target: { x: number; y: number } };
    badges: Record<'work' | 'personal' | 'client', string>;
    colors: Record<'work' | 'personal' | 'client', string>;
  };
  const cap = (window as unknown as { CAP: Cap }).CAP;
  const $ = (id: string) => document.getElementById(id)!;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  /** 0 before a, 1 after b, eased between. */
  const ramp = (a: number, b: number) => ease(clamp((t - a) / (b - a)));
  /** Visible between a and b, fading over `f` at both ends. */
  const span = (a: number, b: number, f = 0.35) => Math.min(ramp(a - f, a), 1 - ramp(b - f, b));
  const set = (id: string, styles: Partial<CSSStyleDeclaration>) => Object.assign($(id).style, styles);

  // Scenes: 1 switch [0, 6.2), 2 workspace [6.2, 12.6), 3 separate tabs [12.6, 17.6), end [17.6, 21).
  set('fade', { opacity: String(1 - ramp(0, 0.5) + ramp(20.4, 21)) });
  set('cap0', { opacity: String(span(0.2, 6.2)) });
  set('cap1', { opacity: String(span(6.4, 12.6)) });
  set('cap2', { opacity: String(span(12.8, 17.6)) });

  // The one window of scenes 1–2, then the two windows of scene 3.
  const one = span(0, 12.7, 0.4);
  set('win1', { opacity: String(one) });
  const two = span(12.9, 17.6, 0.4);
  set('winS', { opacity: String(two), transform: `translateY(${(1 - ramp(12.6, 13.2)) * 16}px)` });
  set('paneR', { opacity: String(ramp(13.3, 13.9)), transform: `translateX(${(1 - ramp(13.3, 14.0)) * 50}px)` });
  set('end', { opacity: String(ramp(17.7, 18.3)), transform: `translateY(${(1 - ramp(17.7, 18.4)) * 14}px)` });

  // Who the site shows in the window: work → personal (scene 1), → client (scene 2).
  const toPersonal = ramp(3.3, 3.7);
  const toClient = ramp(9.6, 10.0) * (t < 6.3 ? 0 : 1);
  const work = t < 6.3 ? 1 - toPersonal : 1 - toClient;
  set('s1-work', { opacity: String(work) });
  set('s1-personal', { opacity: String(t < 6.3 ? toPersonal : 0) });
  set('s1-client', { opacity: String(t < 6.3 ? 0 : toClient) });
  // Scene 2 opens again on the work account, as the popup's "before" shows it.
  const who: 'work' | 'personal' | 'client' = t < 3.5 ? 'work' : t < 6.3 ? 'personal' : t < 9.8 ? 'work' : 'client';
  for (const chip of document.querySelectorAll<HTMLElement>('#win1 .badge')) {
    chip.textContent = cap.badges[who];
    chip.style.background = cap.colors[who];
  }
  const split = document.querySelector<HTMLElement>('#winS .badge')!;
  split.textContent = cap.badges.personal;
  split.style.background = cap.colors.personal;
  // A quiet "signed in as" pill under each change.
  (document.querySelector('#s1-personal .tag') as HTMLElement).style.opacity = String(span(3.7, 5.9));
  (document.querySelector('#s1-client .tag') as HTMLElement).style.opacity = String(span(10.0, 12.3));
  (document.querySelector('#sR .tag') as HTMLElement).style.opacity = String(span(14.0, 17.4));
  (document.querySelector('#sL .tag') as HTMLElement).style.opacity = String(span(14.0, 17.4));

  // Popups (positions in the window: right 14px, top 78px).
  const pop = (id: string, a: number, b: number) => {
    const shown = span(a, b, 0.25);
    set(id, { opacity: String(shown), transform: `translateY(${(1 - shown) * -6}px) scale(${0.98 + shown * 0.02})` });
  };
  pop('compact', 1.2, 3.2);
  pop('wideBefore', 7.3, 9.7);
  const after = span(9.6, 11.4, 0.25);
  set('wideAfter', { opacity: String(after) });

  // The pointer (stage coordinates). The window starts at (72, 142); the popup's right edge is at 1280-72-14.
  const winY = 142;
  const iconX = 1280 - 72 - 14 - 14 - 4;
  const iconY = winY + 36 + 19;
  const compactAt = (p: { x: number; y: number }) => ({
    x: 1280 - 72 - 14 - cap.compact.w + p.x,
    y: winY + 78 + p.y,
  });
  const wideAt = (p: { x: number; y: number }) => ({ x: 1280 - 72 - 14 - cap.wide.w + p.x, y: winY + 78 + p.y });
  type Key = [number, { x: number; y: number }];
  const path: Key[] = [
    [0.4, { x: 760, y: 640 }],
    [1.0, { x: iconX, y: iconY }],
    [1.6, { x: iconX, y: iconY }],
    [2.6, compactAt(cap.compact.target)],
    [5.6, compactAt(cap.compact.target)],
    [6.6, { x: 760, y: 620 }],
    [6.9, { x: iconX, y: iconY }],
    [7.6, { x: iconX, y: iconY }],
    [8.8, wideAt(cap.wide.target)],
    [12.0, wideAt(cap.wide.target)],
  ];
  let at = path[0]![1];
  for (let i = 0; i < path.length - 1; i++) {
    const [ta, pa] = path[i]!;
    const [tb, pb] = path[i + 1]!;
    if (t >= ta && t <= tb) {
      const k = ease((t - ta) / (tb - ta));
      at = { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k };
    } else if (t > tb) at = pb;
  }
  set('cursor', {
    opacity: String(span(0.4, 12.2, 0.3)),
    transform: `translate(${at.x - 4}px, ${at.y - 2}px)`,
  });
  // Clicks: the toolbar button, the account, the button again, the workspace.
  const clicks = [1.05, 3.0, 7.0, 9.4];
  let ring = 0;
  let scale = 1;
  for (const c of clicks) {
    if (t >= c && t < c + 0.45) {
      const k = (t - c) / 0.45;
      ring = 1 - k;
      scale = 0.6 + k * 0.8;
    }
  }
  set('ripple', {
    opacity: String(ring),
    left: `${at.x}px`,
    top: `${at.y}px`,
    transform: `scale(${scale})`,
  });
}

async function capture(context: BrowserContext, base: string, seedPage: Page, lang: 'en' | 'vi'): Promise<Captures> {
  await seedDemo(seedPage, { language: lang, theme: 'light' });
  // An important account asks before every switch; the demo keeps to the one click.
  await seedPage.evaluate(async () => {
    const accounts = (await chrome.storage.local.get('sd:accounts'))['sd:accounts'] as { important?: boolean }[];
    await chrome.storage.local.set({ 'sd:accounts': accounts.map((account) => ({ ...account, important: false })) });
  });
  const people = PEOPLE[lang];
  await patch(seedPage, { settings: { popupLayout: 'compact' } });
  const compactScreen = await openScreen(context, `${base}/popup/popup.html?tab=-1&app=app_supabase`, 380, 600);
  const compactRoot = compactScreen.page.locator('.popup');
  const compact = await shot(compactScreen, compactRoot);
  const compactTarget = await centreIn(
    compactRoot,
    compactRoot.getByText(people.personal.email, { exact: true }).first(),
  );
  await compactScreen.page.close();

  await patch(seedPage, { settings: { popupLayout: 'wide' }, 'sd:active': ACTIVE });
  const wideScreen = await openScreen(context, `${base}/popup/popup.html?tab=-1&app=app_supabase`, 720, 600);
  const wideRoot = wideScreen.page.locator('.popup');
  const wideBefore = await shot(wideScreen, wideRoot);
  const clientWorkspace = lang === 'vi' ? 'Khách hàng Acme' : 'Client Acme';
  const wideTarget = await centreIn(wideRoot, wideRoot.getByText(clientWorkspace, { exact: true }).first());
  await wideScreen.page.close();

  // After the workspace switch: the client's accounts are in use.
  await patch(seedPage, { 'sd:active': { ...ACTIVE, app_supabase: 'acc_client', app_github: 'acc_gh_bot' } });
  const afterScreen = await openScreen(context, `${base}/popup/popup.html?tab=-1&app=app_supabase`, 720, 600);
  const wideAfter = await shot(afterScreen, afterScreen.page.locator('.popup'));
  await afterScreen.page.close();
  return { compact, compactTarget, wideBefore, wideAfter, wideTarget };
}

function encode(lang: 'en' | 'vi', dir: string) {
  const ffmpeg = spawnSync('ffmpeg', ['-version']);
  if (ffmpeg.status !== 0) {
    console.log(`ffmpeg not found: frames left in ${dir}`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const mp4 = resolve(OUT, `swapdeck-demo-${lang}.mp4`);
  const gif = resolve(OUT, `swapdeck-demo-${lang}.gif`);
  const run = (args: string[]) => {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
  };
  run([
    '-framerate',
    String(FPS),
    '-i',
    resolve(dir, '%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    mp4,
  ]);
  // GIF: 12 fps, 880 wide, one palette for the whole clip (≈ 4 MB).
  const palette = resolve(dir, 'palette.png');
  run(['-i', mp4, '-vf', 'fps=12,scale=880:-1:flags=lanczos,palettegen=max_colors=160:stats_mode=diff', palette]);
  run([
    '-i',
    mp4,
    '-i',
    palette,
    '-lavfi',
    'fps=12,scale=880:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    gif,
  ]);
  console.log(`wrote ${mp4} and ${gif}`);
}

for (const lang of ['en', 'vi'] as const) {
  test(`demo video (${lang})`, async ({ context, extensionId }) => {
    test.setTimeout(600_000);
    const base = `chrome-extension://${extensionId}`;
    const seedPage = await context.newPage();
    await seedPage.goto(`${base}/options/options.html`);
    const captures = await capture(context, base, seedPage, lang);

    const stage = await context.newPage();
    const sharpStage = await sharpen(context, stage, 1280, 800, SCALE);
    await stage.setContent(stageHtml(lang, captures), { waitUntil: 'load' });
    await stage.evaluate(() => document.fonts.ready);
    await stage.evaluate(`window.render = ${render.toString()}`);

    const dir = resolve(FRAMES, lang);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const draw = (t: number) =>
      stage.evaluate((at) => (window as unknown as { render: (t: number) => void }).render(at), t);
    // VIDEO_AT=1.5,8,15: a few stills to check the layout, no video.
    const stills = process.env.VIDEO_AT?.split(',').map(Number);
    if (stills) {
      for (const t of stills) {
        await draw(t);
        writeFileSync(resolve(dir, `at-${t}.png`), await png(sharpStage));
      }
      return;
    }
    const total = 21 * FPS;
    for (let frame = 0; frame < total; frame++) {
      await draw(frame / FPS);
      writeFileSync(resolve(dir, `${String(frame).padStart(4, '0')}.png`), await png(sharpStage));
    }
    encode(lang, dir);
  });
}
