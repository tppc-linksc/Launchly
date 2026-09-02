/**
 * TEST-WEB-02 round 2 / TestRunDetailPage
 *
 * - Mount fetches the test run + its cases in parallel.
 * - Empty case list renders `el-empty "暂无测试用例"`.
 * - Changing a result via the el-select calls `updateTestRunCase` with
 *   `{ result, notes }`.
 * - The "创建 Issue" button is shown only for `result === 'FAILED'`
 *   rows; clicking it calls `createIssueFromFailedTest` and pushes
 *   the new issue route.
 * - Failure of the initial load surfaces the error toast.
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

const { elMessageError, elMessageSuccess } = vi.hoisted(() => ({
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
}));
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any);
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: elMessageError, success: elMessageSuccess },
  };
});

vi.mock('../api/client', () => ({
  fetchTestRun: vi.fn(),
  fetchTestRunCases: vi.fn(),
  fetchTestCases: vi.fn(),
  updateTestRunCase: vi.fn(),
  createIssueFromFailedTest: vi.fn(),
}));

import { fetchTestRun, fetchTestRunCases, updateTestRunCase, createIssueFromFailedTest } from '../api/client';
import TestRunDetailPage from './TestRunDetailPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/tests/runs/:id', name: 'test-run-detail', component: TestRunDetailPage },
      { path: '/issues/:projectId/:id', name: 'issue-detail', component: { template: '<div/>' } },
    ],
  });
}

const RUN = {
  id: 'tr1',
  projectId: 'p1',
  deploymentId: 'd1',
  environmentId: 'e1',
  status: 'RUNNING',
  createdAt: '2026-01-01',
  finishedAt: null,
};

const CASES = [
  { id: 'trc1', testCaseId: 'tc-1', result: 'PENDING', notes: '', executedBy: null, executedAt: null, projectId: 'p1' },
  {
    id: 'trc2',
    testCaseId: 'tc-2',
    result: 'FAILED',
    notes: 'broken',
    executedBy: 'alice',
    executedAt: '2026-01-02',
    projectId: 'p1',
  },
];

describe('TestRunDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTestRun).mockReset();
    vi.mocked(fetchTestRunCases).mockReset();
    vi.mocked(updateTestRunCase).mockReset();
    vi.mocked(createIssueFromFailedTest).mockReset();
    elMessageError.mockReset();
    elMessageSuccess.mockReset();
  });

  it('TR.1 mount fetches the run and its cases in parallel', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: CASES } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchTestRun).toHaveBeenCalledWith('tr1');
    expect(fetchTestRunCases).toHaveBeenCalledWith('tr1');
  });

  it('TR.2 the run header renders the status tag', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: CASES } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    const w = mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // The status enum is mapped to its Chinese label via testRunStatusMap.
    expect(w.text()).toContain('运行中');
  });

  it('TR.3 an empty case list renders the "暂无测试用例" placeholder', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    const w = mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('暂无测试用例');
  });

  it('TR.4 changing a case result via el-select calls updateTestRunCase with { result, notes }', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: CASES } as any);
    vi.mocked(updateTestRunCase).mockResolvedValue({ data: { ok: true } } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    const w = mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // The first el-select in the table corresponds to the first case.
    const selects = w.findAllComponents({ name: 'ElSelect' });
    expect(selects.length, 'one el-select per case row').toBe(2);
    (selects[0].vm as any).$emit('change', 'PASSED');
    await flushPromises();

    expect(updateTestRunCase).toHaveBeenCalledWith('tr1', 'trc1', { result: 'PASSED', notes: '' });
  });

  it('TR.5 the "创建 Issue" button is shown only for FAILED rows', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: CASES } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    const w = mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const createBtns = w.findAll('button').filter((b) => b.text().trim() === '创建 Issue');
    expect(createBtns.length, 'only the FAILED case row has a 创建 Issue button').toBe(1);
  });

  it('TR.6 clicking "创建 Issue" calls createIssueFromFailedTest and pushes the new issue route', async () => {
    vi.mocked(fetchTestRun).mockResolvedValue({ data: RUN } as any);
    vi.mocked(fetchTestRunCases).mockResolvedValue({ data: CASES } as any);
    vi.mocked(createIssueFromFailedTest).mockResolvedValue({ data: { id: 'i-new' } } as any);

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    const w = mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const btn = w.findAll('button').find((b) => b.text().trim() === '创建 Issue')!;
    await btn.trigger('click');
    await flushPromises();

    // The page calls createIssueFromFailedTest with
    // (case.projectId, case.id, testRun.deploymentId, case.testCaseId)
    expect(createIssueFromFailedTest).toHaveBeenCalledWith('p1', 'trc2', 'd1', 'tc-2');
    expect(elMessageSuccess).toHaveBeenCalledWith('Issue 已创建');
  });

  it('TR.7 failure of the initial load surfaces the error toast', async () => {
    vi.mocked(fetchTestRun).mockRejectedValue(new Error('boom'));
    vi.mocked(fetchTestRunCases).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/tests/runs/tr1');
    await router.isReady();
    mount(TestRunDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
  });
});
