import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks parts of <dialog>.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/** A minimal in-memory chrome.storage area. */
function storageArea() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined)
        return Object.fromEntries([...store].map(([k, v]) => [k, structuredClone(v)]));
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list.filter((key) => store.has(key)).map((key) => [key, structuredClone(store.get(key))]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) store.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    }),
    clear: vi.fn(async () => store.clear()),
  };
}

const local = storageArea();
const session = storageArea();

const chromeMock = {
  storage: {
    local,
    session,
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  i18n: { getUILanguage: () => 'en-US' },
  runtime: {
    id: 'test-extension',
    getURL: (path: string) => `chrome-extension://test-extension${path.startsWith('/') ? '' : '/'}${path}`,
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: vi.fn(async () => ({ ok: false, error: 'UNKNOWN' })),
  },
  alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

Object.assign(globalThis, { chrome: chromeMock });

afterEach(() => {
  local.store.clear();
  session.store.clear();
});
