/**
 * TEST-WEB-02 / ProjectListPage
 *
 * List page behavior: parallel fetch of projects + deployments, render of
 * the project cards, empty state, error toast, and role-based button
 * visibility (canWrite for "新建资源", canDeploy for per-card "部署").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import ElementPlus from 'element-plus'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k in store) delete store[k] },
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  },
  writable: true,
  configurable: true,
})

// Stub ElMessage so the failure-path toast is observable. The factory
// is hoisted above all imports, so we use `vi.hoisted` to share the
// reference between the factory and the test body.
const { elMessageError } = vi.hoisted(() => ({ elMessageError: vi.fn() }))
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any)
  return { ...actual, ElMessage: { ...actual.ElMessage, error: elMessageError } }
})

vi.mock('../api/client', () => ({
  fetchProjects: vi.fn(),
  fetchDeployments: vi.fn(),
}))

import { fetchProjects, fetchDeployments } from '../api/client'
import { useAuthStore } from '../stores/auth'
import ProjectListPage from './ProjectListPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/projects', name: 'projects', component: ProjectListPage },
      { path: '/resources/new', name: 'resource-catalog', component: { template: '<div/>' } },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
    ],
  })
}

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { id: 'u-test', role } : null
}

describe('ProjectListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchProjects).mockReset()
    vi.mocked(fetchDeployments).mockReset()
    elMessageError.mockReset()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('P.1.1 fetches projects and deployments in parallel on mount', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    mount(ProjectListPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    expect(fetchProjects).toHaveBeenCalledTimes(1)
    expect(fetchDeployments).toHaveBeenCalledTimes(1)
  })

  it('P.1.2 renders project cards when the list is non-empty', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      data: [
        { id: 'p1', name: 'App One', projectType: 'APP', repositoryUrl: 'https://x', createdAt: '2026-01-01' },
        { id: 'p2', name: 'Site Two', projectType: 'STATIC_SITE', repositoryUrl: null, createdAt: '2026-01-02' },
      ],
    } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    setRole('OWNER')

    const wrapper = mount(ProjectListPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('App One')
    expect(wrapper.text()).toContain('Site Two')
    // The card with no repositoryUrl shows the fallback "未配置仓库".
    expect(wrapper.text()).toContain('未配置仓库')
  })

  it('P.1.3 empty list renders the el-empty placeholder "暂无资源"', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    setRole('OWNER')

    const wrapper = mount(ProjectListPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('暂无资源')
    // canWrite=true → empty state shows the "创建第一个资源" CTA.
    expect(wrapper.text()).toContain('创建第一个资源')
  })

  it('P.1.4 failure of fetchProjects (after the catch chain) surfaces a Chinese error toast', async () => {
    // The page wraps each fetch in `.catch(() => ({ data: [] }))` so a
    // single rejected call should NOT pop a toast — verify that.
    vi.mocked(fetchProjects).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    const wrapper = mount(ProjectListPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()
    await nextTick()

    // No toast was raised; the list is simply empty.
    expect(elMessageError).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('暂无资源')
  })

  it('P.1.5 the "新建资源" header button is shown for canWrite roles and hidden for VIEWER', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role)
      const w = mount(ProjectListPage, {
        global: { plugins: [makeRouter(), ElementPlus] },
      })
      await flushPromises()
      const cta = w.findAll('button').find(b => b.text().trim() === '新建资源')
      expect(cta, `header "新建资源" must be visible for role ${role}`).toBeDefined()
    }

    setRole('VIEWER')
    const w = mount(ProjectListPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()
    const cta = w.findAll('button').find(b => b.text().trim() === '新建资源')
    expect(cta, 'header "新建资源" must be hidden for VIEWER').toBeUndefined()
  })

  it('P.1.6 per-card "部署" button is shown for canDeploy roles and hidden otherwise', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({
      data: [{ id: 'p1', name: 'App', projectType: 'APP', repositoryUrl: 'x', createdAt: '2026-01-01' }],
    } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER']) {
      setRole(role)
      const w = mount(ProjectListPage, {
        global: { plugins: [makeRouter(), ElementPlus] },
      })
      await flushPromises()
      // The card has a "部署" button AND a "详情" button.
      const deployBtn = w.findAll('button').find(b => b.text().trim() === '部署')
      expect(deployBtn, `per-card "部署" must be visible for role ${role}`).toBeDefined()
    }

    for (const role of ['TESTER', 'VIEWER']) {
      setRole(role)
      const w = mount(ProjectListPage, {
        global: { plugins: [makeRouter(), ElementPlus] },
      })
      await flushPromises()
      const deployBtn = w.findAll('button').find(b => b.text().trim() === '部署')
      expect(deployBtn, `per-card "部署" must be hidden for role ${role}`).toBeUndefined()
    }
  })
})
