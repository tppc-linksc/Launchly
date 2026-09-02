/**
 * TEST-WEB-02 round 2 / IssueListPage
 *
 * - Mount fetches the project list and, if `?projectId=` is present,
 *   also fetches that project's issues.
 * - The "新建 Issue" button is gated on `canWrite` AND a selected project.
 * - Status / priority filters re-fetch with the right `params`.
 * - Empty list renders `el-empty "暂无 Issue"`.
 * - Failure of either fetch surfaces an ElMessage.error toast.
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
  fetchIssues: vi.fn(),
  createIssue: vi.fn(),
}));

import { fetchProjects, fetchIssues, createIssue } from '../api/client';
import { useAuthStore } from '../stores/auth';
import IssueListPage from './IssueListPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/issues', name: 'issues', component: IssueListPage },
      { path: '/issues/:projectId/:id', name: 'issue-detail', component: { template: '<div/>' } },
    ],
  });
}

function setRole(role: string | null) {
  const auth = useAuthStore();
  auth.user = role ? { id: 'u-test', role } : null;
}

describe('IssueListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(fetchIssues).mockReset();
    vi.mocked(createIssue).mockReset();
    elMessageError.mockReset();
  });

  it('IL.1 mount fetches the project list and (when ?projectId= is present) also fetches its issues', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockResolvedValue({ data: [{ id: 'i1', title: 't' }] } as any);

    const router = makeRouter();
    await router.push({ name: 'issues', query: { projectId: 'p1' } });
    await router.isReady();
    mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(fetchIssues).toHaveBeenCalledWith('p1', {});
  });

  it('IL.2 the "新建 Issue" button is hidden for VIEWER and shown for canWrite roles, and disabled until a project is picked', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role);
      const router = makeRouter();
      await router.push('/issues');
      await router.isReady();
      const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
      await flushPromises();

      const btn = w.findAll('button').find((b) => b.text().trim() === '新建 Issue');
      expect(btn, `"新建 Issue" must be visible for role ${role}`).toBeDefined();
      // No project selected yet, so the button is disabled.
      expect(btn!.attributes('disabled')).toBeDefined();
    }

    setRole('VIEWER');
    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().trim() === '新建 Issue');
    expect(btn, '"新建 Issue" must be hidden for VIEWER').toBeUndefined();
  });

  it('IL.3 status filter is passed as a query param to fetchIssues', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const selects = w.findAllComponents({ name: 'ElSelect' });
    // First select a project.
    (selects[0].vm as any).$emit('update:modelValue', 'p1');
    (selects[0].vm as any).$emit('change', 'p1');
    await flushPromises();
    // Then change the status filter.
    (selects[1].vm as any).$emit('update:modelValue', 'OPEN');
    (selects[1].vm as any).$emit('change', 'OPEN');
    await flushPromises();

    expect(fetchIssues).toHaveBeenLastCalledWith('p1', { status: 'OPEN' });
  });

  it('IL.4 empty list (after picking a project) renders the "暂无 Issue" placeholder', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any);

    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const projectSel = w.findAllComponents({ name: 'ElSelect' })[0].vm as any;
    projectSel.$emit('update:modelValue', 'p1');
    projectSel.$emit('change', 'p1');
    await flushPromises();

    expect(w.text()).toContain('暂无 Issue');
  });

  it('IL.5 failure of fetchIssues pops the error toast and renders the empty placeholder', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const projectSel = w.findAllComponents({ name: 'ElSelect' })[0].vm as any;
    projectSel.$emit('update:modelValue', 'p1');
    projectSel.$emit('change', 'p1');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
    expect(w.text()).toContain('暂无 Issue');
  });

  it('IL.6 successful list renders the issues with status and priority tags', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockResolvedValue({
      data: [
        { id: 'i1', title: 'broken login', priority: 'P0', status: 'OPEN', assigneeId: 'u-1', createdAt: '2026-01-01' },
      ],
    } as any);

    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const projectSel = w.findAllComponents({ name: 'ElSelect' })[0].vm as any;
    projectSel.$emit('update:modelValue', 'p1');
    projectSel.$emit('change', 'p1');
    await flushPromises();

    expect(w.text()).toContain('broken login');
    expect(w.text()).toContain('P0');
    expect(w.text()).toContain('u-1');
  });

  it('IL.7 creating an issue uses the selected project and reloads its list', async () => {
    setRole('OWNER');
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p1', name: 'P1' }] } as any);
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any);
    vi.mocked(createIssue).mockResolvedValue({ data: { id: 'i-new' } } as any);

    const router = makeRouter();
    await router.push('/issues');
    await router.isReady();
    const w = mount(IssueListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const projectSelect = w.findAllComponents({ name: 'ElSelect' })[0].vm as any;
    projectSelect.$emit('update:modelValue', 'p1');
    projectSelect.$emit('change', 'p1');
    await flushPromises();

    await w
      .findAll('button')
      .find((button) => button.text().trim() === '新建 Issue')!
      .trigger('click');
    await w.find('input[placeholder="Issue 标题"]').setValue('Login is unavailable');
    await flushPromises();

    const dialog = w.findComponent({ name: 'ElDialog' });
    const confirm = dialog.findAll('button').find((button) => button.text().trim() === '确定');
    expect(confirm).toBeDefined();
    await confirm!.trigger('click');
    await flushPromises();

    expect(createIssue).toHaveBeenCalledWith('p1', {
      title: 'Login is unavailable',
      description: '',
      priority: 'P2',
    });
    expect(fetchIssues).toHaveBeenCalledTimes(2);
  });
});
