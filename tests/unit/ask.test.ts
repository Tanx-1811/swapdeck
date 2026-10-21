import { afterEach, describe, expect, it, vi } from 'vitest';
import { askText, type UnsavedTab } from '../../src/core/ask';
import { parseSettings } from '../../src/core/settings';
import { askOnPage, unsavedWork } from '../../src/background/page-scripts';
import { createTranslator } from '../../src/i18n/translate';

const t = createTranslator('en');
const tab = (title: string, reason: UnsavedTab['reason'] = 'form'): UnsavedTab => ({
  tabId: 1,
  appId: 'a',
  title,
  reason,
});

describe('the confirmation a switch needs', () => {
  it('lets ordinary switches go ahead', () => {
    expect(
      askText(t, { kind: 'account', label: 'Work', app: 'Acme', important: [], unsaved: [], confirmAll: false }),
    ).toBeNull();
    expect(
      askText(t, { kind: 'fresh', label: 'Acme', app: 'Acme', important: [], unsaved: [], confirmAll: true }),
    ).toBeNull();
  });

  it('puts important accounts first and adds the work that would be lost', () => {
    const text = askText(t, {
      kind: 'account',
      label: 'Prod',
      app: 'Acme',
      important: ['Acme: Prod'],
      unsaved: [tab('SQL editor', 'typing')],
      confirmAll: false,
    })!;
    expect(text.title).toBe('Switch to an important account?');
    expect(text.body).toContain('"Prod" on Acme is marked important');
    expect(text.body).toContain('reloads these Acme tabs');
    expect(text.items).toEqual(['SQL editor — text being typed']);
    expect(text).toMatchObject({ confirm: 'Switch anyway', danger: true });
  });

  it('asks about unsaved work alone, for workspaces and fresh sign-ins too', () => {
    const work = askText(t, {
      kind: 'account',
      label: 'Work',
      app: 'Acme',
      important: [],
      unsaved: [tab('Draft')],
      confirmAll: false,
    })!;
    expect(work).toMatchObject({ title: 'Unsaved work', items: ['Draft — edited form'], danger: true });
    const workspace = askText(t, {
      kind: 'workspace',
      label: 'Client',
      important: [],
      unsaved: [tab('Docs', 'warning')],
      confirmAll: false,
    })!;
    expect(workspace.body).toContain('Switching reloads these tabs');
    expect(workspace.items).toEqual(['Docs — asks before you leave']);
    const fresh = askText(t, {
      kind: 'fresh',
      label: 'Acme',
      app: 'Acme',
      important: [],
      unsaved: [tab('Draft')],
      confirmAll: false,
    })!;
    expect(fresh.body).toContain('Signing in with another account');
  });

  it('honours "ask before every switch" without alarming', () => {
    const plain = askText(t, {
      kind: 'account',
      label: 'Work',
      app: 'Acme',
      important: [],
      unsaved: [],
      confirmAll: true,
    })!;
    expect(plain).toMatchObject({ title: 'Switch to Work', confirm: 'Switch', danger: false, items: [] });
    const workspace = askText(t, {
      kind: 'workspace',
      label: 'Client',
      important: ['Acme: Prod'],
      unsaved: [],
      confirmAll: false,
    })!;
    expect(workspace).toMatchObject({ title: 'Switch to "Client"?', danger: true });
    expect(workspace.body).toContain('Acme: Prod');
  });

  it('keeps the setting on unless turned off', () => {
    expect(parseSettings({}).guardUnsaved).toBe(true);
    expect(parseSettings({ guardUnsaved: false }).guardUnsaved).toBe(false);
  });
});

describe('finding unsaved work on a page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.onbeforeunload = null;
    vi.restoreAllMocks();
  });

  it("sees the page's own leave warning, either style", () => {
    expect(unsavedWork()).toEqual({ dirty: false, reason: null });
    const modern = (event: Event) => {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    };
    window.addEventListener('beforeunload', modern);
    expect(unsavedWork()).toEqual({ dirty: true, reason: 'warning' });
    window.removeEventListener('beforeunload', modern);
    window.onbeforeunload = () => 'You have unsaved changes';
    expect(unsavedWork()).toEqual({ dirty: true, reason: 'warning' });
  });

  it('sees edited fields and text being typed, not search boxes', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    document.body.innerHTML = `
      <input id="search" type="text" placeholder="Search projects" />
      <input id="name" type="text" value="Acme" />
      <div id="editor" contenteditable="true"></div>`;
    (document.getElementById('search') as HTMLInputElement).value = 'billing';
    expect(unsavedWork().dirty).toBe(false);
    (document.getElementById('name') as HTMLInputElement).value = 'Acme Corp';
    expect(unsavedWork()).toEqual({ dirty: true, reason: 'form' });
    (document.getElementById('name') as HTMLInputElement).value = 'Acme';
    const editor = document.getElementById('editor')!;
    editor.textContent = 'half a sentence';
    editor.focus();
    // jsdom doesn't implement isContentEditable.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    expect(unsavedWork()).toEqual({ dirty: true, reason: 'typing' });
  });
});

describe('asking on the page', () => {
  const content = {
    title: 'Switch?',
    body: 'Body',
    items: ['Draft'],
    confirm: 'Switch',
    cancel: 'Cancel',
    danger: true,
    theme: 'light' as const,
    timeoutMs: 1000,
  };

  it('answers no on Escape or after a while, and leaves nothing behind', async () => {
    const answer = askOnPage(content);
    expect(document.getElementById('swapdeck-ask')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(answer).resolves.toBe(false);
    expect(document.getElementById('swapdeck-ask')).toBeNull();

    vi.useFakeTimers();
    const late = askOnPage(content);
    vi.advanceTimersByTime(1000);
    await expect(late).resolves.toBe(false);
    vi.useRealTimers();
  });
});
