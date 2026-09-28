import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const VENDORED_THREE = fileURLToPath(new URL('./src/3d/vendor/three/three.module.js', import.meta.url));
const VENDORED_THREE_ADDONS = fileURLToPath(new URL('./src/3d/vendor/three/addons', import.meta.url));

export default defineConfig({
  appType: 'mpa',
  resolve: {
    alias: [
      { find: /^three$/, replacement: VENDORED_THREE },
      { find: /^three\/addons(?:\/|$)/, replacement: `${VENDORED_THREE_ADDONS}/` },
    ],
  },
  build: {
    target: 'es2024',
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        game3d: 'game3d.html',
        rts: 'rts.html',
      },
    },
  },
  server: {
    host: true,
    strictPort: true,
    port: 4173,
  },
  preview: {
    host: true,
    strictPort: true,
    port: 4173,
  },
});
