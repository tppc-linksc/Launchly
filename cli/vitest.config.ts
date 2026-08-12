import { defineConfig } from 'vitest/config';

// TEST-000: 统一 CLI 覆盖率。统计 src 下全部 ts(包括 index.ts),
// 即使未被 import 也以 0% 计入分母。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/__tests__/**',
      ],
      all: true,
      clean: true,
    },
  },
});
