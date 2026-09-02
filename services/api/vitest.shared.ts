import ts from 'typescript';
import type { UserConfig } from 'vitest/config';

// Vite's esbuild transform deliberately does not emit TypeScript decorator
// metadata. Nest's dependency injector needs that metadata for constructor
// parameters, so pre-transform project TypeScript with the compiler already
// used by this package before Vite processes the resulting JavaScript.
export const apiTypeScriptTranspile = {
  name: 'launchly-api-typescript-transpile',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (
      !id.endsWith('.ts') ||
      id.endsWith('.d.ts') ||
      id.includes('/node_modules/') ||
      // Keep this idempotent if another plugin feeds our output back through
      // Vite's transform pipeline.
      code.includes('__decorate') ||
      code.includes('__metadata')
    ) {
      return undefined;
    }

    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        sourceMap: true,
      },
      fileName: id,
    });

    return { code: result.outputText, map: result.sourceMapText };
  },
};

// TEST-000: The API coverage baseline includes all production source files.
// Startup is verified separately, so only the bootstrap module is excluded.
export const apiVitestConfig = {
  // Vite's esbuild pass renames `let Controller = class Controller` emitted
  // by TypeScript to `class Controller2`. Nest exposes that class name in its
  // runtime metadata, so compile every API TypeScript module here and prevent
  // a second TypeScript pass from changing its identity.
  esbuild: false as const,
  plugins: [apiTypeScriptTranspile],
  test: {
    globals: true,
    environment: 'node' as const,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8' as const,
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
        'src/**/__fixtures__/**',
      ],
      all: true,
      clean: true,
      thresholds: {
        statements: 82,
        branches: 70,
        functions: 80,
        lines: 82,
      },
    },
  },
} satisfies UserConfig;
