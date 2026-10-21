// Renders the extension icons the manifest references.
// 16 and 32 px come from assets/icon-small.svg, a simplified, pixel-aligned
// drawing that stays crisp in the toolbar; 48 and 128 px from assets/icon.svg.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const SOURCES = [
  { file: '../assets/icon-small.svg', sizes: [16, 32] },
  { file: '../assets/icon.svg', sizes: [48, 128] },
];
const outDir = new URL('../public/icons/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const { file, sizes } of SOURCES) {
  const svg = await readFile(new URL(file, import.meta.url));
  for (const size of sizes) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    await writeFile(new URL(`icon-${size}.png`, outDir), png);
    console.log(`icons/icon-${size}.png  (${file.split('/').pop()})`);
  }
}
