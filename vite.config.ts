import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      three: resolve(process.cwd(), 'src/3d/vendor/three/three.module.js'),
      'three/addons/': resolve(process.cwd(), 'src/3d/vendor/three/addons') + '/',
    },
  },
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
