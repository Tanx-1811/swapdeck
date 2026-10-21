#!/usr/bin/env node
// Writes the password-protected backup the Swift tests decrypt, using the
// extension's own encryption (src/core/crypto.ts), so the desktop import is
// checked against the real format:
//
//   node desktop/scripts/make-backup-fixture.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encryptWithPassword } from '../../src/core/crypto.ts';

const payload = {
  apps: [],
  accounts: [],
  active: {},
  settings: {},
  sessions: {},
  workspaces: [
    {
      id: 'ws_acme',
      name: 'Khách hàng Acme',
      color: '#94661a',
      icon: 'handshake',
      members: {},
      links: [{ id: 'p1', title: 'Acme', url: 'https://app.acme.example/' }],
      order: 0,
      createdAt: 1,
      switchCount: 0,
    },
    {
      id: 'ws_me',
      name: 'Cá nhân',
      color: '#2f4e86',
      icon: 'house',
      members: {},
      links: [],
      order: 1,
      createdAt: 1,
      switchCount: 0,
    },
  ],
};

const file = {
  format: 'swapdeck-backup',
  version: 1,
  createdAt: 1_760_000_000_000,
  encrypted: true,
  payload: await encryptWithPassword(JSON.stringify(payload), 'mật khẩu đúng 123'),
};
const out = resolve(import.meta.dirname, '../Tests/SwapdeckCoreTests/Fixtures/encrypted-backup.json');
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`Wrote ${out}`);
