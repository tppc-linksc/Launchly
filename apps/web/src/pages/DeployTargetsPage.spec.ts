/**
 * TEST-WEB-02 round 2 / DeployTargetsPage
 *
 * The cross-project (workspace-wide) deploy targets page. Mount fetches
 * targets + projects in parallel; the table is filterable by a search
 * input (projectName, name, or host); create / edit / delete /
 * verify all gated on canWrite.
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
  fetchAllDeployTargets: vi.fn(),
  fetchProjects: vi.fn(),
  createDeployTarget: vi.fn(),
  updateDeployTarget: vi.fn(),
  deleteDeployTarget: vi.fn(),
  verifyDeployTarget: vi.fn(),
}));

import {
  fetchAllDeployTargets,
  fetchProjects,
  createDeployTarget,
  updateDeployTarget,
  deleteDeployTarget,
  verifyDeployTarget,
} from '../api/client';
import { useAuthStore } from '../stores/auth';
import DeployTargetsPage from './DeployTargetsPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/deploy-targets', name: 'deploy-targets-all', component: DeployTargetsPage },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
    ],
  });
}

function setRole(role: string | null) {
  const auth = useAuthStore();
  auth.user = role ? { id: 'u-test', role } : null;
}

const TARGETS = [
  {
    id: 't1',
    projectId: 'p1',
    projectName: 'App',
    name: 'prod-a',
    type: 'SSH',
    host: '10.0.0.1',
    port: 22,
    username: 'deploy',
    workRoot: '/var/lib/launchly',
    authMethod: 'KEY',
    status: 'VERIFIED',
    lastVerifiedAt: '2026-01-01',
    hostKey: 'ssh-ed25519 AAAA',
  },
  {
    id: 't2',
    projectId: 'p2',
    projectName: 'Site',
    name: 'staging-b',
    type: 'SSH',
    host: '10.0.0.2',
    port: 2222,
    username: 'deploy',
    workRoot: '/var/lib/launchly',
    authMethod: 'KEY',
    status: 'FAILED',
    lastVerifiedAt: null,
    hostKey: 'ssh-ed25519 BBBB',
  },
];

const PROJECTS = [
  { id: 'p1', name: 'App' },
  { id: 'p2', name: 'Site' },
];

describe('DeployTargetsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
    vi.mocked(fetchAllDeployTargets).mockReset();
    vi.mocked(fetchProjects).mockReset();
    vi.mocked(createDeployTarget).mockReset();
    vi.mocked(updateDeployTarget).mockReset();
    vi.mocked(deleteDeployTarget).mockReset();
    vi.mocked(verifyDeployTarget).mockReset();
    elMessageError.mockReset();
    elMessageSuccess.mockReset();
  });

  it('DTP.1 mount fetches the global target list AND the project list in parallel', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(1);
    expect(fetchProjects).toHaveBeenCalledTimes(1);
  });

  it('DTP.2 renders all rows with projectName, name, host, and mapped status', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const text = w.text();
    expect(text).toContain('prod-a');
    expect(text).toContain('staging-b');
    expect(text).toContain('10.0.0.1');
    expect(text).toContain('10.0.0.2');
    expect(text).toContain('已验证');
    expect(text).toContain('连接失败');
  });

  it('DTP.3 search input filters rows by projectName / name / host', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const search = w.find('input[placeholder="搜索项目或目标名称"]');
    await search.setValue('prod');
    await flushPromises();
    // prod-a matches; staging-b does not.
    expect(w.text()).toContain('prod-a');
    expect(w.text()).not.toContain('staging-b');

    // Search by host: only the matching host's row remains.
    await search.setValue('10.0.0.2');
    await flushPromises();
    expect(w.text()).toContain('staging-b');
    expect(w.text()).not.toContain('prod-a');

    // Empty search restores all rows.
    await search.setValue('');
    await flushPromises();
    expect(w.text()).toContain('prod-a');
    expect(w.text()).toContain('staging-b');
  });

  it('DTP.4 the "添加部署目标" button is hidden for VIEWER and shown for canWrite', async () => {
    setRole('VIEWER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标');
    expect(btn, 'must be hidden for VIEWER').toBeUndefined();

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role);
      const router2 = makeRouter();
      await router2.push('/deploy-targets');
      await router2.isReady();
      const w2 = mount(DeployTargetsPage, { global: { plugins: [router2, ElementPlus] } });
      await flushPromises();
      const b = w2.findAll('button').find((x) => x.text().trim() === '添加部署目标');
      expect(b, `must be visible for ${role}`).toBeDefined();
    }
  });

  it('DTP.5 clicking "验证" calls verifyDeployTarget and refreshes the list', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets)
      .mockResolvedValueOnce({ data: TARGETS } as any)
      .mockResolvedValueOnce({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(verifyDeployTarget).mockResolvedValue({
      data: { success: true, message: 'ok' },
    } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const verifyBtn = w.findAll('button').find((b) => b.text().trim() === '验证')!;
    await verifyBtn.trigger('click');
    await flushPromises();

    expect(verifyDeployTarget).toHaveBeenCalledWith('t1');
    expect(elMessageSuccess).toHaveBeenCalledWith('ok');
    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(2);
  });

  it('DTP.6 the delete popconfirm calls deleteDeployTarget(id)', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(deleteDeployTarget).mockResolvedValue({ data: { ok: true } } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pop = w.findComponent({ name: 'ElPopconfirm' });
    expect(pop.exists()).toBe(true);
    await pop.vm.$emit('confirm');
    await flushPromises();

    expect(deleteDeployTarget).toHaveBeenCalledWith('t1');
    expect(elMessageSuccess).toHaveBeenCalledWith('已删除');
  });

  it('DTP.7 an empty list renders the "暂无部署目标" placeholder', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(w.text()).toContain('暂无部署目标');
  });

  it('DTP.8 failure of fetchAllDeployTargets surfaces the error toast', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockRejectedValue(new Error('boom'));
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('加载部署目标失败');
  });

  // -------------------------------------------------------------------
  // Additional coverage:
  //   - openCreate auto-selects projectId when only one project exists
  //   - openEdit pre-fills the form with the record's data
  //   - doSave validation: missing projectId, missing name/host/username/hostKey, root username, missing privateKey
  //   - doSave update path: when editingId is set, calls updateDeployTarget
  //   - doSave network error surfaces inline error
  //   - doDelete network error pops ElMessage.error
  //   - verify failure path (success=false) shows error toast
  // -------------------------------------------------------------------

  it('DTP.9 openCreate auto-selects the projectId when there is exactly one project', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: [{ id: 'p-only', name: 'Only' }] } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    // Open the create dialog.
    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    // The form's projectId should now be 'p-only' (the only project).
    // We can't easily inspect reactive state from outside, so we assert
    // by looking at the el-select inside the dialog.
    const dialogRoot = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialogRoot.findAllComponents({ name: 'ElSelect' })[0];
    expect(projectSelect.props('modelValue')).toBe('p-only');
  });

  it('DTP.10 openCreate does NOT pre-select a projectId when multiple projects exist', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    const dialogRoot = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialogRoot.findAllComponents({ name: 'ElSelect' })[0];
    expect(projectSelect.props('modelValue')).toBeUndefined();
  });

  it('DTP.11 openEdit pre-fills the form with the target record', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    // Click 编辑 on the first row.
    const editBtn = w.findAll('button').find((b) => b.text().trim() === '编辑')!;
    await editBtn.trigger('click');
    await flushPromises();

    const dialogTitle = Array.from(document.querySelectorAll('.el-dialog__title'))
      .map((t) => t.textContent || '')
      .join(' ');
    expect(dialogTitle).toContain('编辑部署目标');

    // The name input should be pre-filled with 'prod-a'.
    const nameInput = w.find('input[placeholder="生产服务器、测试节点等"]');
    expect((nameInput.element as HTMLInputElement).value).toBe('prod-a');
  });

  it('DTP.12 saving with an empty name/host/username/hostKey shows the inline error and does NOT call createDeployTarget', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(createDeployTarget).mockResolvedValue({ data: { id: 'x' } } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    // Pick a project, then submit without filling the other required fields.
    const dialog = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialog.findAllComponents({ name: 'ElSelect' })[0];
    (projectSelect.vm as any).$emit('update:modelValue', 'p1');
    (projectSelect.vm as any).$emit('change', 'p1');
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    expect(createDeployTarget).not.toHaveBeenCalled();
    const text = dialogs.map((d) => d.textContent || '').join(' ');
    expect(text).toContain('名称、主机地址、用户名和 Host Key 为必填项');
  });

  it('DTP.13 saving with username === "root" surfaces the "禁止使用 root" inline error', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    // The dialog is teleported to body. Look up inputs directly via
    // document.querySelectorAll so we don't depend on the wrapper tree.
    const setInputValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error('input not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setTextareaValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!el) throw new Error('textarea not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Pick project via the el-select component emit (not via DOM).
    const dialog = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialog.findAllComponents({ name: 'ElSelect' })[0];
    (projectSelect.vm as any).$emit('update:modelValue', 'p1');
    await flushPromises();

    setInputValue('.el-dialog input[placeholder="生产服务器、测试节点等"]', 'rt');
    setInputValue('.el-dialog input[placeholder="192.168.1.100 或 example.com"]', '1.1.1.1');
    setInputValue('.el-dialog input[placeholder="deploy（禁止使用 root）"]', 'root');
    setTextareaValue('.el-dialog textarea[placeholder^="例如：ssh-ed25519"]', 'ssh-ed25519 AAAA');
    setTextareaValue('.el-dialog textarea[placeholder="粘贴 SSH 私钥内容（PEM 格式）"]', '-----BEGIN-----\\nfoo');
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    expect(createDeployTarget).not.toHaveBeenCalled();
    const text = dialogs.map((d) => d.textContent || '').join(' ');
    expect(text).toContain('禁止使用 root');
  });
  it('DTP.14 creating without a private key shows the "请粘贴 SSH 私钥" error', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    const setInputValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error('input not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setTextareaValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!el) throw new Error('textarea not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const dialog = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialog.findAllComponents({ name: 'ElSelect' })[0];
    (projectSelect.vm as any).$emit('update:modelValue', 'p1');
    await flushPromises();

    setInputValue('.el-dialog input[placeholder="生产服务器、测试节点等"]', 'ok');
    setInputValue('.el-dialog input[placeholder="192.168.1.100 或 example.com"]', '1.1.1.1');
    setInputValue('.el-dialog input[placeholder="deploy（禁止使用 root）"]', 'deploy');
    setTextareaValue('.el-dialog textarea[placeholder^="例如：ssh-ed25519"]', 'ssh-ed25519 AAAA');
    // Do NOT fill privateKey.
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    expect(createDeployTarget).not.toHaveBeenCalled();
    const text = dialogs.map((d) => d.textContent || '').join(' ');
    expect(text).toContain('请粘贴 SSH 私钥');
  });
  it('DTP.15 creating without picking a projectId shows the "请选择所属项目" error', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    const setInputValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error('input not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setTextareaValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!el) throw new Error('textarea not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // projectId remains undefined; fill other required fields.
    setInputValue('.el-dialog input[placeholder="生产服务器、测试节点等"]', 'ok');
    setInputValue('.el-dialog input[placeholder="192.168.1.100 或 example.com"]', '1.1.1.1');
    setInputValue('.el-dialog input[placeholder="deploy（禁止使用 root）"]', 'deploy');
    setTextareaValue('.el-dialog textarea[placeholder^="例如：ssh-ed25519"]', 'ssh-ed25519 AAAA');
    setTextareaValue('.el-dialog textarea[placeholder="粘贴 SSH 私钥内容（PEM 格式）"]', '-----BEGIN-----\\nfoo');
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    expect(createDeployTarget).not.toHaveBeenCalled();
    const text = dialogs.map((d) => d.textContent || '').join(' ');
    expect(text).toContain('请选择所属项目');
  });
  it('DTP.16 editing an existing target calls updateDeployTarget (not createDeployTarget)', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets)
      .mockResolvedValueOnce({ data: TARGETS } as any)
      .mockResolvedValueOnce({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(updateDeployTarget).mockResolvedValue({ data: { id: 't1' } } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const editBtn = w.findAll('button').find((b) => b.text().trim() === '编辑')!;
    await editBtn.trigger('click');
    await flushPromises();

    // openEdit resets hostKey to '' — the doSave validation needs it to be
    // non-empty, so fill the hostKey textarea before clicking 保存.
    const setTextareaValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!el) throw new Error('textarea not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setTextareaValue('.el-dialog textarea[placeholder^="例如：ssh-ed25519"]', 'ssh-ed25519 AAAA');
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    expect(updateDeployTarget).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        name: 'prod-a',
        type: 'SSH',
        host: '10.0.0.1',
        username: 'deploy',
        hostKey: 'ssh-ed25519 AAAA',
      }),
    );
    expect(createDeployTarget).not.toHaveBeenCalled();
    expect(elMessageSuccess).toHaveBeenCalledWith('部署目标已更新');
  });

  it('DTP.17 a save that throws surfaces the response message as inline error', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(createDeployTarget).mockRejectedValue({
      response: { data: { message: 'host unreachable' } },
    });

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    });
    await flushPromises();

    const addBtn = w.findAll('button').find((b) => b.text().trim() === '添加部署目标')!;
    await addBtn.trigger('click');
    await flushPromises();

    const dialog = w.findAllComponents({ name: 'ElDialog' })[0];
    const projectSelect = dialog.findAllComponents({ name: 'ElSelect' })[0];
    (projectSelect.vm as any).$emit('update:modelValue', 'p1');
    await flushPromises();

    const setInputValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error('input not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setTextareaValue = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!el) throw new Error('textarea not found: ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setInputValue('.el-dialog input[placeholder="生产服务器、测试节点等"]', 'ok');
    setInputValue('.el-dialog input[placeholder="192.168.1.100 或 example.com"]', '1.1.1.1');
    setInputValue('.el-dialog input[placeholder="deploy（禁止使用 root）"]', 'deploy');
    setTextareaValue('.el-dialog textarea[placeholder^="例如：ssh-ed25519"]', 'ssh-ed25519 AAAA');
    setTextareaValue('.el-dialog textarea[placeholder="粘贴 SSH 私钥内容（PEM 格式）"]', '-----BEGIN-----\\nfoo');
    await flushPromises();

    const dialogs = Array.from(document.querySelectorAll('.el-dialog'));
    const saveBtn = dialogs
      .flatMap((d) => Array.from(d.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined;
    saveBtn!.click();
    await flushPromises();

    const text = dialogs.map((d) => d.textContent || '').join(' ');
    expect(text).toContain('host unreachable');
  });
  it('DTP.18 a delete that throws pops ElMessage.error with the response message', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(deleteDeployTarget).mockRejectedValue({
      response: { data: { message: 'forbidden' } },
    });

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pop = w.findComponent({ name: 'ElPopconfirm' });
    await pop.vm.$emit('confirm');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('forbidden');
  });

  it('DTP.19 verify with success=false surfaces the error toast and reloads the list', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets)
      .mockResolvedValueOnce({ data: TARGETS } as any)
      .mockResolvedValueOnce({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(verifyDeployTarget).mockResolvedValue({
      data: { success: false, message: 'auth failed' },
    } as any);

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const verifyBtn = w.findAll('button').find((b) => b.text().trim() === '验证')!;
    await verifyBtn.trigger('click');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('auth failed');
    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(2);
  });

  it('DTP.20 a verify that throws is caught and shows ElMessage.error', async () => {
    setRole('OWNER');
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any);
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any);
    vi.mocked(verifyDeployTarget).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/deploy-targets');
    await router.isReady();
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const verifyBtn = w.findAll('button').find((b) => b.text().trim() === '验证')!;
    await verifyBtn.trigger('click');
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('验证失败');
  });
});
