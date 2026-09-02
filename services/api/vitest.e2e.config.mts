import { defineConfig } from 'vitest/config';
import { apiTypeScriptTranspile } from './vitest.shared';

export default defineConfig({
  esbuild: false,
  plugins: [apiTypeScriptTranspile],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
  },
});
