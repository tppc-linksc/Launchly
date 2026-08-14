/**
 * TEST-WEB-02 round 2 / DeployTargetsPage
 *
 * The cross-project (workspace-wide) deploy targets page. Mount fetches
 * targets + projects in parallel; the table is filterable by a search
 * input (projectName, name, or host); create / edit / delete /
 * verify all gated on canWrite.
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

const { elMessageError, elMessageSuccess } = vi.hoisted(() => ({
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
}))
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any)
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: elMessageError, success: elMessageSuccess },
  }
})

vi.mock('../api/client', () => ({
  fetchAllDeployTargets: vi.fn(),
  fetchProjects: vi.fn(),
  createDeployTarget: vi.fn(),
  updateDeployTarget: vi.fn(),
  deleteDeployTarget: vi.fn(),
  verifyDeployTarget: vi.fn(),
}))

import {
  fetchAllDeployTargets,
  fetchProjects,
  createDeployTarget,
  updateDeployTarget,
  deleteDeployTarget,
  verifyDeployTarget,
} from '../api/client'
import { useAuthStore } from '../stores/auth'
import DeployTargetsPage from './DeployTargetsPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/deploy-targets', name: 'deploy-targets-all', component: DeployTargetsPage },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
    ],
  })
}

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { id: 'u-test', role } : null
}

const TARGETS = [
  { id: 't1', projectId: 'p1', projectName: 'App', name: 'prod-a', type: 'SSH', host: '10.0.0.1', port: 22, username: 'deploy', workRoot: '/var/lib/launchly', authMethod: 'KEY', status: 'VERIFIED', lastVerifiedAt: '2026-01-01' },
  { id: 't2', projectId: 'p2', projectName: 'Site', name: 'staging-b', type: 'SSH', host: '10.0.0.2', port: 2222, username: 'deploy', workRoot: '/var/lib/launchly', authMethod: 'KEY', status: 'FAILED', lastVerifiedAt: null },
]

const PROJECTS = [
  { id: 'p1', name: 'App' },
  { id: 'p2', name: 'Site' },
]

describe('DeployTargetsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchAllDeployTargets).mockReset()
    vi.mocked(fetchProjects).mockReset()
    vi.mocked(createDeployTarget).mockReset()
    vi.mocked(updateDeployTarget).mockReset()
    vi.mocked(deleteDeployTarget).mockReset()
    vi.mocked(verifyDeployTarget).mockReset()
    elMessageError.mockReset()
    elMessageSuccess.mockReset()
  })

  it('DTP.1 mount fetches the global target list AND the project list in parallel', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(1)
    expect(fetchProjects).toHaveBeenCalledTimes(1)
  })

  it('DTP.2 renders all rows with projectName, name, host, and mapped status', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const text = w.text()
    expect(text).toContain('prod-a')
    expect(text).toContain('staging-b')
    expect(text).toContain('10.0.0.1')
    expect(text).toContain('10.0.0.2')
    expect(text).toContain('已验证')
    expect(text).toContain('连接失败')
  })

  it('DTP.3 search input filters rows by projectName / name / host', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const search = w.find('input[placeholder="搜索项目或目标名称"]')
    await search.setValue('prod')
    await flushPromises()
    // prod-a matches; staging-b does not.
    expect(w.text()).toContain('prod-a')
    expect(w.text()).not.toContain('staging-b')

    // Search by host: only the matching host's row remains.
    await search.setValue('10.0.0.2')
    await flushPromises()
    expect(w.text()).toContain('staging-b')
    expect(w.text()).not.toContain('prod-a')

    // Empty search restores all rows.
    await search.setValue('')
    await flushPromises()
    expect(w.text()).toContain('prod-a')
    expect(w.text()).toContain('staging-b')
  })

  it('DTP.4 the "添加部署目标" button is hidden for VIEWER and shown for canWrite', async () => {
    setRole('VIEWER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()
    const btn = w.findAll('button').find(b => b.text().trim() === '添加部署目标')
    expect(btn, 'must be hidden for VIEWER').toBeUndefined()

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role)
      const router2 = makeRouter()
      await router2.push('/deploy-targets')
      await router2.isReady()
      const w2 = mount(DeployTargetsPage, { global: { plugins: [router2, ElementPlus] } })
      await flushPromises()
      const b = w2.findAll('button').find(x => x.text().trim() === '添加部署目标')
      expect(b, `must be visible for ${role}`).toBeDefined()
    }
  })

  it('DTP.5 clicking "验证" calls verifyDeployTarget and refreshes the list', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets)
      .mockResolvedValueOnce({ data: TARGETS } as any)
      .mockResolvedValueOnce({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(verifyDeployTarget).mockResolvedValue({
      data: { success: true, message: 'ok' },
    } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const verifyBtn = w.findAll('button').find(b => b.text().trim() === '验证')!
    await verifyBtn.trigger('click')
    await flushPromises()

    expect(verifyDeployTarget).toHaveBeenCalledWith('t1')
    expect(elMessageSuccess).toHaveBeenCalledWith('ok')
    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(2)
  })

  it('DTP.6 the delete popconfirm calls deleteDeployTarget(id)', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(deleteDeployTarget).mockResolvedValue({ data: { ok: true } } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const pop = w.findComponent({ name: 'ElPopconfirm' })
    expect(pop.exists()).toBe(true)
    await pop.vm.$emit('confirm')
    await flushPromises()

    expect(deleteDeployTarget).toHaveBeenCalledWith('t1')
    expect(elMessageSuccess).toHaveBeenCalledWith('已删除')
  })

  it('DTP.7 an empty list renders the "暂无部署目标" placeholder', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    const w = mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('暂无部署目标')
  })

  it('DTP.8 failure of fetchAllDeployTargets surfaces the error toast', async () => {
    setRole('OWNER')
    vi.mocked(fetchAllDeployTargets).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/deploy-targets')
    await router.isReady()
    mount(DeployTargetsPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(elMessageError).toHaveBeenCalledWith('加载部署目标失败')
  })
})
