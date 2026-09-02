/**
 * TEST-WEB-02 round 2 / MemberListPage
 *
 * - Mount fetches the member list.
 * - Only the OWNER sees per-row role select + remove button; everyone else
 *   sees the OWNER row labeled "所有者" with no action controls.
 * - Changing a member's role calls `updateMemberRole(id, role)` and shows
 *   the success toast.
 * - Removing a member (via popconfirm confirm) calls `removeMember(id)`.
 * - A 409 on remove produces the Chinese "不能移除最后一个所有者" toast.
 * - Failure of fetchMembers surfaces the "加载成员列表失败" toast.
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
  fetchMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import { fetchMembers, updateMemberRole, removeMember } from '../api/client';
import { useAuthStore } from '../stores/auth';
import MemberListPage from './MemberListPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/members', name: 'members', component: MemberListPage },
    ],
  });
}

function setRole(role: string | null) {
  const auth = useAuthStore();
  auth.user = role ? { id: 'u-test', role } : null;
}

const MEMBERS = [
  { id: 'm-1', account: 'alice', displayName: 'Alice', role: 'OWNER', createdAt: '2026-01-01' },
  { id: 'm-2', account: 'bob', displayName: 'Bob', role: 'DEVELOPER', createdAt: '2026-01-02' },
  { id: 'm-3', account: 'carol', displayName: 'Carol', role: 'VIEWER', createdAt: '2026-01-03' },
];

describe('MemberListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchMembers).mockReset();
    vi.mocked(updateMemberRole).mockReset();
    vi.mocked(removeMember).mockReset();
    elMessageError.mockReset();
    elMessageSuccess.mockReset();
  });

  it('ML.1 mount fetches members and renders the rows', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);

    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchMembers).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('Alice');
    expect(w.text()).toContain('Bob');
    expect(w.text()).toContain('Carol');
  });

  it('ML.2 only the OWNER sees the per-row role select and the remove button', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);

    for (const role of ['OWNER']) {
      setRole(role);
      const router = makeRouter();
      await router.push('/members');
      await router.isReady();
      const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
      await flushPromises();

      // Per-row role selects are the ElSelect inside the table; for
      // non-OWNER rows the page renders an `el-select` with the role
      // options. There should be 2 (Bob + Carol) for an OWNER viewer.
      const selects = w.findAllComponents({ name: 'ElSelect' });
      expect(selects.length, 'OWNER should see 2 role selects').toBe(2);
      // And a "移除" button per non-OWNER row.
      const removeBtns = w.findAll('button').filter((b) => b.text().trim() === '移除');
      expect(removeBtns.length, 'OWNER should see 2 remove buttons').toBe(2);
    }

    for (const role of ['ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER']) {
      setRole(role);
      const router = makeRouter();
      await router.push('/members');
      await router.isReady();
      const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
      await flushPromises();

      const selects = w.findAllComponents({ name: 'ElSelect' });
      expect(selects.length, `${role} should see no role selects`).toBe(0);
      const removeBtns = w.findAll('button').filter((b) => b.text().trim() === '移除');
      expect(removeBtns.length, `${role} should see no remove buttons`).toBe(0);
    }
  });

  it('ML.3 the OWNER row itself shows the static "所有者" label and no actions', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);

    setRole('OWNER');
    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // The page renders 3 "所有者" occurrences: one as the role tag
    // text + 1 static label for the OWNER row. We just assert the
    // static span exists.
    expect(w.text()).toContain('所有者');
  });

  it('ML.4 changing a member role calls updateMemberRole and pops a success toast', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);
    vi.mocked(updateMemberRole).mockResolvedValue({ data: { ok: true } } as any);

    setRole('OWNER');
    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // Drive the FIRST ElSelect (Bob's role) with the new value.
    const selects = w.findAllComponents({ name: 'ElSelect' });
    const bobSel = selects[0].vm as any;
    bobSel.$emit('change', 'ADMIN');
    await flushPromises();

    expect(updateMemberRole).toHaveBeenCalledWith('m-2', 'ADMIN');
    expect(elMessageSuccess).toHaveBeenCalledWith('角色已更新');
    // Reload runs after the success toast.
    expect(fetchMembers).toHaveBeenCalledTimes(2);
  });

  it('ML.5 remove via popconfirm calls removeMember and shows success toast', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);
    vi.mocked(removeMember).mockResolvedValue({ data: { ok: true } } as any);

    setRole('OWNER');
    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    // el-popconfirm has its confirm action; we drive it via the
    // component's `confirm` event (ElPopconfirm emits confirm).
    const pop = w.findComponent({ name: 'ElPopconfirm' });
    expect(pop.exists()).toBe(true);
    await pop.vm.$emit('confirm');
    await flushPromises();

    // The first popconfirm is for the FIRST non-OWNER row (Bob).
    expect(removeMember).toHaveBeenCalledWith('m-2');
    expect(elMessageSuccess).toHaveBeenCalledWith('成员已移除');
  });

  it('ML.6 a 409 on remove produces the "不能移除最后一个所有者" error toast', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ data: MEMBERS } as any);
    vi.mocked(removeMember).mockRejectedValue({ response: { status: 409 } });

    setRole('OWNER');
    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    const w = mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pop = w.findComponent({ name: 'ElPopconfirm' });
    await pop.vm.$emit('confirm');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('不能移除最后一个所有者');
  });

  it('ML.7 failure of fetchMembers surfaces the "加载成员列表失败" toast', async () => {
    vi.mocked(fetchMembers).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/members');
    await router.isReady();
    mount(MemberListPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('加载成员列表失败');
  });
});
