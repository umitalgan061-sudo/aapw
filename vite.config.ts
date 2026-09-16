import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
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
