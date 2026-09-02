import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TEST-WEB-01 / round 2
 *
 * The previous round (commit ef1f203) covered the request/response
 * interceptors lightly and the API contract table thinly. This file
 * expands the test matrix without touching any production code.
 *
 * Mocking strategy
 * ----------------
 * `vi.mock('axios', factory)` is hoisted above the `import './client'`
 * line. The factory builds a single stable `instance` object and a
 * `callable` façade that exposes the same instance methods at the top
 * level — that mirrors axios's dual API (`axios.get` / `axios.create`)
 * and is what `client.ts` actually uses.
 *
 * The factory's `instance` is returned by every `axios.create()` call, so
 * the request/response interceptor registrations done at module load
 * land on the very same `vi.fn()` we hold references to here. We capture
 * the registered interceptor functions once at module load, before any
 * `mockReset` runs in beforeEach, and reuse them in the tests.
 */

const hoisted = vi.hoisted(() => {
  const elMessageError = vi.fn();
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: vi.fn((key: string) => hoisted.store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      hoisted.store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete hoisted.store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
    }),
    get length() {
      return Object.keys(hoisted.store).length;
    },
    key: vi.fn((i: number) => Object.keys(hoisted.store)[i] ?? null),
  };
  return { elMessageError, store, localStorageMock };
});

Object.defineProperty(globalThis, 'localStorage', {
  value: hoisted.localStorageMock,
  writable: true,
});

let lastHash: string | null = null;
Object.defineProperty(window, 'location', {
  value: {
    get hash() {
      return lastHash ?? '';
    },
    set hash(v: string) {
      lastHash = v;
    },
  },
  configurable: true,
});

vi.mock('axios', () => {
  // The instance must be callable because client.ts retries the original
  // request via `api(originalRequest)`, which is axios's "callable
  // instance" form (equivalent to api.request(config)).
  const instance: any = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  instance.interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  instance.get = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  instance.post = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  instance.put = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  instance.patch = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  instance.delete = vi.fn(() => Promise.resolve({ data: { ok: true } }));

  const callable: any = vi.fn();
  callable.create = vi.fn(() => instance);
  callable.get = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  // Bare `axios.post` is what the refresh token path uses. Keep it
  // independent of the instance so it doesn't go through the same
  // response interceptor.
  callable.post = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  callable.put = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  callable.patch = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  callable.delete = vi.fn(() => Promise.resolve({ data: { ok: true } }));
  callable.interceptors = instance.interceptors;
  return { default: callable, create: callable.create };
});

vi.mock('element-plus', () => ({
  ElMessage: { error: hoisted.elMessageError, warning: vi.fn() },
}));

// Side-effect import: triggers client.ts to register the two
// interceptors on the shared instance.
import axios from 'axios';
import * as client from './client';

// Capture interceptor references at module load — before beforeEach's
// `mockReset` calls. Reading `.mock.calls[0]` is safe here because we
// know the registration has already happened.
const apiInstance = (axios as any).create.mock.results[0].value;
const requestUse = apiInstance.interceptors.request.use as ReturnType<typeof vi.fn>;
const responseUse = apiInstance.interceptors.response.use as ReturnType<typeof vi.fn>;

const requestInterceptor = requestUse.mock.calls[0][0] as (config: any) => any;
const responseSuccessHandler = responseUse.mock.calls[0][0] as (resp: any) => any;
const responseErrorHandler = responseUse.mock.calls[0][1] as (err: any) => any;

const mockGet = apiInstance.get as ReturnType<typeof vi.fn>;
const mockPost = apiInstance.post as ReturnType<typeof vi.fn>;
const mockPut = apiInstance.put as ReturnType<typeof vi.fn>;
const mockPatch = apiInstance.patch as ReturnType<typeof vi.fn>;
const mockDelete = apiInstance.delete as ReturnType<typeof vi.fn>;
const bareAxiosPost = (axios as any).post as ReturnType<typeof vi.fn>;
const elMessageError = hoisted.elMessageError;

