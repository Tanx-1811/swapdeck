/**
 * The pretend browser and site of the store screenshots and the demo video: a window with tabs, an
 * address bar and Swapdeck's toolbar button, around a neutral dashboard that shows who is signed in.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONTS, PALETTE } from '../../brand/templates/shared.mjs';
import { initials } from '../../src/core/util';

export const MARK = readFileSync(resolve(import.meta.dirname, '../../brand/logo/mark.svg'), 'utf8');

const SITE_COPY = {
  en: { projects: 'Projects', signedIn: 'Signed in' },
  vi: { projects: 'Dự án', signedIn: 'Đang đăng nhập' },
} as const;

/** The demo accounts shown on the fake site (labels as in demo-data.ts). */
export const PEOPLE = {
  en: {
    work: { label: 'Work', email: 'minh@company.example', color: '#c8402b', projects: ['orbit-prod', 'orbit-staging'] },
    personal: { label: 'Personal', email: 'minh.home@example.com', color: '#2f4e86', projects: ['notes-app'] },
    client: {
      label: 'Client — Acme',
      email: 'dev@acme.example',
      color: '#94661a',
      projects: ['acme-shop', 'acme-api'],
    },
  },
  vi: {
    work: {
      label: 'Công ty',
      email: 'minh@company.example',
      color: '#c8402b',
      projects: ['orbit-prod', 'orbit-staging'],
    },
    personal: { label: 'Cá nhân', email: 'minh.home@example.com', color: '#2f4e86', projects: ['notes-app'] },
    client: {
      label: 'Khách hàng — Acme',
      email: 'dev@acme.example',
      color: '#94661a',
      projects: ['acme-shop', 'acme-api'],
    },
  },
};
export type Person = (typeof PEOPLE)['en']['work'];

export function siteHtml(person: Person, lang: 'en' | 'vi', id: string) {
  const copy = SITE_COPY[lang];
  const cards = person.projects
    .map(
      (name) =>
        `<div class="card"><b>${name}</b><span></span><span class="short"></span><i style="background:${person.color}"></i></div>`,
    )
    .join('');
  return `<div class="dash" id="${id}">
    <div class="top"><div class="logo"></div><div class="search"></div>
      <div class="who"><div><b>${person.label}</b><small>${person.email}</small></div>
      <span class="avatar" style="background:${person.color}">${initials(person.label)}</span></div></div>
    <div class="dash-nav">${'<div></div>'.repeat(6)}</div>
    <div class="dash-main"><h2>${copy.projects}</h2><div class="cards">${cards}${'<div class="card ghost"></div>'.repeat(3 - person.projects.length)}</div>
      <div class="rows">${'<div></div>'.repeat(4)}</div></div>
    <div class="tag">${copy.signedIn}: ${person.email}</div>
  </div>`;
}

export function chromeBar(address: string, tabs: string, person?: Person) {
  const badge = person ? ` style="background:${person.color}">${initials(person.label)}` : '>';
  return `<div class="wchrome"><div class="tabs">${tabs}</div><div class="bar"><i></i><i></i><i></i><span>${address}</span>
    <b class="icon">${MARK}<em class="badge"${badge}</em></b></div></div>`;
}

export function tab(title: string, extra = '') {
  return `<div class="tab ${extra}"><span class="fav"></span>${title}</div>`;
}

/**
 * One window, two tabs side by side (Chrome's split view): the browser's own sign-in on the left,
 * the other account in a separate tab (its tab group) on the right.
 */
export function splitWindowHtml(lang: 'en' | 'vi', ids = { left: 'sL', right: 'sR' }) {
  const people = PEOPLE[lang];
  const group = `${people.personal.label} · Supabase`;
  const tabs = `${tab('Supabase', 'on')}<span class="group" style="background:${people.personal.color}">${group}</span>${tab(
    'Supabase',
    'on grouped',
  )}`;
  return `<div class="window" id="winS">${chromeBar('supabase.com/dashboard/projects', tabs, people.personal)}
      <div class="view split"><div class="pane" id="paneL">${siteHtml(people.work, lang, ids.left)}</div>
      <div class="pane" id="paneR">${siteHtml(people.personal, lang, ids.right)}</div></div></div>`;
}

