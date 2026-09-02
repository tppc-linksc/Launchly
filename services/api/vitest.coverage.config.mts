import { defineConfig } from 'vitest/config';
import { apiVitestConfig } from './vitest.shared';

// Coverage combines unit contracts with HTTP E2E tests so controller wiring
// and authorization stay part of the enforced baseline.
export default defineConfig({
  ...apiVitestConfig,
  test: {
    ...apiVitestConfig.test,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
  },
});
