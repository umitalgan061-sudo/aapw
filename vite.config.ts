import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2024',
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: 'src/3d/modern/bootstrap.ts',
    },
  },
  server: {
    strictPort: true,
    port: 4173,
  },
  esbuild: {
    target: 'es2024',
  },
});
