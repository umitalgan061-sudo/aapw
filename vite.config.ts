import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  build: {
    target: 'es2024',
    sourcemap: true,
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      input: {
        main: 'index.html',
        game3d: 'game3d.html',
        modern: 'modern.html',
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('/node_modules/')) return 'vendor';
          if (id.includes('/src/3d/audio/')) return 'audio-runtime';
          if (id.includes('/src/3d/gameplay/')) return 'gameplay-runtime';
          if (id.includes('/src/3d/')) return 'world-runtime';
          if (id.includes('/src/core/')) return 'core-runtime';
          return undefined;
        },
      },
    },
  },
  server: {
    strictPort: true,
    host: true,
  },
  preview: {
    strictPort: true,
    host: true,
  },
});
