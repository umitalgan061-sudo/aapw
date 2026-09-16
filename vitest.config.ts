import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aapw': resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
