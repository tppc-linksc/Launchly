import type { Config } from 'jest';
import baseConfig from './jest.config';

// Coverage is a combined protection report: fast unit contracts plus the
// existing HTTP E2E suite that exercises controller wiring and authorization.
// The standalone E2E command remains available for startup-focused diagnosis.
const config: Config = {
  ...baseConfig,
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
};

export default config;
