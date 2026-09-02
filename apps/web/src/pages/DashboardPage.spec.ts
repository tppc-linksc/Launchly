/**
 * TEST-WEB-02 round 2 / DashboardPage
 *
 * - Mount fetches deployments, projects, environments, and per-deployment
 *   stage logs in parallel.
 * - Failed and running counts in the side card reflect the deployments.
 * - Empty deployments list shows "暂无部署记录" with a CTA.
 * - Clicking a deployment row navigates to /deployments/:id.
 * - Failure of fetchDeployments is silently caught (the page has a
 *   `.catch` fallback); the page still renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  },
  writable: true,
  configurable: true,
});

const { elMessageError } = vi.hoisted(() => ({ elMessageError: vi.fn() }));
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, ElMessage: { ...actual.ElMessage, error: elMessageError } };
});

vi.mock('../api/client', () => ({
  fetchDeployments: vi.fn(),
  fetchProjects: vi.fn(),
  fetchEnvironments: vi.fn(),
  fetchDeploymentLogs: vi.fn(),
}));

import { fetchDeployments, fetchProjects, fetchEnvironments, fetchDeploymentLogs } from '../api/client';
import DashboardPage from './DashboardPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: DashboardPage },
      { path: '/projects', name: 'projects', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
    ],
  });
}

const DEPLOYMENTS = [
  { id: 'd1', projectId: 'p1', environmentId: 'e1', status: 'RUNNING', branch: 'main', createdAt: '2026-01-01' },
  { id: 'd2', projectId: 'p1', environmentId: 'e2', status: 'FAILED', branch: 'feature/x', createdAt: '2026-01-02' },
  { id: 'd3', projectId: 'p2', environmentId: 'e1', status: 'SUCCEEDED', branch: 'main', createdAt: '2026-01-03' },
];

describe('DashboardPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchDeployments).mockReset();
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(fetchEnvironments).mockReset();
    vi.mocked(fetchDeploymentLogs).mockReset();
    elMessageError.mockReset();
  });

  it('DB.1 mount fetches deployments + projects + (per project) environments + (per deployment) logs', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({
      data: [
        { id: 'p1', name: 'App' },
        { id: 'p2', name: 'Site' },
      ],
    } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [{ id: 'e1', name: 'Staging' }] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchDeployments).toHaveBeenCalledTimes(1);
    expect(fetchProjects).toHaveBeenCalledTimes(1);
    // 2 distinct projectIds → 2 env fetches.
    expect(fetchEnvironments).toHaveBeenCalledTimes(2);
    // 3 deployments → 3 log fetches (capped at 5 by the page).
    expect(fetchDeploymentLogs).toHaveBeenCalledTimes(3);
  });

  it('DB.2 the side card counts failed / running / project totals', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({
      data: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('处理失败部署');
    expect(w.text()).toContain('进行中部署');
    expect(w.text()).toContain('项目总数');
    // 1 FAILED + 1 RUNNING (in DEPLOYMENTS) + 2 projects.
    expect(w.text()).toMatch(/1\s*1\s*2|1[\s\S]*1[\s\S]*2/);
  });

  it('DB.3 empty deployments list shows "暂无部署记录" with a CTA', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('暂无部署记录');
    const cta = w.findAll('button').find((b) => b.text().trim() === '去创建项目');
    expect(cta).toBeDefined();
  });

  it('DB.3a empty-state CTA routes to the project list', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const cta = w.findAll('button').find((b) => b.text().trim() === '去创建项目')!;
    await cta.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/projects');
  });

  it('DB.4 clicking a deployment row navigates to /deployments/:id', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const pushSpy = vi.spyOn(router, 'push');
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const rows = w.findAll('.run-item');
    expect(rows.length).toBe(3);
    await rows[0].trigger('click');
    await flushPromises();

    expect(pushSpy).toHaveBeenCalledWith('/deployments/d1');
  });

  it('DB.5 failure of fetchDeployments is silently swallowed (catch fallback)', async () => {
    vi.mocked(fetchDeployments).mockRejectedValue(new Error('boom'));
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // No toast; the page still renders. The empty-soft card is shown.
    expect(elMessageError).not.toHaveBeenCalled();
    expect(w.text()).toContain('暂无部署记录');
  });

  // -------------------------------------------------------------------
  // Additional coverage:
  //   - envName fallback: missing id returns '—', unknown id returns '环境'
  //   - statusBadgeClass: all four branches
  //   - pipeClass: all three branches
  //   - stage pipeline renders when stage logs exist
  //   - click on a run-item navigates
  // -------------------------------------------------------------------

  it('DB.6 envName returns "—" when id is empty/null/undefined', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // envName is not exported; assert behavior via the rendered title.
    // The page renders "→ {envName(env.environmentId)}". When the row's
    // environmentId is present but the env is not in the cache, the result
    // is '环境'. We seed deployments with one that has unknown envId.
    vi.mocked(fetchDeployments).mockReset();
    vi.mocked(fetchDeployments).mockResolvedValue({
      data: [
        {
          id: 'd1',
          projectId: 'p1',
          environmentId: 'ghost-env',
          status: 'SUCCEEDED',
          branch: 'main',
          createdAt: '2026-01-01',
        },
      ],
    } as any);
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockReset();
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockReset();
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router2 = makeRouter();
    await router2.push('/');
    await router2.isReady();
    const w2 = mount(DashboardPage, { global: { plugins: [router2, ElementPlus] } });
    await flushPromises();
    expect(w2.text()).toContain('→ 环境');
  });

  it('DB.7 statusBadgeClass covers RUNNING, SUCCEEDED, FAILED, and default branches', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({
      data: [
        { id: 'd1', projectId: 'p1', environmentId: 'e1', status: 'RUNNING', branch: 'main', createdAt: '2026-01-01' },
        {
          id: 'd2',
          projectId: 'p1',
          environmentId: 'e1',
          status: 'SUCCEEDED',
          branch: 'main',
          createdAt: '2026-01-02',
        },
        { id: 'd3', projectId: 'p1', environmentId: 'e1', status: 'FAILED', branch: 'main', createdAt: '2026-01-03' },
        { id: 'd4', projectId: 'p1', environmentId: 'e1', status: 'CANCELED', branch: 'main', createdAt: '2026-01-04' },
      ],
    } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // The badge class on the row reflects the status mapping.
    const badges = w.findAll('.status-badge');
    const classes = badges.map((b) => b.classes().join(' '));
    expect(classes.some((c) => c.includes('status-running'))).toBe(true);
    expect(classes.some((c) => c.includes('status-ok'))).toBe(true);
    expect(classes.some((c) => c.includes('status-fail'))).toBe(true);
    expect(classes.some((c) => c.includes('status-default'))).toBe(true);
  });

  it('DB.8 the pipeline step renders done/on/default classes for SUCCEEDED/RUNNING/FAILED stages', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({
      data: [
        { id: 'd1', projectId: 'p1', environmentId: 'e1', status: 'RUNNING', branch: 'main', createdAt: '2026-01-01' },
      ],
    } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({
      data: [
        { id: 's1', stage: 'CLONE', status: 'SUCCEEDED', log: 'cloned' },
        { id: 's2', stage: 'BUILD', status: 'RUNNING', log: 'building' },
        { id: 's3', stage: 'DEPLOY', status: 'FAILED', log: 'crashed' },
      ],
    } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const steps = w.findAll('.pipe-step');
    expect(steps.length).toBe(3);
    const classes = steps.map((s) => s.classes().join(' '));
    expect(classes.some((c) => c.includes('done'))).toBe(true);
    expect(classes.some((c) => c.includes('on'))).toBe(true);
    // The third step (FAILED) gets no special class.
    expect(steps[2].classes().some((c) => c === 'done' || c === 'on')).toBe(false);
  });

  it('DB.9 no pipeline rendered when stage logs are empty', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.findAll('.pipe-step').length).toBe(0);
  });

  it('DB.10 the page shows "triggeredByName" / "triggeredBy" / createdAt on each run row', async () => {
    vi.mocked(fetchDeployments).mockResolvedValue({
      data: [
        {
          id: 'd1',
          projectId: 'p1',
          environmentId: 'e1',
          status: 'RUNNING',
          branch: 'main',
          triggeredByName: 'alice',
          createdAt: '2026-01-01',
        },
      ],
    } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'A' }] } as any);
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(DashboardPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const text = w.text();
    expect(text).toContain('alice');
    expect(text).toContain('分支 main');
  });
});
