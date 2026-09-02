import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // TEST-000: 统一覆盖率口径。统计全部生产源码,Module/DTO/Controller/Service/Worker/Runner/Guard/Filter/Config 不得被默认排除。
  // 仅允许排除: src/main.ts(后续生产启动烟雾测试负责)、spec/test、Prisma 客户端生成目录、测试辅助文件。
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
    '!src/**/__fixtures__/**',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'json-summary'],
  coverageDirectory: './coverage',
  // R0 floor plus the higher verified statement/line baseline. Coverage combines
  // unit contracts with the existing HTTP E2E suite (see jest.coverage.config.ts).
  coverageThreshold: {
    global: {
      statements: 82,
      branches: 70,
      functions: 80,
      lines: 82,
    },
  },
  testEnvironment: 'node',
};

export default config;