/** Styles of the windows and the site (positions for a 1280 × 800 frame with a caption on top). */
export function sceneCss(lang: 'en' | 'vi') {
  const people = PEOPLE[lang];
  return `
  .window { position: absolute; left: 72px; right: 72px; top: 142px; bottom: -14px; border-radius: 14px 14px 0 0; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0, 0, 0, .6), 0 0 0 1px rgba(241, 233, 220, .16); background: ${PALETTE.paper}; color: ${PALETTE.ink}; }
  .wchrome { height: 74px; background: #e8e2d7; border-bottom: 1px solid #d5ccbc; }
  .tabs { height: 36px; display: flex; align-items: flex-end; gap: 6px; padding: 0 12px; }
  .tab { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-radius: 9px 9px 0 0;
    font-size: 12.5px; color: ${PALETTE.ink2}; background: #ddd6ca; min-width: 150px; }
  .tab.on { background: #f7f4ee; color: ${PALETTE.ink}; }
  .tab.grouped { box-shadow: inset 0 3px 0 ${people.personal.color}; }
  .fav { width: 14px; height: 14px; border-radius: 4px; background: #3ecf8e33; box-shadow: inset 0 0 0 2px #2b9a6b; }
  .group { align-self: center; margin-bottom: 4px; padding: 3px 10px; border-radius: 8px; color: #fff; font-size: 12px; font-weight: 600; }
  .bar { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #f7f4ee; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #cdc3b2; }
  .bar span { margin-left: 14px; flex: 1; max-width: 560px; height: 24px; border-radius: 12px; background: ${PALETTE.card};
    color: ${PALETTE.ink2}; font-size: 12.5px; line-height: 24px; padding: 0 12px; box-shadow: inset 0 0 0 1px ${PALETTE.hairline}; }
  .icon { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px;
    background: ${PALETTE.card}; position: relative; }
  .icon svg { width: 18px; height: 18px; border-radius: 4px; }
  .badge { position: absolute; right: -6px; bottom: -5px; font: 700 9px/1 ${FONTS.text}; font-style: normal; color: #fff;
    border-radius: 4px; padding: 2px 4px; }
  .view { position: absolute; inset: 74px 0 0 0; }
  .dash { position: absolute; inset: 0; background: #f7f4ee; display: grid; grid-template-columns: 190px 1fr;
    grid-template-rows: 56px 1fr; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; background: #ddd6ca; }
  .pane { position: relative; overflow: hidden; border-radius: 10px; box-shadow: 0 0 0 1px #d5ccbc; }
  #paneR { box-shadow: 0 0 0 2px ${people.personal.color}; }
  .pane .dash { grid-template-columns: 1fr; }
  .pane .dash-main { grid-column: 1 / -1; }
  .pane .dash-nav { display: none; }
  .top { grid-column: 1 / -1; display: flex; align-items: center; gap: 18px; padding: 0 26px; border-bottom: 1px solid ${PALETTE.hairline}; }
  .logo { width: 104px; height: 20px; border-radius: 6px; background: #ded6c8; }
  .search { width: 240px; height: 28px; border-radius: 8px; background: #ebe5da; }
  .pane .search { width: 120px; }
  .who { margin-left: auto; display: flex; align-items: center; gap: 10px; text-align: right; }
  .who b { display: block; font-size: 13px; }
  .who small { display: block; font-size: 11.5px; color: ${PALETTE.ink3}; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700;
    font-size: 12px; }
  .dash-nav { display: grid; gap: 12px; align-content: start; padding: 24px 0 0 26px; }
  .dash-nav div { height: 26px; border-radius: 8px; background: #e9e3d9; }
  .dash-main { padding: 24px 30px; }
  .dash-main h2 { font: 600 20px/1 ${FONTS.display}; margin-bottom: 16px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .pane .cards { grid-template-columns: repeat(2, 1fr); }
  .pane .card.ghost:nth-child(n+3) { display: none; }
  .card { position: relative; height: 120px; border-radius: 12px; background: ${PALETTE.card}; padding: 16px;
    box-shadow: 0 0 0 1px ${PALETTE.hairline}; display: grid; gap: 10px; align-content: start; overflow: hidden; }
  .card b { font-size: 14px; }
  .card span { height: 10px; border-radius: 5px; background: #ece6db; }
  .card span.short { width: 60%; }
  .card i { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; }
  .card.ghost { background: transparent; box-shadow: inset 0 0 0 1.5px #e3dccf; }
  .rows { margin-top: 22px; display: grid; gap: 10px; }
  .rows div { height: 34px; border-radius: 8px; background: #efe9df; }
  .tag { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px;
    background: ${PALETTE.ink}; color: ${PALETTE.eggshell}; font-size: 13px; white-space: nowrap; opacity: 0; }
`;
}
