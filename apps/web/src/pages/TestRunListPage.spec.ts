/**
 * TEST-WEB-02 round 2 / TestRunListPage
 *
 * Page contract:
 *  - Mount fetches the project list and (when ?projectId=... is present)
 *    also fetches that project's test runs.
 *  - Selecting a project in the dropdown re-runs `fetchTestRuns` for the
 *    chosen id.
 *  - Empty list renders `el-empty "暂无测试任务"`.
 *  - Failure of either fetch surfaces an ElMessage.error toast.
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
  fetchProjects: vi.fn(),
  fetchTestRuns: vi.fn(),
}));

import { fetchProjects, fetchTestRuns } from '../api/client';
import TestRunListPage from './TestRunListPage.vue';

function makeRouter(query: Record<string, string> = {}) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/tests/runs', name: 'test-runs', component: TestRunListPage },
      { path: '/tests/runs/:id', name: 'test-run-detail', component: { template: '<div/>' } },
    ],
  });
}

describe('TestRunListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(fetchTestRuns).mockReset();
    elMessageError.mockReset();
  });

  it('TL.1 mount fetches the project list and (when ?projectId= is in the route) also fetches its test runs', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      data: [
        { id: 'p1', name: 'Project One' },
        { id: 'p2', name: 'Project Two' },
      ],
    } as any);
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [{ id: 'tr1', status: 'COMPLETED' }] } as any);

    const router = makeRouter({ projectId: 'p1' });
    await router.push({ name: 'test-runs', query: { projectId: 'p1' } });
    await router.isReady();
    mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(fetchTestRuns).toHaveBeenCalledTimes(1);
    expect(fetchTestRuns).toHaveBeenCalledWith('p1');
  });

  it('TL.2 when no ?projectId= is present, fetchTestRuns is NOT called on mount', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/tests/runs');
    await router.isReady();
    mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(fetchTestRuns).not.toHaveBeenCalled();
  });

  it('TL.3 an empty list (after selecting a project) renders "暂无测试任务"', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/tests/runs');
    await router.isReady();
    const w = mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // Drive the page's loadTestRuns through the @change binding by
    // setting v-model and emitting change on the input element.
    const selectVm = w.findComponent({ name: 'ElSelect' }).vm as any;
    selectVm.$emit('update:modelValue', 'p1');
    selectVm.$emit('change', 'p1');
    await flushPromises();

    expect(fetchTestRuns).toHaveBeenCalledWith('p1');
    expect(w.text()).toContain('暂无测试任务');
  });

  it('TL.4 failure of fetchTestRuns pops the Chinese error toast and leaves the table empty', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestRuns).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/tests/runs');
    await router.isReady();
    const w = mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const selectVm = w.findComponent({ name: 'ElSelect' }).vm as any;
    selectVm.$emit('update:modelValue', 'p1');
    selectVm.$emit('change', 'p1');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
    expect(w.text()).toContain('暂无测试任务');
  });

  it('TL.5 failure of fetchProjects also pops the error toast', async () => {
    vi.mocked(fetchProjects).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/tests/runs');
    await router.isReady();
    mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
  });

  it('TL.6 successful list renders the run rows with their status tags', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestRuns).mockResolvedValue({
      data: [
        { id: 'tr1', deploymentId: 'd1', status: 'COMPLETED', createdBy: 'alice', createdAt: '2026-01-01' },
        { id: 'tr2', deploymentId: 'd2', status: 'RUNNING', createdBy: 'bob', createdAt: '2026-01-02' },
      ],
    } as any);

    const router = makeRouter();
    await router.push('/tests/runs');
    await router.isReady();
    const w = mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const selectVm = w.findComponent({ name: 'ElSelect' }).vm as any;
    selectVm.$emit('update:modelValue', 'p1');
    selectVm.$emit('change', 'p1');
    await flushPromises();

    expect(w.text()).toContain('COMPLETED');
    expect(w.text()).toContain('RUNNING');
    expect(w.text()).toContain('d1');
    expect(w.text()).toContain('alice');
  });

  it('TL.7 clicking a test-run row navigates to its execution detail', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestRuns).mockResolvedValue({
      data: [{ id: 'tr1', deploymentId: 'd1', status: 'COMPLETED' }],
    } as any);

    const router = makeRouter();
    await router.push({ path: '/tests/runs', query: { projectId: 'p1' } });
    await router.isReady();
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as any);
    const w = mount(TestRunListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    await w.findComponent({ name: 'ElTable' }).vm.$emit('row-click', { id: 'tr1' });
    expect(pushSpy).toHaveBeenCalledWith('/tests/runs/tr1');
  });
});
