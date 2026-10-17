import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sharedFile = (name: string) =>
  fileURLToPath(new URL(`./shared/src/${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@xc\/shared\/types$/, replacement: sharedFile('types.ts') },
      { find: /^@xc\/shared$/, replacement: sharedFile('index.ts') },
    ],
  },
  test: {
    passWithNoTests: true,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
