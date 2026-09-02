import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import router, { runAuthGuard } from './index';
import { useAuthStore } from '../stores/auth';

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

// Stub out the page-level dynamic imports — they pull in element-plus and
// the full app graph. We only exercise the guard.
vi.mock('../pages/AppLayout.vue', () => ({ default: { name: 'AppLayout' } }));
vi.mock('../pages/DashboardPage.vue', () => ({ default: { name: 'DashboardPage' } }));
vi.mock('../pages/ProjectListPage.vue', () => ({ default: { name: 'ProjectListPage' } }));
vi.mock('../pages/ResourceCatalogPage.vue', () => ({ default: { name: 'ResourceCatalogPage' } }));
vi.mock('../pages/ProjectCreatePage.vue', () => ({ default: { name: 'ProjectCreatePage' } }));
vi.mock('../pages/ProjectDetailPage.vue', () => ({ default: { name: 'ProjectDetailPage' } }));
vi.mock('../pages/DeployTargetListPage.vue', () => ({ default: { name: 'DeployTargetListPage' } }));
vi.mock('../pages/DeployTargetsPage.vue', () => ({ default: { name: 'DeployTargetsPage' } }));
vi.mock('../pages/DeploymentListPage.vue', () => ({ default: { name: 'DeploymentListPage' } }));
vi.mock('../pages/DeploymentDetailPage.vue', () => ({ default: { name: 'DeploymentDetailPage' } }));
vi.mock('../pages/EnvironmentListPage.vue', () => ({ default: { name: 'EnvironmentListPage' } }));
vi.mock('../pages/TestCaseListPage.vue', () => ({ default: { name: 'TestCaseListPage' } }));
vi.mock('../pages/TestRunListPage.vue', () => ({ default: { name: 'TestRunListPage' } }));
vi.mock('../pages/TestRunDetailPage.vue', () => ({ default: { name: 'TestRunDetailPage' } }));
vi.mock('../pages/IssueListPage.vue', () => ({ default: { name: 'IssueListPage' } }));
vi.mock('../pages/IssueDetailPage.vue', () => ({ default: { name: 'IssueDetailPage' } }));
vi.mock('../pages/ReleaseListPage.vue', () => ({ default: { name: 'ReleaseListPage' } }));
vi.mock('../pages/ReleaseDetailPage.vue', () => ({ default: { name: 'ReleaseDetailPage' } }));
vi.mock('../pages/AuditLogPage.vue', () => ({ default: { name: 'AuditLogPage' } }));
vi.mock('../pages/NotificationCenterPage.vue', () => ({ default: { name: 'NotificationCenterPage' } }));
vi.mock('../pages/MemberListPage.vue', () => ({ default: { name: 'MemberListPage' } }));
vi.mock('../pages/SettingsPage.vue', () => ({ default: { name: 'SettingsPage' } }));
vi.mock('../pages/InitPage.vue', () => ({ default: { name: 'InitPage' } }));
vi.mock('../pages/LoginPage.vue', () => ({ default: { name: 'LoginPage' } }));

function buildJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('router auth guard (KI-009)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.clear();
  });

  it('redirects an unauthenticated user from a protected route to /login', () => {
    const auth = useAuthStore();
    expect(auth.user).toBeNull();
    const decision = runAuthGuard({ path: '/projects' } as any);
    expect(decision).toEqual({ path: '/login' });
  });

  it('redirects from deeply nested protected routes to /login', () => {
    const decision = runAuthGuard({ path: '/projects/proj-1/deploy-targets' } as any);
    expect(decision).toEqual({ path: '/login' });
  });

  it('lets /login through even when unauthenticated', () => {
    const decision = runAuthGuard({ path: '/login' } as any);
    expect(decision).toBe(true);
  });

  it('lets /init through even when unauthenticated', () => {
    const decision = runAuthGuard({ path: '/init' } as any);
    expect(decision).toBe(true);
  });

  it('lets a protected route through after restoreSession hydrates the user', () => {
    const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER' });
    localStorage.setItem('accessToken', token);

    // Pinia store is shared per beforeEach: restoreSession must populate
    // auth.user before the guard's auth.user check.
    const decision = runAuthGuard({ path: '/projects' } as any);
    expect(decision).toBe(true);
    const auth = useAuthStore();
    expect(auth.user?.id).toBe('u-1');
    expect(auth.workspace?.id).toBe('w-1');
  });

  it('redirects to /login when restoreSession finds an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER', exp: past });
    localStorage.setItem('accessToken', token);

    const decision = runAuthGuard({ path: '/projects' } as any);
    expect(decision).toEqual({ path: '/login' });
    const auth = useAuthStore();
    expect(auth.user).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('exports the runAuthGuard function the router is wired to', () => {
    // Sanity: the default export must be the same router object that we
    // import, and runAuthGuard must be reachable as a named export.
    expect(typeof runAuthGuard).toBe('function');
    expect(router).toBeDefined();
    expect((router as any).currentRoute).toBeDefined();
  });

  it('keeps every declared lazy route component loadable', async () => {
    const loaders = router
      .getRoutes()
      .map((route) => route.components?.default)
      .filter((component): component is () => Promise<unknown> => typeof component === 'function');

    expect(loaders).toHaveLength(25);
    const loaded = await Promise.all(loaders.map((load) => load()));
    expect(loaded).toHaveLength(loaders.length);
    expect(loaded.every(Boolean)).toBe(true);
  });

  // ── B.1  Initial state scenarios ─────────────────────────────────────
  describe('B.1 — runAuthGuard initial state', () => {
    it('B.1.1 cold start with no tokens at all → redirect to /login', () => {
      const auth = useAuthStore();
      const decision = runAuthGuard({ path: '/projects/p1/issues' } as any);
      expect(decision).toEqual({ path: '/login' });
      expect(auth.user).toBeNull();
    });

    it('B.1.2 cold start with a valid JWT → restoreSession hydrates user, guard allows protected route', () => {
      const token = buildJwt({ uid: 'u-7', wid: 'w-7', role: 'ADMIN' });
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', 'rt-7');

      const auth = useAuthStore();
      const decision = runAuthGuard({ path: '/projects/p1' } as any);

      expect(decision).toBe(true);
      expect(auth.user).toEqual({ id: 'u-7', role: 'ADMIN' });
      expect(auth.workspace).toEqual({ id: 'w-7' });
    });

    it('B.1.3 cold start with a JWT lacking `wid` → user is hydrated but workspace stays null', () => {
      const token = buildJwt({ uid: 'u-9', role: 'DEVELOPER' });
      localStorage.setItem('accessToken', token);

      const auth = useAuthStore();
      const decision = runAuthGuard({ path: '/projects' } as any);

      expect(decision).toBe(true);
      expect(auth.user).toEqual({ id: 'u-9', role: 'DEVELOPER' });
      expect(auth.workspace).toBeNull();
    });
  });

  // ── B.2  Public vs protected boundary ────────────────────────────────
  describe('B.2 — public vs protected route boundary', () => {
    it('B.2.1 /login and /init are the only paths that pass through without a user', () => {
      const loginDecision = runAuthGuard({ path: '/login' } as any);
      const initDecision = runAuthGuard({ path: '/init' } as any);
      expect(loginDecision).toBe(true);
      expect(initDecision).toBe(true);
    });

    it('B.2.2 a protected path that is not in PUBLIC_PATHS redirects to /login when no user', () => {
      // Try three different non-public paths to demonstrate the rule.
      const samples = ['/', '/projects', '/deployments/d1', '/tests/runs', '/settings'];
      for (const path of samples) {
        const decision = runAuthGuard({ path } as any);
        expect(decision).toEqual({ path: '/login' });
      }
    });

    it('B.2.3 an authenticated user on /login is still allowed (no redirect loop)', () => {
      const token = buildJwt({ uid: 'u-1', wid: 'w-1', role: 'OWNER' });
      localStorage.setItem('accessToken', token);

      const decision = runAuthGuard({ path: '/login' } as any);
      expect(decision).toBe(true);
    });
  });
});
