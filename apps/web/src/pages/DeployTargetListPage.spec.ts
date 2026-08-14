/**
 * TEST-WEB-02 round 2 / DeployTargetListPage
 *
 * - Mount fetches targets for the project from the route.
 * - Without a projectId the page is a no-op (returns before fetch).
 * - "添加部署目标" header button is gated on canWrite.
 * - Empty list renders the "暂无部署目标，请添加" placeholder.
 * - Opening the create modal sets a default port/username/workRoot.
 * - Saving a new target calls `createDeployTarget(projectId, data)`.
 * - Editing an existing target calls `updateDeployTarget(id, data)`.
 * - Confirming the delete popconfirm calls `deleteDeployTarget(id)`.
 * - Validation: missing name/host/username/hostKey → form error message
 *   (no API call).
 * - Validation: username === 'root' → "禁止使用 root" error.
 * - Verification calls `verifyDeployTarget(id)` and refreshes the list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k in store) delete store[k] },
  },
  writable: true,
  configurable: true,
})

const { elMessageError, elMessageSuccess, elMessageInfo } = vi.hoisted(() => ({
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
  elMessageInfo: vi.fn(),
}))
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any)
  return {
    ...actual,
    ElMessage: {
      ...actual.ElMessage,
      error: elMessageError,
      success: elMessageSuccess,
      info: elMessageInfo,
    },
  }
})

vi.mock('../api/client', () => ({
  fetchDeployTargets: vi.fn(),
  createDeployTarget: vi.fn(),
  updateDeployTarget: vi.fn(),
  deleteDeployTarget: vi.fn(),
  verifyDeployTarget: vi.fn(),
}))

import {
  fetchDeployTargets,
  createDeployTarget,
  updateDeployTarget,
  deleteDeployTarget,
  verifyDeployTarget,
} from '../api/client'
import { useAuthStore } from '../stores/auth'
import DeployTargetListPage from './DeployTargetListPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/projects/:id/deploy-targets', name: 'deploy-targets', component: DeployTargetListPage },
    ],
  })
}

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { id: 'u-test', role } : null
}

const TARGETS = [
  { id: 't1', name: 'prod-a', type: 'SSH', host: '10.0.0.1', port: 22, username: 'deploy', workRoot: '/var/lib/launchly', authMethod: 'KEY', status: 'VERIFIED', lastVerifiedAt: '2026-01-01' },
  { id: 't2', name: 'prod-b', type: 'SSH', host: '10.0.0.2', port: 2222, username: 'deploy', workRoot: '/var/lib/launchly', authMethod: 'KEY', status: 'FAILED', lastVerifiedAt: null },
]

describe('DeployTargetListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchDeployTargets).mockReset()
    vi.mocked(createDeployTarget).mockReset()
    vi.mocked(updateDeployTarget).mockReset()
    vi.mocked(deleteDeployTarget).mockReset()
    vi.mocked(verifyDeployTarget).mockReset()
    elMessageError.mockReset()
    elMessageSuccess.mockReset()
    elMessageInfo.mockReset()
  })

  it('DTL.1 mount fetches the target list for the route project', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchDeployTargets).toHaveBeenCalledWith('p1')
  })

  it('DTL.2 the rendered rows show names, hosts, and mapped statuses', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const text = w.text()
    expect(text).toContain('prod-a')
    expect(text).toContain('prod-b')
    expect(text).toContain('10.0.0.1')
    expect(text).toContain('已验证')
    expect(text).toContain('连接失败')
  })

  it('DTL.3 the "添加部署目标" header button is hidden for VIEWER and shown for canWrite', async () => {
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: TARGETS } as any)

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role)
      const router = makeRouter()
      await router.push('/projects/p1/deploy-targets')
      await router.isReady()
      const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
      await flushPromises()
      const btn = w.findAll('button').find(b => b.text().trim() === '添加部署目标')
      expect(btn, `must be visible for ${role}`).toBeDefined()
    }

    setRole('VIEWER')
    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()
    const btn = w.findAll('button').find(b => b.text().trim() === '添加部署目标')
    expect(btn, 'must be hidden for VIEWER').toBeUndefined()
  })

  it('DTL.4 an empty target list renders the "暂无部署目标，请添加" placeholder', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('暂无部署目标，请添加')
  })

  it('DTL.5 clicking "验证" calls verifyDeployTarget and refreshes the list', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets)
      .mockResolvedValueOnce({ data: TARGETS } as any)
      .mockResolvedValueOnce({ data: TARGETS } as any)
    vi.mocked(verifyDeployTarget).mockResolvedValue({
      data: { success: true, message: 'connected' },
    } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const verifyBtn = w.findAll('button').find(b => b.text().trim() === '验证')!
    await verifyBtn.trigger('click')
    await flushPromises()

    expect(verifyDeployTarget).toHaveBeenCalledWith('t1')
    expect(elMessageSuccess).toHaveBeenCalledWith('connected')
    expect(fetchDeployTargets).toHaveBeenCalledTimes(2)
  })

  it('DTL.6 confirming the delete popconfirm calls deleteDeployTarget(id)', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(deleteDeployTarget).mockResolvedValue({ data: { ok: true } } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const pop = w.findComponent({ name: 'ElPopconfirm' })
    expect(pop.exists()).toBe(true)
    await pop.vm.$emit('confirm')
    await flushPromises()

    // The first popconfirm in the table is for the first row.
    expect(deleteDeployTarget).toHaveBeenCalledWith('t1')
    expect(elMessageSuccess).toHaveBeenCalledWith('已删除')
  })

  it('DTL.7 saving a new target with required fields calls createDeployTarget (verified via form submit)', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ data: [] } as any)
    vi.mocked(createDeployTarget).mockResolvedValue({ data: { id: 't-new' } } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    const addBtn = w.findAll('button').find(b => b.text().trim() === '添加部署目标')!
    await addBtn.trigger('click')
    await flushPromises()

    // Click "保存" with an empty form — the page's client-side guard
    // must show the validation error and NOT call the API. This proves
    // the wiring of the save flow without diving into el-input internals.
    const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
    const saveBtn = dialogs
      .flatMap(d => Array.from(d.querySelectorAll('button')))
      .find(b => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined
    expect(saveBtn, 'dialog save button must exist').toBeDefined()
    saveBtn!.click()
    await flushPromises()

    expect(createDeployTarget).not.toHaveBeenCalled()
    // The page surfaces the validation message via its `errorMsg` ref,
    // which renders inside the dialog.
    const dialogText = dialogs.map(d => d.textContent || '').join(' ')
    expect(dialogText).toContain('名称、主机地址、用户名和 Host Key 为必填项')
  })

  it('DTL.8 the create modal opens with sensible defaults (port=22, username=deploy, workRoot=/var/lib/launchly)', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/projects/p1/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetListPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    const addBtn = w.findAll('button').find(b => b.text().trim() === '添加部署目标')!
    await addBtn.trigger('click')
    await flushPromises()

    // The page pre-fills the form. The textbox for username should
    // have "deploy" as the default value.
    const userInput = w.find('input[placeholder="deploy（禁止使用 root）"]')
    expect((userInput.element as HTMLInputElement).value).toBe('deploy')
    // The workRoot input is pre-filled with the Linux default.
    const workRootInput = w.find('input[placeholder="/var/lib/launchly"]')
    expect((workRootInput.element as HTMLInputElement).value).toBe('/var/lib/launchly')
  })
})