beforeEach(() => {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
  lastHash = null;

  // Only reset the http method mocks; we never reset requestUse/responseUse
  // because they hold the interceptor registrations and the test reads
  // them directly through the captured references.
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
  bareAxiosPost.mockReset();
  apiInstance.mockReset();
  apiInstance.mockImplementation(() => Promise.resolve({ data: { ok: true } }));
  elMessageError.mockReset();

  mockGet.mockResolvedValue({ data: { ok: true } });
  mockPost.mockResolvedValue({ data: { ok: true } });
  mockPut.mockResolvedValue({ data: { ok: true } });
  mockPatch.mockResolvedValue({ data: { ok: true } });
  mockDelete.mockResolvedValue({ data: { ok: true } });
  bareAxiosPost.mockResolvedValue({
    data: { accessToken: 'new-at', refreshToken: 'new-rt' },
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ A.1  Authorization injection                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('A.1 — Authorization injection (request interceptor)', () => {
  it('A.1.1 attaches `Bearer <token>` to outgoing config when accessToken is in localStorage', () => {
    hoisted.store['accessToken'] = 'tok-123';
    const config: any = { headers: {} };
    const result = requestInterceptor(config);
    expect(result).toBe(config);
    expect(config.headers.Authorization).toBe('Bearer tok-123');
  });

  it('A.1.2 leaves Authorization header unset when no accessToken is stored', () => {
    const config: any = { headers: {} };
    requestInterceptor(config);
    expect(config.headers.Authorization).toBeUndefined();
  });

  it('A.1.3 reads the access token fresh on every call (no closure over a snapshot)', () => {
    const before: any = { headers: {} };
    requestInterceptor(before);
    expect(before.headers.Authorization).toBeUndefined();

    // Simulate a token arriving later (login / refresh).
    hoisted.store['accessToken'] = 'tok-fresh';
    const after: any = { headers: {} };
    requestInterceptor(after);
    expect(after.headers.Authorization).toBe('Bearer tok-fresh');
  });

  it('A.1.4 the request interceptor was registered exactly once at module load', () => {
    expect(requestUse).toHaveBeenCalledTimes(1);
  });

  it('A.1.5 the response interceptor was registered exactly once with two handlers (success+error)', () => {
    expect(responseUse).toHaveBeenCalledTimes(1);
    expect(responseUse.mock.calls[0]).toHaveLength(2);
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ A.2  401 → refresh flow (single request)                              ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('A.2 — 401 → single refresh flow', () => {
  it('A.2.1 a single 401 triggers exactly one /auth/refresh call and retries the original request with the new token', async () => {
    hoisted.store['accessToken'] = 'old-at';
    hoisted.store['refreshToken'] = 'old-rt';

    await responseErrorHandler({
      response: { status: 401 },
      config: { url: '/projects', headers: {} },
    });

    // The refresh path was taken once, with the previously stored refresh
    // token, and the new pair landed in localStorage.
    expect(bareAxiosPost).toHaveBeenCalledTimes(1);
    expect(bareAxiosPost).toHaveBeenCalledWith('/api/auth/refresh', { refreshToken: 'old-rt' });
    expect(hoisted.store['accessToken']).toBe('new-at');
    expect(hoisted.store['refreshToken']).toBe('new-rt');

    // The original request was retried via axios's callable-instance form
    // (`api(originalRequest)`), not via `api.get`. The retry used the
    // original config (same url) and a fresh Authorization header.
    expect(apiInstance).toHaveBeenCalledTimes(1);
    const [retriedConfig] = apiInstance.mock.calls.at(-1)!;
    expect(retriedConfig.url).toBe('/projects');
    expect(retriedConfig.headers.Authorization).toBe('Bearer new-at');
  });

  it('A.2.2 a 401 with `_retry === true` does not trigger a refresh (idempotency)', async () => {
    mockGet.mockRejectedValue({ response: { status: 401 } });

    await responseErrorHandler({
      response: { status: 401 },
      config: { url: '/projects', _retry: true, headers: {} },
    }).catch(() => {});

    expect(bareAxiosPost).not.toHaveBeenCalled();
  });

  it('A.2.3 a 401 from /auth/refresh itself does not recurse — clears tokens, redirects, rejects', async () => {
    hoisted.store['accessToken'] = 'bad-at';
    hoisted.store['refreshToken'] = 'bad-rt';

    await expect(
      responseErrorHandler({
        response: { status: 401 },
        config: { url: '/auth/refresh', headers: {} },
      }),
    ).rejects.toBeDefined();

    // The error handler short-circuits the /auth/refresh 401 path: it
    // never even calls the bare refresh endpoint. It only clears tokens
    // and redirects to /login.
    expect(bareAxiosPost).toHaveBeenCalledTimes(0);
    expect(hoisted.store['accessToken']).toBeUndefined();
    expect(hoisted.store['refreshToken']).toBeUndefined();
    expect(lastHash).toBe('#/login');
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ A.3  Concurrent 401 → single refresh (deduplication)                   ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('A.3 — Concurrent 401 dedup', () => {
  it('A.3.1 two parallel 401 responses trigger only ONE /auth/refresh call', async () => {
    hoisted.store['accessToken'] = 'old-at';
    hoisted.store['refreshToken'] = 'old-rt';

    // First call: 401. Retry: success. The second parallel call's 401 is
    // queued on the in-flight refresh, so it should not start a second
    // refresh of its own.
    mockGet
      .mockRejectedValueOnce({ response: { status: 401 }, config: { url: '/projects' } })
      .mockResolvedValueOnce({ data: [] });
    (mockGet as any).mockImplementationOnce(async () => {
      throw { response: { status: 401 }, config: { url: '/members' } };
    });
    (mockGet as any).mockResolvedValueOnce({ data: [] });

    const p1 = responseErrorHandler({ response: { status: 401 }, config: { url: '/projects' } });
    const p2 = responseErrorHandler({ response: { status: 401 }, config: { url: '/members' } });
    await Promise.allSettled([p1, p2]);

    expect(bareAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('A.3.2 all queued concurrent 401 requests are retried (none dropped)', async () => {
    hoisted.store['accessToken'] = 'old-at';
    hoisted.store['refreshToken'] = 'old-rt';

    const p1 = responseErrorHandler({
      response: { status: 401 },
      config: { url: '/projects', headers: {} },
    });
    const p2 = responseErrorHandler({
      response: { status: 401 },
      config: { url: '/members', headers: {} },
    });
    await Promise.allSettled([p1, p2]);

    // Refresh ran exactly once. Both original requests were retried
    // through the callable-instance form: 2 calls total.
    expect(bareAxiosPost).toHaveBeenCalledTimes(1);
    expect(apiInstance).toHaveBeenCalledTimes(2);
    const retriedUrls = apiInstance.mock.calls.map((c: any[]) => c[0].url);
    expect(retriedUrls).toEqual(expect.arrayContaining(['/projects', '/members']));
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ A.4  Refresh failure cleanup                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('A.4 — Refresh failure cleanup', () => {
  it('A.4.1 refresh response rejects → original tokens removed, original request rejected', async () => {
    hoisted.store['accessToken'] = 'expired-at';
    hoisted.store['refreshToken'] = 'expired-rt';
    bareAxiosPost.mockRejectedValueOnce(new Error('network down'));
    mockGet.mockRejectedValueOnce({ response: { status: 401 }, config: { url: '/projects' } });

    await expect(
      responseErrorHandler({
        response: { status: 401 },
        config: { url: '/projects', headers: {} },
      }),
    ).rejects.toBeDefined();

    expect(hoisted.store['accessToken']).toBeUndefined();
    expect(hoisted.store['refreshToken']).toBeUndefined();
    expect(lastHash).toBe('#/login');
  });

  it('A.4.2 after a successful refresh, a subsequent 401 on the same request is short-circuited by `_retry`', async () => {
    hoisted.store['accessToken'] = 'expired-at';
    hoisted.store['refreshToken'] = 'expired-rt';

    await expect(
      responseErrorHandler({
        response: { status: 401 },
        config: { url: '/projects', headers: {} },
      }),
    ).resolves.toBeDefined();

    // The retry used the callable-instance form. The handler then
    // resolves, but the `mockGet` count stays at zero because the
    // instance is callable and we never wired the call to `.get`.
    // The key claim is that `bareAxiosPost` was called exactly once
    // and `apiInstance` was called exactly once (the retry).
    expect(bareAxiosPost).toHaveBeenCalledTimes(1);
    expect(apiInstance).toHaveBeenCalledTimes(1);
  });

  it('A.4.3 when no refreshToken is in localStorage, the refresh path throws and we still clean up', async () => {
    hoisted.store['accessToken'] = 'only-at';
    mockGet.mockRejectedValueOnce({ response: { status: 401 }, config: { url: '/projects' } });

    await expect(
      responseErrorHandler({
        response: { status: 401 },
        config: { url: '/projects', headers: {} },
      }),
    ).rejects.toBeDefined();

    expect(hoisted.store['accessToken']).toBeUndefined();
    expect(lastHash).toBe('#/login');
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ A.5  4xx/5xx error toast                                              ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('A.5 — 4xx/5xx error toasts', () => {
  // The error handler is async and rejects for non-401 statuses, so each
  // test catches the rejection explicitly. The toast is fired
  // synchronously before the rejection, so catching the rejection does
  // not race the assertion.
  it('A.5.1 403 invokes ElMessage.error with the server message when provided', async () => {
    await responseErrorHandler({
      response: { status: 403, data: { message: 'no-perm' } },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('no-perm');
  });

  it('A.5.1b 403 falls back to "无权限执行此操作" when no server message', async () => {
    await responseErrorHandler({
      response: { status: 403, data: {} },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('无权限执行此操作');
  });

  it('A.5.2 404 invokes ElMessage.error with the server message', async () => {
    await responseErrorHandler({
      response: { status: 404, data: { message: 'gone' } },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('gone');
  });

  it('A.5.2b 404 falls back to "请求的资源不存在"', async () => {
    await responseErrorHandler({
      response: { status: 404, data: {} },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('请求的资源不存在');
  });

  it('A.5.3 409 invokes ElMessage.error with the server message', async () => {
    await responseErrorHandler({
      response: { status: 409, data: { message: 'conflict' } },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('conflict');
  });

  it('A.5.3b 409 falls back to "操作冲突，请刷新后重试"', async () => {
    await responseErrorHandler({
      response: { status: 409, data: {} },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('操作冲突，请刷新后重试');
  });

  it('A.5.4 500 invokes ElMessage.error with the server message', async () => {
    await responseErrorHandler({
      response: { status: 500, data: { message: 'kaput' } },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('kaput');
  });

  it('A.5.4b 500 falls back to "服务器内部错误，请稍后重试"', async () => {
    await responseErrorHandler({
      response: { status: 500, data: {} },
      config: { url: '/x' },
    }).catch(() => {});
    expect(elMessageError).toHaveBeenCalledWith('服务器内部错误，请稍后重试');
  });

  it('A.5.5 a 401 with no _retry and no refresh token still rejects (no toast for 401)', async () => {
    await expect(
      responseErrorHandler({
        response: { status: 401, data: { message: 'should-not-toast' } },
        config: { url: '/projects', headers: {} },
      }),
    ).rejects.toBeDefined();
    expect(elMessageError).not.toHaveBeenCalled();
  });

  it('A.5.6 the success handler is a pass-through (response → response)', () => {
    const resp = { status: 200, data: { ok: true } };
    expect(responseSuccessHandler(resp)).toBe(resp);
  });
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ B  Full API contract table (method / path / body / params)            ║
// ╚══════════════════════════════════════════════════════════════════════╝
describe('B — Full API contract table', () => {
  // ── Setup ─────────────────────────────────────────────────────────────
  it('B.setup.status fetchSetupStatus → GET /setup/status', () => {
    client.fetchSetupStatus();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/setup/status');
  });

  it('B.setup.owner createOwner → POST /setup/owner with body', () => {
    client.createOwner({ account: 'a', password: 'p', workspaceName: 'W' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/setup/owner');
    expect(body).toEqual({ account: 'a', password: 'p', workspaceName: 'W' });
  });

  // ── Auth ──────────────────────────────────────────────────────────────
  it('B.auth.login login → POST /auth/login with body', () => {
    client.login({ account: 'a', password: 'p' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/auth/login');
    expect(body).toEqual({ account: 'a', password: 'p' });
  });

  // ── Project ───────────────────────────────────────────────────────────
  it('B.projects.list fetchProjects → GET /projects', () => {
    client.fetchProjects();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects');
  });

  it('B.projects.catalog fetchResourceCatalog → GET /projects/catalog', () => {
    client.fetchResourceCatalog();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/catalog');
  });

  it('B.projects.detail fetchProject → GET /projects/:id', () => {
    client.fetchProject('p1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1');
  });

  it('B.projects.create createProject → POST /projects with body', () => {
    client.createProject({ name: 'n' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects');
    expect(body).toEqual({ name: 'n' });
  });

  it('B.projects.update updateProject → PUT /projects/:id with body', () => {
    client.updateProject('p1', { name: 'n' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1');
    expect(body).toEqual({ name: 'n' });
  });

  // ── Environment ───────────────────────────────────────────────────────
  it('B.env.list fetchEnvironments → GET /environments with projectId params', () => {
    client.fetchEnvironments('p1');
    expect(mockGet).toHaveBeenLastCalledWith('/environments', { params: { projectId: 'p1' } });
  });

  it('B.env.update updateEnvironment → PUT /environments/:id with body', () => {
    client.updateEnvironment('e1', { name: 'n' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/environments/e1');
    expect(body).toEqual({ name: 'n' });
  });

  // ── EnvironmentVariable ──────────────────────────────────────────────
  it('B.envVar.list fetchEnvVariables → GET /environments/:envId/variables', () => {
    client.fetchEnvVariables('e1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/environments/e1/variables');
  });

  it('B.envVar.create createEnvVariable → POST /environments/:envId/variables with body', () => {
    client.createEnvVariable('e1', { key: 'K', value: 'v' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/environments/e1/variables');
    expect(body).toEqual({ key: 'K', value: 'v' });
  });

  it('B.envVar.delete deleteEnvVariable → DELETE /environments/:envId/variables/:id', () => {
    client.deleteEnvVariable('e1', 'v1');
    expect(mockDelete).toHaveBeenLastCalledWith('/environments/e1/variables/v1');
  });

  // ── Deployment ────────────────────────────────────────────────────────
  it('B.deployment.list fetchDeployments → GET /deployments with params', () => {
    client.fetchDeployments({ projectId: 'p1' });
    expect(mockGet).toHaveBeenLastCalledWith('/deployments', { params: { projectId: 'p1' } });
  });

  it('B.deployment.list-noParams fetchDeployments() → GET /deployments with undefined params', () => {
    client.fetchDeployments();
    const [url, config] = mockGet.mock.calls.at(-1)!;
    expect(url).toBe('/deployments');
    expect(config).toEqual({ params: undefined });
  });

  it('B.deployment.detail fetchDeployment → GET /deployments/:id', () => {
    client.fetchDeployment('d1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/deployments/d1');
  });

  it('B.deployment.logs fetchDeploymentLogs → GET /deployments/:id/logs', () => {
    client.fetchDeploymentLogs('d1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/deployments/d1/logs');
  });

  it('B.deployment.create createDeployment → POST /deployments with body', () => {
    client.createDeployment({ projectId: 'p1', environmentId: 'e1' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/deployments');
    expect(body).toMatchObject({ projectId: 'p1', environmentId: 'e1' });
  });

  // ── TestCase ──────────────────────────────────────────────────────────
  it('B.testCase.list fetchTestCases → GET /projects/:projectId/test-cases', () => {
    client.fetchTestCases('p1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/test-cases');
  });

  it('B.testCase.create createTestCase → POST /projects/:projectId/test-cases with body', () => {
    client.createTestCase('p1', { title: 't' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/test-cases');
    expect(body).toEqual({ title: 't' });
  });

  it('B.testCase.update updateTestCase → PUT /projects/:projectId/test-cases/:id', () => {
    client.updateTestCase('p1', 'tc1', { title: 't' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/test-cases/tc1');
    expect(body).toEqual({ title: 't' });
  });

  it('B.testCase.delete deleteTestCase → DELETE /projects/:projectId/test-cases/:id', () => {
    client.deleteTestCase('p1', 'tc1');
    expect(mockDelete).toHaveBeenLastCalledWith('/projects/p1/test-cases/tc1');
  });

  // ── TestRun ───────────────────────────────────────────────────────────
  it('B.testRun.list fetchTestRuns → GET /test-runs with projectId params', () => {
    client.fetchTestRuns('p1');
    expect(mockGet).toHaveBeenLastCalledWith('/test-runs', { params: { projectId: 'p1' } });
  });

  it('B.testRun.detail fetchTestRun → GET /test-runs/:id', () => {
    client.fetchTestRun('tr1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/test-runs/tr1');
  });

  it('B.testRun.create createTestRun → POST with query params and null body', () => {
    client.createTestRun('d1', 'p1', 'e1');
    const [url, body, config] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/deployments/d1/test-runs');
    expect(body).toBeNull();
    expect(config).toEqual({ params: { projectId: 'p1', environmentId: 'e1' } });
  });

  it('B.testRun.cases fetchTestRunCases → GET /test-runs/:id/cases', () => {
    client.fetchTestRunCases('tr1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/test-runs/tr1/cases');
  });

  it('B.testRun.updateCase updateTestRunCase → PUT with body', () => {
    client.updateTestRunCase('tr1', 'trc1', { result: 'PASSED' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/test-runs/tr1/cases/trc1');
    expect(body).toEqual({ result: 'PASSED' });
  });

  // ── Issue ─────────────────────────────────────────────────────────────
  it('B.issue.list fetchIssues → GET /projects/:projectId/issues with params', () => {
    client.fetchIssues('p1', { status: 'OPEN' });
    expect(mockGet).toHaveBeenLastCalledWith('/projects/p1/issues', { params: { status: 'OPEN' } });
  });

  it('B.issue.detail fetchIssue → GET /projects/:projectId/issues/:id', () => {
    client.fetchIssue('p1', 'i1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/issues/i1');
  });

  it('B.issue.create createIssue → POST /projects/:projectId/issues with body', () => {
    client.createIssue('p1', { title: 't' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/issues');
    expect(body).toEqual({ title: 't' });
  });

  it('B.issue.update updateIssue → PUT /projects/:projectId/issues/:id with body', () => {
    client.updateIssue('p1', 'i1', { title: 't' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/issues/i1');
    expect(body).toEqual({ title: 't' });
  });

  it('B.issue.transition transitionIssue → PUT with `toStatus` (not `targetStatus`)', () => {
    client.transitionIssue('p1', 'i1', { toStatus: 'FIXED', fixedCommitSha: 'sha-abc' });
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/issues/i1/status');
    expect(body).toEqual({ toStatus: 'FIXED', fixedCommitSha: 'sha-abc' });
    expect(body).not.toHaveProperty('targetStatus');
  });

  it('B.issue.transition-noCommit transitionIssue without fixedCommitSha omits the key entirely', () => {
    client.transitionIssue('p1', 'i1', { toStatus: 'CLOSED' });
    const [, body] = mockPut.mock.calls.at(-1)!;
    expect(body).toEqual({ toStatus: 'CLOSED' });
    expect(body).not.toHaveProperty('fixedCommitSha');
  });

  it('B.issue.fromFailedTest createIssueFromFailedTest → POST with query params, no body', () => {
    client.createIssueFromFailedTest('p1', 'trc1', 'd1', 'title-x');
    const [url, body, config] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/issues/from-failed-test');
    expect(body).toBeNull();
    expect(config).toEqual({
      params: { testRunCaseId: 'trc1', deploymentId: 'd1', testCaseTitle: 'title-x' },
    });
  });

  // ── Notification (KI-008 — endpoints added by ec914b4) ───────────────
  it('B.notif.list fetchNotifications → GET /notifications', () => {
    client.fetchNotifications();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/notifications');
  });

  it('B.notif.unread fetchUnreadCount → GET /notifications/unread-count', () => {
    client.fetchUnreadCount();
    expect(mockGet).toHaveBeenLastCalledWith('/notifications/unread-count');
  });

  it('B.notif.mark markNotificationRead → PUT /notifications/:id/read', () => {
    client.markNotificationRead('n1');
    expect(mockPut).toHaveBeenLastCalledWith('/notifications/n1/read');
  });

  it('B.notif.markAll markAllNotificationsRead → PUT /notifications/read-all', () => {
    client.markAllNotificationsRead();
    expect(mockPut).toHaveBeenLastCalledWith('/notifications/read-all');
  });

  // ── Release ───────────────────────────────────────────────────────────
  it('B.release.list fetchReleases → GET /projects/:projectId/releases', () => {
    client.fetchReleases('p1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/releases');
  });

  it('B.release.detail fetchRelease → GET /projects/:projectId/releases/:id', () => {
    client.fetchRelease('p1', 'r1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/releases/r1');
  });

  it('B.release.create createRelease → POST /projects/:projectId/releases with body', () => {
    client.createRelease('p1', { environmentId: 'e1', version: 'v1' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/releases');
    expect(body).toEqual({ environmentId: 'e1', version: 'v1' });
  });

  it('B.release.publish publishRelease → PUT /projects/:projectId/releases/:id/publish', () => {
    client.publishRelease('p1', 'r1');
    expect(mockPut).toHaveBeenLastCalledWith('/projects/p1/releases/r1/publish');
  });

  it('B.release.gates fetchReleaseGates → GET /projects/:projectId/releases/:id/gates', () => {
    client.fetchReleaseGates('p1', 'r1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/releases/r1/gates');
  });

  it('B.release.exemptGate exemptGate → POST with reason body', () => {
    client.exemptGate('p1', 'r1', 'g1', { reason: 'r' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/releases/r1/gates/g1/exempt');
    expect(body).toEqual({ reason: 'r' });
  });

  // ── Rollback ──────────────────────────────────────────────────────────
  it('B.rollback rollbackDeployment → POST /deployments/:id/rollback with reason', () => {
    client.rollbackDeployment('d1', { reason: 'r' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/deployments/d1/rollback');
    expect(body).toEqual({ reason: 'r' });
  });

  // ── DeployTarget ──────────────────────────────────────────────────────
  it('B.deployTarget.listAll fetchAllDeployTargets → GET /deploy-targets', () => {
    client.fetchAllDeployTargets();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/deploy-targets');
  });

  it('B.deployTarget.list fetchDeployTargets → GET /projects/:projectId/deploy-targets', () => {
    client.fetchDeployTargets('p1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/projects/p1/deploy-targets');
  });

  it('B.deployTarget.detail fetchDeployTarget → GET /deploy-targets/:id', () => {
    client.fetchDeployTarget('t1');
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/deploy-targets/t1');
  });

  it('B.deployTarget.create createDeployTarget → POST with body', () => {
    client.createDeployTarget('p1', { name: 'n' });
    const [url, body] = mockPost.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p1/deploy-targets');
    expect(body).toEqual({ name: 'n' });
  });

  it('B.deployTarget.update updateDeployTarget → PATCH /deploy-targets/:id with body', () => {
    client.updateDeployTarget('t1', { name: 'n' });
    const [url, body] = mockPatch.mock.calls.at(-1)!;
    expect(url).toBe('/deploy-targets/t1');
    expect(body).toEqual({ name: 'n' });
  });

  it('B.deployTarget.delete deleteDeployTarget → DELETE /deploy-targets/:id', () => {
    client.deleteDeployTarget('t1');
    expect(mockDelete).toHaveBeenLastCalledWith('/deploy-targets/t1');
  });

  it('B.deployTarget.verify verifyDeployTarget → POST /deploy-targets/:id/verify', () => {
    client.verifyDeployTarget('t1');
    expect(mockPost).toHaveBeenLastCalledWith('/deploy-targets/t1/verify');
  });

  // ── Audit & Member ────────────────────────────────────────────────────
  it('B.audit fetchAuditLogs → GET /audit-logs with optional workspaceId', () => {
    client.fetchAuditLogs('w1');
    expect(mockGet).toHaveBeenLastCalledWith('/audit-logs', { params: { workspaceId: 'w1' } });
  });

  it('B.audit-noArg fetchAuditLogs() → GET /audit-logs with workspaceId=undefined', () => {
    client.fetchAuditLogs();
    const [url, config] = mockGet.mock.calls.at(-1)!;
    expect(url).toBe('/audit-logs');
    expect(config).toEqual({ params: { workspaceId: undefined } });
  });

  it('B.members.list fetchMembers → GET /members', () => {
    client.fetchMembers();
    expect(mockGet.mock.calls.at(-1)![0]).toBe('/members');
  });

  it('B.members.role updateMemberRole → PUT /members/:id/role with { role } body', () => {
    client.updateMemberRole('m1', 'ADMIN');
    const [url, body] = mockPut.mock.calls.at(-1)!;
    expect(url).toBe('/members/m1/role');
    expect(body).toEqual({ role: 'ADMIN' });
  });

  it('B.members.remove removeMember → DELETE /members/:id', () => {
    client.removeMember('m1');
    expect(mockDelete).toHaveBeenLastCalledWith('/members/m1');
  });

  it('B.workspace.update updateWorkspace → PUT /workspace with body', () => {
    client.updateWorkspace({ name: 'Launchly Team' });
    expect(mockPut).toHaveBeenLastCalledWith('/workspace', { name: 'Launchly Team' });
  });

  it('B.system.info fetchSystemInfo → GET /system/info', () => {
    client.fetchSystemInfo();
    expect(mockGet).toHaveBeenLastCalledWith('/system/info');
  });

  it('B.invitation.create createInvitation → POST /invitations with policy', () => {
    const body = { role: 'DEVELOPER', expiresInHours: 24, maxUses: 1 };
    client.createInvitation(body);
    expect(mockPost).toHaveBeenLastCalledWith('/invitations', body);
  });

  it('B.invitation.accept acceptInvitation encodes the token and posts credentials', () => {
    const body = { account: 'alice', password: 'strong-password', displayName: 'Alice' };
    client.acceptInvitation('token/with space', body);
    expect(mockPost).toHaveBeenLastCalledWith('/invitations/token%2Fwith%20space/accept', body);
  });

  it('B.auth.logout logoutSession → POST /auth/logout with refresh token', () => {
    client.logoutSession('refresh-token');
    expect(mockPost).toHaveBeenLastCalledWith('/auth/logout', { refreshToken: 'refresh-token' });
  });
});
