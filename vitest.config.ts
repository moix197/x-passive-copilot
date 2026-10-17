import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@xc/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) },
  },
  test: {
    passWithNoTests: true,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
