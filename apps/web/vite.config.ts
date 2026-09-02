/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import ElementPlus from 'unplugin-element-plus/vite';

function webManualChunks(id: string) {
  if (!id.includes('node_modules')) return undefined;
  // Keep Element Plus component modules independently cacheable. A single
  // vendor chunk grows beyond the warning threshold as the app adds pages;
  // component-level chunks preserve tree-shaking and avoid eagerly loading
  // unrelated widgets.
  const elementPlusComponent = id.match(/\/element-plus\/es\/components\/([^/]+)/);
  if (elementPlusComponent) return `vendor-element-plus-${elementPlusComponent[1]}`;
  if (id.includes('/element-plus/') || id.includes('/@element-plus/')) {
    return 'vendor-element-plus-shared';
  }
  if (id.includes('/@vueuse/')) return 'vendor-vueuse';
  if (id.includes('/@vue/') || id.includes('/vue-demi/')) return 'vendor-vue';
  return 'vendor';
}

export default defineConfig(({ mode }) => {
  // Vitest sets VITEST and mode=test. Keep component auto-import plugins out
  // of unit tests: page specs install Element Plus explicitly and should not
  // load production CSS through the Node/jsdom transform pipeline.
  const isTest = mode === 'test' || process.env.VITEST === 'true';

  return {
    plugins: [
      vue(),
      ...(!isTest
        ? [
            Components({
              resolvers: [ElementPlusResolver()],
              dts: false,
            }),
            ElementPlus(),
          ]
        : []),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: webManualChunks,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
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
  };
});
