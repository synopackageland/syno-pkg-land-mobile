// Builds the bridge spike into one IIFE file (Vue 3 and the UI SDK bundled in).
// Usage: UI_DIR=<path to a built @synopackageland/ui checkout> node spike/ext-bridge/build.mjs
// It resolves vue and vite from UI_DIR/node_modules, so this repo needs no new dependencies.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(process.env.UI_DIR || '../syno-pkg-land-ui');
const require = createRequire(join(ui, 'package.json'));
const { build } = await import(require.resolve('vite'));

await build({
  configFile: false,
  logLevel: 'warn',
  root: here,
  resolve: {
    alias: [
      { find: /^@synopackageland\/ui\/theme\.css/, replacement: join(ui, 'dist/theme.css') },
      { find: /^@synopackageland\/ui$/, replacement: join(ui, 'dist/index.js') },
      { find: /^vue$/, replacement: require.resolve('vue/dist/vue.runtime.esm-bundler.js') },
    ],
  },
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  build: {
    outDir: process.env.OUT_DIR || join(here, 'dist'),
    emptyOutDir: true,
    minify: true,
    lib: { entry: join(here, 'bridge.mjs'), formats: ['iife'], name: 'SplBridge', fileName: () => 'bridge.js' },
  },
});
