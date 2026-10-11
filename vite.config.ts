import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** Yandex Games build: load the platform SDK (served by Yandex at /sdk.js) before the game. */
const yandexSdk = (): Plugin => ({
  name: 'yandex-sdk',
  transformIndexHtml: html => html.replace('<head>', '<head>\n  <script src="/sdk.js"></script>'),
});

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: mode === 'yandex' ? [yandexSdk()] : [],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    outDir: mode === 'yandex' ? 'dist-yandex' : 'dist',
  },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 120000,
  },
}));
