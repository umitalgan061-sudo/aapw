import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  appType: 'mpa',
  build: {
    target: 'es2024',
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        game3d: resolve(import.meta.dirname, 'game3d.html'),
        rts: resolve(import.meta.dirname, 'rts.html'),
      },
    },
  },
  esbuild: { target: 'es2024' },
});
