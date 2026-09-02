import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';

// Mock localStorage for jsdom
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k in store) delete store[k];
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

vi.mock('../api/client', () => ({
  fetchSetupStatus: vi.fn(),
  logoutSession: vi.fn().mockResolvedValue({ data: { success: true } }),
}));

import { fetchSetupStatus } from '../api/client';
const mockFetchSetupStatus = vi.mocked(fetchSetupStatus);

// Tiny HS256-style JWT builder used by restoreSession tests.
function buildJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const auth = useAuthStore();
    expect(auth.initialized).toBeNull();
    expect(auth.user).toBeNull();
    expect(auth.workspace).toBeNull();
  });

  it('setAuth stores tokens in localStorage and sets user/workspace', () => {
    const auth = useAuthStore();
    auth.setAuth({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
      user: { id: 'u1', account: 'admin', role: 'OWNER' },
      workspace: { id: 'w1', name: 'Test' },
    });

    expect(localStorage.getItem('accessToken')).toBe('at-123');
    expect(localStorage.getItem('refreshToken')).toBe('rt-456');
    expect(auth.user).toEqual({ id: 'u1', account: 'admin', role: 'OWNER' });
    expect(auth.workspace).toEqual({ id: 'w1', name: 'Test' });
  });

  it('logout clears tokens and user state', () => {
    const auth = useAuthStore();
    auth.setAuth({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
      user: { id: 'u1' },
      workspace: { id: 'w1' },
    });

    auth.logout();

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken');
    expect(auth.user).toBeNull();
    expect(auth.workspace).toBeNull();
  });

  it('checkSetupStatus sets initialized to true when API returns true', async () => {
    mockFetchSetupStatus.mockResolvedValue({ data: { initialized: true } } as any);
    const auth = useAuthStore();
    await auth.checkSetupStatus();
    expect(auth.initialized).toBe(true);
  });

  it('checkSetupStatus sets initialized to false on error', async () => {
    mockFetchSetupStatus.mockRejectedValue(new Error('network'));
    const auth = useAuthStore();
    await auth.checkSetupStatus();
    expect(auth.initialized).toBe(false);
  });

  // KI-009: restoreSession — the failure paths were the whole reason this
  // method exists. The existing "user appears logged out after refresh"
  // behavior is exactly what these tests guard against.
  describe('restoreSession (KI-009 — page reload recovery)', () => {
    it('rehydrates user/workspace from a valid JWT and returns true', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'ADMIN' });
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', 'rt');

      const auth = useAuthStore();
      const ok = auth.restoreSession();

      expect(ok).toBe(true);
      expect(auth.user).toEqual({ id: 'u-1', role: 'ADMIN' });
      expect(auth.workspace).toEqual({ id: 'w-1' });
    });

    it('returns false and leaves state untouched when no access token is stored', () => {
      const auth = useAuthStore();
      const ok = auth.restoreSession();

      expect(ok).toBe(false);
      expect(auth.user).toBeNull();
      expect(auth.workspace).toBeNull();
    });

    it('ignores a malformed JWT without throwing and leaves state null', () => {
      localStorage.setItem('accessToken', 'not-a-jwt');
      const auth = useAuthStore();

      expect(() => auth.restoreSession()).not.toThrow();
      expect(auth.user).toBeNull();
      expect(auth.workspace).toBeNull();
    });

    it('rejects a JWT whose payload is missing the uid and returns false', () => {
      const token = buildJwt({ wid: 'w-1' });
      localStorage.setItem('accessToken', token);
      const auth = useAuthStore();

      expect(auth.restoreSession()).toBe(false);
      expect(auth.user).toBeNull();
    });

    it('rejects an expired JWT, clears tokens, and returns false', () => {
      const past = Math.floor(Date.now() / 1000) - 60;
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER', exp: past });
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', 'rt');
      const auth = useAuthStore();

      expect(auth.restoreSession()).toBe(false);
      expect(auth.user).toBeNull();
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('falls back to VIEWER role when the payload omits role', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1' });
      localStorage.setItem('accessToken', token);
      const auth = useAuthStore();
      auth.restoreSession();

      expect(auth.user).toEqual({ id: 'u-1', role: 'VIEWER' });
    });

    it('C.1.1 restoreSession reads the LATEST accessToken from localStorage on every call (token rotation)', () => {
      const auth = useAuthStore();

      // First restore: initial token.
      const first = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER' });
      localStorage.setItem('accessToken', first);
      auth.restoreSession();
      expect(auth.user).toEqual({ id: 'u-1', role: 'OWNER' });

      // Simulate a token rotation: setItem replaces the stored value.
      const second = buildJwt({ uid: 'u-2', wid: 'w-2', role: 'ADMIN' });
      localStorage.setItem('accessToken', second);
      auth.restoreSession();

      expect(auth.user).toEqual({ id: 'u-2', role: 'ADMIN' });
      expect(auth.workspace).toEqual({ id: 'w-2' });
    });

    it('C.1.2 restoreSession is idempotent — calling it twice with the same token is a no-op the second time', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER' });
      localStorage.setItem('accessToken', token);
      const auth = useAuthStore();

      const first = auth.restoreSession();
      const second = auth.restoreSession();

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(auth.user).toEqual({ id: 'u-1', role: 'OWNER' });
      expect(auth.workspace).toEqual({ id: 'w-1' });
    });

    it('C.1.3 a JWT with no `exp` claim is treated as not expired and hydrates the user', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER' });
      // No exp field — verify the buildJwt indeed omitted it
      const payload = JSON.parse(atob(token.split('.')[1]));
      expect(payload.exp).toBeUndefined();
      localStorage.setItem('accessToken', token);

      const auth = useAuthStore();
      const ok = auth.restoreSession();

      expect(ok).toBe(true);
      expect(auth.user).toEqual({ id: 'u-1', role: 'OWNER' });
      expect(auth.workspace).toEqual({ id: 'w-1' });
      expect(localStorage.getItem('accessToken')).toBe(token);
    });

    it('C.1.4 restoreSession on a payload with non-numeric `exp` does not throw and still hydrates the user', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER', exp: 'soon' as any });
      localStorage.setItem('accessToken', token);

      const auth = useAuthStore();
      expect(() => auth.restoreSession()).not.toThrow();
      expect(auth.user).toEqual({ id: 'u-1', role: 'OWNER' });
    });
  });
});
