import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';
import { createManifest } from './src/manifest.ts';

const src = resolve(import.meta.dirname, 'src');

/** `SWAPDECK_OUT` lets parallel work build into a scratch folder without clobbering `dist`. */
const outDirFor = (mode: string) =>
  resolve(import.meta.dirname, process.env.SWAPDECK_OUT ?? (mode === 'e2e' ? 'dist-e2e' : 'dist'));

const defines = (mode: string) => ({
  __SWAPDECK_E2E__: JSON.stringify(mode === 'e2e'),
  'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
});

function manifestPlugin(mode: string): Plugin {
  return {
    name: 'swapdeck:manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(createManifest(mode), null, 2)}\n`,
      });
    },
  };
}

/**
 * Bundled fonts from @fontsource: keep only the Latin and Vietnamese subsets
 * (each with its unicode-range, so a page loads only what it shows) and drop
 * the WOFF fallbacks — Chrome always takes the WOFF2.
 */
function fontSubsetsPlugin(): Plugin {
  return {
    name: 'swapdeck:font-subsets',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].+\.css$/.test(id)) return null;
      const kept = code
        .split(/(?=\/\* [\w-]+ \*\/)/)
        .filter((block) => /^\/\* [\w-]+-(latin|vietnamese)-\d+-(normal|italic) \*\//.test(block));
      return { code: kept.join('').replace(/,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/g, ''), map: null };
    },
  };
}

/**
 * The service worker is bundled on its own after the main build (also on every
 * rebuild in watch mode), so it never shares a chunk with React page code.
 * The functions it injects into tabs with chrome.scripting are serialized by
 * Chrome, so they live in the worker bundle and must stay self-contained.
 */
function workerPlugin(mode: string, outDir: string): Plugin {
  return {
    name: 'swapdeck:worker',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        mode,
        publicDir: false,
        define: defines(mode),
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: 'chrome116',
          minify: mode === 'production',
          sourcemap: mode === 'production' ? false : 'inline',
          lib: {
            entry: resolve(src, 'background/service-worker.ts'),
            formats: ['es'],
            fileName: () => 'service-worker.js',
          },
        },
      });
    },
  };
}

// Multi-page extension build: toolbar popup, side panel and the full-page manager.
export default defineConfig(({ mode }) => ({
  root: src,
  base: '',
  publicDir: resolve(import.meta.dirname, 'public'),
  plugins: [fontSubsetsPlugin(), react(), manifestPlugin(mode), workerPlugin(mode, outDirFor(mode))],
  define: defines(mode),
  build: {
    outDir: outDirFor(mode),
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: mode !== 'production',
    minify: mode === 'production',
    // Chrome supports modulepreload natively; skip Vite's polyfill.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        popup: resolve(src, 'popup/popup.html'),
        options: resolve(src, 'options/options.html'),
        sidepanel: resolve(src, 'sidepanel/sidepanel.html'),
      },
      output: {
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
}));
