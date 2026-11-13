import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000, hookTimeout: 120000, pool: 'forks' },
});
