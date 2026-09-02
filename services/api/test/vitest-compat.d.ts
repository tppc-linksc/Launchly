import type { Mock as VitestMock, Mocked as VitestMocked, MockInstance as VitestMockInstance } from 'vitest';

declare global {
  namespace vi {
    type Mock<Return = any, Args extends any[] = any[]> = VitestMock<(...args: Args) => Return>;
    type Mocked<T> = VitestMocked<T>;
    type SpyInstance<Fn extends (...args: any[]) => any = (...args: any[]) => any> = VitestMockInstance<Fn>;
  }
}

export {};
