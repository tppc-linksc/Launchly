/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // TEST-000: 统一 Web 覆盖率。统计 src 下全部 ts/vue,即使未被 import 也以 0% 计入分母。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.vue'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      all: true,
      clean: true,
      thresholds: {
        statements: 94,
        branches: 84,
        functions: 70,
        lines: 94,
      },
    },
  },
});
