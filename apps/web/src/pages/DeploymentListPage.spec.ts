/**
 * TEST-WEB-02 round 3 / DeploymentListPage
 *
 * - Mount fetches deployment list and shows loading/empty/success views.
 * - "前往项目" in empty state.
 * - Action visibility by role and deployment status.
 * - Failed rows can trigger redeploy.
 * - Succeeded rows can trigger rollback after confirm.
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

const { elMessageError, elMessageSuccess, elMessageBoxConfirm } = vi.hoisted(() => ({
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
  elMessageBoxConfirm: vi.fn(),
}));
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any);
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: elMessageError, success: elMessageSuccess },
    // Spread FIRST, then our overrides — otherwise `actual.ElMessageBox`
    // carries its own `confirm` and shadows the spy.
    ElMessageBox: { ...actual.ElMessageBox, confirm: elMessageBoxConfirm },
  };
});

vi.mock('../api/client', () => ({
  fetchDeployments: vi.fn(),
  createDeployment: vi.fn(),
  rollbackDeployment: vi.fn(),
}));

import { fetchDeployments, createDeployment, rollbackDeployment } from '../api/client';
import { useAuthStore } from '../stores/auth';
import DeploymentListPage from './DeploymentListPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/deployments', name: 'deployments', component: DeploymentListPage },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
      { path: '/projects', name: 'projects', component: { template: '<div/>' } },
    ],
  });
}

function setRole(role: string | null) {
  const auth = useAuthStore();
  auth.user = role ? { id: 'u-test', role } : null;
}

const DEPLOYMENT_LIST = [
  {
    id: 'd1',
    projectId: 'p1',
    environmentId: 'e1',
    branch: 'main',
    status: 'FAILED',
    commitSha: 'abc',
    deployTargetId: 't1',
    triggeredByName: 'Alice',
    createdAt: '2026-01-01',
  },
  {
    id: 'd2',
    projectId: 'p2',
    environmentId: 'e1',
    branch: 'develop',
    status: 'SUCCEEDED',
    commitSha: 'def',
    triggeredByName: null,
    createdAt: '2026-01-02',
  },
  {
    id: 'd3',
    projectId: 'p3',
    environmentId: 'e1',
    branch: 'feature',
    status: 'CANCELED',
    commitSha: null,
    triggeredBy: 'Bob',
    createdAt: '2026-01-03',
  },
];

describe('DeploymentListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchDeployments).mockReset();
    vi.mocked(createDeployment).mockReset();
    vi.mocked(rollbackDeployment).mockReset();
    elMessageError.mockReset();
    elMessageSuccess.mockReset();
    elMessageBoxConfirm.mockReset();
  });

  it('DL.1 mount fetches deployments in parallel and renders rows', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENT_LIST } as any);

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    const w = mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchDeployments).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('main');
    expect(w.text()).toContain('develop');
    expect(w.text()).toContain('失败');
  });

  it('DL.2 empty state renders the hint and navigates to /projects', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    const w = mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('暂无部署记录，从项目详情触发第一次部署');

    const goProject = w.findAll('button').find((b) => b.text().trim() === '前往项目');
    expect(goProject).toBeDefined();
    await goProject!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/projects');
  });

  it('DL.3 permission gates actions: only DEPLOY roles can see redeploy/rollback', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENT_LIST } as any);

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    const ownerView = mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const ownerButtons = ownerView.findAll('button').map((b) => b.text().trim());
    expect(ownerButtons).toContain('重新部署');
    expect(ownerButtons).toContain('回滚');

    const routerViewer = makeRouter();
    setRole('VIEWER');
    await routerViewer.push('/deployments');
    await routerViewer.isReady();
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENT_LIST } as any);
    const viewerRendered = mount(DeploymentListPage, { global: { plugins: [routerViewer, ElementPlus] } });
    await flushPromises();
    const viewerButtons = viewerRendered.findAll('button').map((b) => b.text().trim());
    expect(viewerButtons).not.toContain('重新部署');
    expect(viewerButtons).not.toContain('回滚');

    ownerView.unmount();
    viewerRendered.unmount();
  });

  it('DL.4 clicking "重新部署" calls createDeployment and routes to new deployment detail', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [DEPLOYMENT_LIST[0]] } as any);
    vi.mocked(createDeployment).mockResolvedValue({ data: { id: 'd-new' } } as any);

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    const w = mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const redeployBtn = w.findAll('button').find((b) => b.text().trim() === '重新部署')!;
    await redeployBtn.trigger('click');
    await flushPromises();

    expect(createDeployment).toHaveBeenCalledWith({
      projectId: 'p1',
      environmentId: 'e1',
      deployTargetId: 't1',
      branch: 'main',
      commitSha: 'abc',
    });
    expect(elMessageSuccess).toHaveBeenCalledWith('已触发重新部署');
    expect(router.currentRoute.value.fullPath).toBe('/deployments/d-new');
  });

  it('DL.5 rollback calls confirm and then rollbackDeployment', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [DEPLOYMENT_LIST[1]] } as any);
    vi.mocked(rollbackDeployment).mockResolvedValue({ data: { id: 'd-back' } } as any);
    elMessageBoxConfirm.mockResolvedValue('ok' as any);

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    const w = mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const rollbackBtn = w.findAll('button').find((b) => b.text().trim() === '回滚')!;
    await rollbackBtn.trigger('click');
    await flushPromises();

    expect(elMessageBoxConfirm).toHaveBeenCalled();
    expect(rollbackDeployment).toHaveBeenCalledWith('d2', { reason: '手动回滚' });
    expect(elMessageSuccess).toHaveBeenCalledWith('回滚部署已触发');
    expect(router.currentRoute.value.fullPath).toBe('/deployments/d-back');
  });

  it('DL.6 failure of the initial load shows the global error toast', async () => {
    setRole('OWNER');
    vi.mocked(fetchDeployments).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/deployments');
    await router.isReady();
    mount(DeploymentListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
  });
});
