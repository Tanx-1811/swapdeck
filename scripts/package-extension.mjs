// Zips the production build (dist/) into release/swapdeck-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json not found. Run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.host_permissions?.length) {
  console.error('Refusing to package a build with install-time host permissions (is this the e2e build?).');
  process.exit(1);
}

const out = resolve(root, 'release');
mkdirSync(out, { recursive: true });
const file = resolve(out, `swapdeck-${manifest.version}.zip`);
rmSync(file, { force: true });
execFileSync('zip', ['-r', '-X', '-q', file, '.', '-x', '*.map', '-x', '.DS_Store'], { cwd: dist, stdio: 'inherit' });
console.log(`Packaged ${file}`);
