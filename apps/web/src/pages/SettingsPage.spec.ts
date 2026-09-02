/**
 * TEST-WEB-02 round 2 / SettingsPage
 *
 * - Renders the workspace form pre-filled with `auth.workspace?.name`.
 * - The personal-info card shows account, displayName (or '-'), and a
 *   tag whose label depends on the user's role.
 * - Clicking "保存" shows a success toast (the page currently no-ops
 *   the API call; verify the surface behavior).
 * - The 3 quick-link buttons navigate via $router.push.
 * - Role tag type/label changes with role (5 cases).
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

const { elMessageSuccess } = vi.hoisted(() => ({ elMessageSuccess: vi.fn() }));
const { updateWorkspace, fetchSystemInfo } = vi.hoisted(() => ({
  updateWorkspace: vi.fn(),
  fetchSystemInfo: vi.fn(),
}));
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, ElMessage: { ...actual.ElMessage, success: elMessageSuccess } };
});
vi.mock('../api/client', () => ({ updateWorkspace, fetchSystemInfo }));

import { useAuthStore } from '../stores/auth';
import SettingsPage from './SettingsPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/settings', name: 'settings', component: SettingsPage },
      { path: '/members', name: 'members', component: { template: '<div/>' } },
      { path: '/audit-logs', name: 'audit-logs', component: { template: '<div/>' } },
      { path: '/notifications', name: 'notifications', component: { template: '<div/>' } },
    ],
  });
}

function setUser(opts: { id?: string; account?: string; displayName?: string; role?: string; workspace?: any }) {
  const auth = useAuthStore();
  auth.user = {
    id: opts.id ?? 'u-1',
    account: opts.account ?? 'admin',
    displayName: opts.displayName,
    role: opts.role,
  };
  auth.workspace = opts.workspace ?? null;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    elMessageSuccess.mockReset();
    updateWorkspace.mockReset().mockResolvedValue({ data: { id: 'w-1', name: 'X' } });
    fetchSystemInfo.mockReset().mockResolvedValue({ data: { version: 'test' } });
  });

  it('SP.1 renders the workspace form pre-filled with auth.workspace.name', async () => {
    setUser({ role: 'OWNER', workspace: { id: 'w-1', name: 'My Team' } });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const input = w.find('input[placeholder="例如：My Team"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('My Team');
  });

  it('SP.2 when no workspace is set, the input starts empty', async () => {
    setUser({ role: 'OWNER', workspace: null });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const input = w.find('input[placeholder="例如：My Team"]');
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('SP.3 the personal-info card reflects account, displayName, and a role tag with the right label', async () => {
    setUser({ account: 'alice', displayName: 'Alice Anderson', role: 'ADMIN' });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('Alice Anderson');
    // The role label is "管理员" for ADMIN.
    expect(w.text()).toContain('管理员');
  });

  it('SP.4 role label maps all 5 known roles correctly', async () => {
    const expected: Array<[string, string]> = [
      ['OWNER', '所有者'],
      ['ADMIN', '管理员'],
      ['DEVELOPER', '开发者'],
      ['TESTER', '测试员'],
      ['VIEWER', '观察者'],
    ];
    for (const [role, label] of expected) {
      setUser({ role });
      const router = makeRouter();
      await router.push('/settings');
      await router.isReady();
      const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
      await flushPromises();
      expect(w.text(), `label for ${role}`).toContain(label);
    }
  });

  it('SP.5 clicking 保存 persists the workspace name and shows a success toast', async () => {
    setUser({ role: 'OWNER', workspace: { id: 'w-1', name: 'X' } });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const saveBtn = w.findAll('button').find((b) => b.text().trim() === '保存');
    expect(saveBtn, '保存 button must exist').toBeDefined();
    await saveBtn!.trigger('click');
    await flushPromises();

    expect(updateWorkspace).toHaveBeenCalledWith({ name: 'X' });
    expect(elMessageSuccess).toHaveBeenCalledWith('工作空间设置已保存');
  });

  it('SP.6 the 3 quick-link buttons navigate to /members, /audit-logs, /notifications', async () => {
    setUser({ role: 'OWNER' });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pushSpy = vi.spyOn(router, 'push');
    const membersBtn = w.findAll('button').find((b) => b.text().trim() === '成员管理')!;
    const auditBtn = w.findAll('button').find((b) => b.text().trim() === '审计日志')!;
    const notifBtn = w.findAll('button').find((b) => b.text().trim() === '通知中心')!;
    await membersBtn.trigger('click');
    await auditBtn.trigger('click');
    await notifBtn.trigger('click');
    await flushPromises();

    const paths = pushSpy.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/members');
    expect(paths).toContain('/audit-logs');
    expect(paths).toContain('/notifications');
  });

  it('SP.7 editing the workspace field sends the changed value to the save API', async () => {
    setUser({ role: 'OWNER', workspace: { id: 'w-1', name: 'Old name' } });
    const router = makeRouter();
    await router.push('/settings');
    await router.isReady();
    const w = mount(SettingsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const input = w.find('input[placeholder="例如：My Team"]');
    await input.setValue('New name');
    await w
      .findAll('button')
      .find((b) => b.text().trim() === '保存')!
      .trigger('click');
    await flushPromises();

    expect(updateWorkspace).toHaveBeenCalledWith({ name: 'New name' });
    expect(elMessageSuccess).toHaveBeenCalledWith('工作空间设置已保存');
  });
});
