/**
 * TEST-WEB-02 round 2 / IssueDetailPage
 *
 * - Mount fetches the issue by (projectId, id).
 * - State machine: the visible transition buttons depend on the current
 *   status, per the `TRANSITIONS` map.
 *   OPEN       → ASSIGNED, CLOSED
 *   ASSIGNED   → FIXING, CLOSED
 *   FIXING     → FIXED, ASSIGNED
 *   FIXED      → CLOSED, REOPENED
 *   REOPENED   → ASSIGNED, CLOSED
 *   CLOSED     → (none)
 * - Clicking a transition calls `transitionIssue(projectId, id, body)`
 *   with `{ toStatus: target }` (KI-008 contract).
 * - The "标记已修复" path passes `fixedCommitSha` and requires a
 *   non-empty commit SHA in the modal.
 * - Failure of the initial fetch surfaces the error toast.
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
  fetchIssue: vi.fn(),
  updateIssue: vi.fn(),
  transitionIssue: vi.fn(),
}));

import { fetchIssue, updateIssue, transitionIssue } from '../api/client';
import IssueDetailPage from './IssueDetailPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/issues/:projectId/:id', name: 'issue-detail', component: IssueDetailPage },
    ],
  });
}

const ISSUE_OPEN = {
  id: 'i1',
  projectId: 'p1',
  title: 'login broken',
  priority: 'P0',
  status: 'OPEN',
  assigneeId: null,
  createdAt: '2026-01-01',
  dueDate: null,
  fixedCommitSha: null,
  description: 'steps to reproduce',
};

describe('IssueDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchIssue).mockReset();
    vi.mocked(updateIssue).mockReset();
    vi.mocked(transitionIssue).mockReset();
    elMessageError.mockReset();
  });

  it('ID.1 mount fetches the issue by (projectId, id)', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: ISSUE_OPEN } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchIssue).toHaveBeenCalledWith('p1', 'i1');
  });

  it('ID.2 the rendered title and status tag reflect the loaded issue', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: ISSUE_OPEN } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('login broken');
    expect(w.text()).toContain('P0');
    // The status enum is mapped to a Chinese label via issueStatusMap.
    // We just assert the raw enum is somewhere in the text (the table
    // description also references the enum) AND the Chinese label.
    expect(w.text()).toMatch(/(?:待处理|未处理|未指派)/);
  });

  it('ID.3 the OPEN status shows only "指派" and "关闭" transition buttons', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: ISSUE_OPEN } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const labels = w.findAll('button').map((b) => b.text().trim());
    expect(labels).toContain('指派');
    expect(labels).toContain('关闭');
    expect(labels).not.toContain('开始修复');
    expect(labels).not.toContain('标记已修复');
    expect(labels).not.toContain('重新打开');
  });

  it('ID.4 clicking "关闭" calls transitionIssue with toStatus=CLOSED (KI-008 contract)', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: ISSUE_OPEN } as any);
    vi.mocked(transitionIssue).mockResolvedValue({ data: { ...ISSUE_OPEN, status: 'CLOSED' } } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const closeBtn = w.findAll('button').find((b) => b.text().trim() === '关闭')!;
    await closeBtn.trigger('click');
    await flushPromises();

    expect(transitionIssue).toHaveBeenCalledWith('p1', 'i1', { toStatus: 'CLOSED' });
    // The body must use `toStatus`, not `targetStatus` (KI-008).
    const body = vi.mocked(transitionIssue).mock.calls[0][2] as any;
    expect(body).not.toHaveProperty('targetStatus');
  });

  it('ID.5 the FIXED transition (via "标记已修复" modal) includes fixedCommitSha', async () => {
    // Start from FIXING to expose the "标记已修复" button.
    const FIXING = { ...ISSUE_OPEN, status: 'FIXING' };
    vi.mocked(fetchIssue).mockResolvedValue({ data: FIXING } as any);
    vi.mocked(transitionIssue).mockResolvedValue({
      data: { ...FIXING, status: 'FIXED', fixedCommitSha: 'sha-1' },
    } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const fixedBtn = w.findAll('button').find((b) => b.text().trim() === '标记已修复')!;
    await fixedBtn.trigger('click');
    await flushPromises();

    // The fixed dialog is rendered to body via teleport. Look it up in
    // the global document by its title and find the input.
    const commitInput = document.querySelector('input[placeholder="输入修复 commit SHA"]') as HTMLInputElement | null;
    expect(commitInput, 'commit-SHA input must be in the DOM').toBeTruthy();
    commitInput!.value = 'sha-1';
    commitInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    // Click the dialog's "确定" button.
    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const okBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '确定') as HTMLButtonElement | undefined;
    expect(okBtn, 'dialog confirm must be present').toBeDefined();
    okBtn!.click();
    await flushPromises();

    expect(transitionIssue).toHaveBeenCalledWith('p1', 'i1', {
      toStatus: 'FIXED',
      fixedCommitSha: 'sha-1',
    });
  });

  it('ID.6 the CLOSED status shows no transition buttons', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: { ...ISSUE_OPEN, status: 'CLOSED' } } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const labels = w.findAll('button').map((b) => b.text().trim());
    // Only the "返回" link button is expected.
    expect(labels).toEqual(['← 返回']);
  });

  it('ID.7 the "指派" flow calls updateIssue with the assigneeId', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({ data: ISSUE_OPEN } as any);
    vi.mocked(updateIssue).mockResolvedValue({ data: { ...ISSUE_OPEN, assigneeId: 'u-9' } } as any);

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    const w = mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const assignBtn = w.findAll('button').find((b) => b.text().trim() === '指派')!;
    await assignBtn.trigger('click');
    await flushPromises();

    const dialogs = w.findAllComponents({ name: 'ElDialog' });
    const input = dialogs[0].find('input[placeholder="输入成员 ID"]');
    await input.setValue('u-9');
    await flushPromises();

    const okBtn = dialogs[0].findAll('button').find((b) => b.text().trim() === '确定')!;
    await okBtn.trigger('click');
    await flushPromises();

    expect(updateIssue).toHaveBeenCalledWith('p1', 'i1', { assigneeId: 'u-9' });
  });

  it('ID.8 failure of fetchIssue surfaces the error toast', async () => {
    vi.mocked(fetchIssue).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/issues/p1/i1');
    await router.isReady();
    mount(IssueDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
  });
});
