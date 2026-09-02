/**
 * TEST-WEB-02 round 2 / TestCaseListPage
 *
 * - Mount fetches projects (no project auto-selected).
 * - Picking a project calls `fetchTestCases(projectId)`.
 * - Edit / delete action buttons are gated on `canWrite`.
 * - Empty states: "请先选择一个项目" before selection; "暂无测试用例" after.
 * - Save form triggers either `createTestCase` or `updateTestCase` based
 *   on whether an existing case is being edited.
 * - Failure of fetchTestCases surfaces an ElMessage.error toast.
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
  fetchTestCases: vi.fn(),
  createTestCase: vi.fn(),
  updateTestCase: vi.fn(),
  deleteTestCase: vi.fn(),
}));

import { fetchProjects, fetchTestCases, createTestCase, updateTestCase, deleteTestCase } from '../api/client';
import { useAuthStore } from '../stores/auth';
import TestCaseListPage from './TestCaseListPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/tests', name: 'tests', component: TestCaseListPage },
    ],
  });
}

function setRole(role: string | null) {
  const auth = useAuthStore();
  auth.user = role ? { id: 'u-test', role } : null;
}

async function selectProject(w: any, projectId: string) {
  const sel = w.findComponent({ name: 'ElSelect' }).vm as any;
  sel.$emit('update:modelValue', projectId);
  sel.$emit('change', projectId);
  await flushPromises();
}

describe('TestCaseListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(fetchTestCases).mockReset();
    vi.mocked(createTestCase).mockReset();
    vi.mocked(updateTestCase).mockReset();
    vi.mocked(deleteTestCase).mockReset();
    elMessageError.mockReset();
  });

  it('TC.1 mount fetches the project list and does NOT auto-load test cases', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(fetchTestCases).not.toHaveBeenCalled();
  });

  it('TC.2 before any project is picked the "请先选择一个项目" placeholder is shown', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    expect(w.text()).toContain('请先选择一个项目');
  });

  it('TC.3 picking a project calls fetchTestCases and renders the rows', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestCases).mockResolvedValue({
      data: [{ id: 'tc1', title: 'Login flow', module: 'Auth', priority: 'P1', status: 'ACTIVE' }],
    } as any);

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    await selectProject(w, 'p1');

    expect(fetchTestCases).toHaveBeenCalledWith('p1');
    expect(w.text()).toContain('Login flow');
    expect(w.text()).toContain('Auth');
    expect(w.text()).toContain('P1');
  });

  it('TC.4 empty list (after project selected) renders "暂无测试用例"', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestCases).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    await selectProject(w, 'p1');

    expect(w.text()).toContain('暂无测试用例');
  });

  it('TC.5 the "新建用例" button is hidden for VIEWER and shown (disabled) for canWrite roles', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role);
      const router = makeRouter();
      await router.push('/tests');
      await router.isReady();
      const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
      await flushPromises();

      const btn = w.findAll('button').find((b) => b.text().trim() === '新建用例');
      expect(btn, `must be visible for ${role}`).toBeDefined();
      expect(btn!.attributes('disabled')).toBeDefined();
    }

    setRole('VIEWER');
    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().trim() === '新建用例');
    expect(btn, 'must be hidden for VIEWER').toBeUndefined();
  });

  it('TC.6 failure of fetchTestCases surfaces the error toast and the empty placeholder', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestCases).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    await selectProject(w, 'p1');

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
    expect(w.text()).toContain('暂无测试用例');
  });

  it('TC.7 creating a new test case calls createTestCase and reloads the list', async () => {
    setRole('OWNER');
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestCases).mockResolvedValue({ data: [] } as any);
    vi.mocked(createTestCase).mockResolvedValue({ data: { id: 'tc-new' } } as any);

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    await selectProject(w, 'p1');

    // Open the modal.
    const newBtn = w.findAll('button').find((b) => b.text().trim() === '新建用例')!;
    await newBtn.trigger('click');
    await flushPromises();

    // Fill the title field (the only required one).
    const titleInput = w.find('input[placeholder="测试用例标题"]');
    await titleInput.setValue('My new test');
    await flushPromises();

    // Find the dialog's "确定" button and click it.
    const dialogs = w.findAllComponents({ name: 'ElDialog' });
    expect(dialogs.length, 'create dialog must be open').toBeGreaterThan(0);
    const okBtn = dialogs[0].findAll('button').find((b) => b.text().trim() === '确定');
    expect(okBtn, 'dialog confirm button must exist').toBeDefined();
    await okBtn!.trigger('click');
    await flushPromises();

    expect(createTestCase).toHaveBeenCalledTimes(1);
    expect((createTestCase as any).mock.calls[0][0]).toBe('p1');
    expect((createTestCase as any).mock.calls[0][1]).toMatchObject({ title: 'My new test' });
    // list was reloaded
    expect(fetchTestCases).toHaveBeenCalledTimes(2); // initial + after create
  });

  it('TC.8 editing and deleting use the selected project and exact case identity', async () => {
    setRole('OWNER');
    const existing = {
      id: 'tc1',
      title: 'Login flow',
      module: 'Auth',
      steps: 'Open login',
      expectedResult: 'Signed in',
      priority: 'P1',
      tags: 'smoke',
      status: 'ACTIVE',
    };
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchTestCases).mockResolvedValue({ data: [existing] } as any);
    vi.mocked(updateTestCase).mockResolvedValue({ data: existing } as any);
    vi.mocked(deleteTestCase).mockResolvedValue({ data: { success: true } } as any);

    const router = makeRouter();
    await router.push('/tests');
    await router.isReady();
    const w = mount(TestCaseListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    await selectProject(w, 'p1');

    const edit = w.findAll('button').find((button) => button.text().trim() === '编辑');
    expect(edit).toBeDefined();
    await edit!.trigger('click');
    await flushPromises();
    expect((w.find('input[placeholder="测试用例标题"]').element as HTMLInputElement).value).toBe('Login flow');

    const confirm = w.findAll('button').find((button) => button.text().trim() === '确定');
    await confirm!.trigger('click');
    await flushPromises();
    expect(updateTestCase).toHaveBeenCalledWith('p1', 'tc1', expect.objectContaining({ title: 'Login flow' }));

    const popconfirm = w.findComponent({ name: 'ElPopconfirm' });
    await popconfirm.vm.$emit('confirm');
    await flushPromises();
    expect(deleteTestCase).toHaveBeenCalledWith('p1', 'tc1');
  });
});
