#!/usr/bin/env node
// Writes public/THIRD_PARTY_NOTICES.txt: the licenses of the code and fonts
// bundled into the extension (they ship inside the store package):
//
//   node scripts/third-party-notices.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');

// Everything Vite bundles into dist/: React (with its scheduler), the icons and the three typefaces.
const BUNDLED = [
  'react',
  'react-dom',
  'scheduler',
  'lucide-react',
  '@fontsource/be-vietnam-pro',
  '@fontsource/fraunces',
  '@fontsource/jetbrains-mono',
];

const sections = BUNDLED.map((name) => {
  const dir = dirname(require.resolve(`${name}/package.json`, { paths: [root] }));
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].map((f) => join(dir, f)).find(existsSync);
  if (!file) throw new Error(`No license file for ${name}`);
  const text = readFileSync(file, 'utf8').trim();
  return `${name} ${pkg.version} — ${pkg.license}\n${pkg.homepage ?? ''}\n\n${text}`;
});

const out = join(root, 'public', 'THIRD_PARTY_NOTICES.txt');
writeFileSync(
  out,
  `Swapdeck is MIT-licensed (see LICENSE in the source repository). It bundles the following third-party software and fonts.\n\n${sections.join(`\n\n${'='.repeat(78)}\n\n`)}\n`,
);
console.log(`Wrote ${out}`);
