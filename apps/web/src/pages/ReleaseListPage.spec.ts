/**
 * TEST-WEB-02 round 3 / ReleaseListPage
 *
 * - Mount fetches projects and accepts ?projectId.
 * - Loading a project fetches releases and succeeded deployments.
 * - Empty state is rendered when the project has no releases.
 * - Create dialog opens for selected project and calls createRelease with form payload.
 * - Failure of loading surfaces the common error toast.
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

const { elMessageError } = vi.hoisted(() => ({ elMessageError: vi.fn() }))
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any)
  return { ...actual, ElMessage: { ...actual.ElMessage, error: elMessageError } }
})

vi.mock('../api/client', () => ({
  fetchProjects: vi.fn(),
  fetchReleases: vi.fn(),
  fetchDeployments: vi.fn(),
  createRelease: vi.fn(),
}))

import {
  fetchProjects,
  fetchReleases,
  fetchDeployments,
  createRelease,
} from '../api/client'
import ReleaseListPage from './ReleaseListPage.vue'

const PROJECTS = [
  { id: 'p1', name: 'Project One' },
  { id: 'p2', name: 'Project Two' },
]

const RELEASES = [
  {
    id: 'r1',
    version: '1.0.0',
    environmentId: 'e1',
    status: 'DRAFT',
    gateStatus: 'FAILED',
    releasedBy: null,
    releasedAt: null,
  },
  {
    id: 'r2',
    version: '1.0.1',
    environmentId: 'e2',
    status: 'PUBLISHED',
    gateStatus: 'PASSED',
    releasedBy: 'alice',
    releasedAt: '2026-01-02',
  },
]

const DEPLOYMENTS = [
  { id: 'd1', branch: 'main', createdAt: '2026-01-03', status: 'SUCCEEDED' },
  { id: 'd2', branch: 'feat/a', createdAt: '2026-01-04', status: 'FAILED' },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/projects', name: 'projects', component: { template: '<div/>' } },
      { path: '/releases', name: 'release-list', component: ReleaseListPage },
      { path: '/releases/:projectId/:id', name: 'release-detail', component: { template: '<div/>' } },
    ],
  })
}

describe('ReleaseListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchProjects).mockReset()
    vi.mocked(fetchReleases).mockReset()
    vi.mocked(fetchDeployments).mockReset()
    vi.mocked(createRelease).mockReset()
    elMessageError.mockReset()
  })

  it('RL.1 mount fetches projects', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)

    const router = makeRouter()
    await router.push('/releases')
    await router.isReady()
    const w = mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchProjects).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('发布管理')
  })

  it('RL.2 query projectId auto-loads releases and deployments', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: RELEASES } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any)

    const router = makeRouter()
    await router.push({ path: '/releases', query: { projectId: 'p1' } })
    await router.isReady()
    const w = mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchReleases).toHaveBeenCalledWith('p1')
    expect(fetchDeployments).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(w.text()).toContain('发布管理')
    expect(w.text()).toContain('1.0.0')
    expect(w.text()).toContain('草稿')
  })

  it('RL.3 empty state renders when no releases are returned for a selected project', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchReleases).mockResolvedValueOnce({ data: [] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push({ path: '/releases', query: { projectId: 'p1' } })
    await router.isReady()
    const w = mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('暂无 Release')
  })

  it('RL.4 create release is disabled when no project is selected and enabled after selection', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/releases')
    await router.isReady()
    const w = mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const vm = w.vm as any
    const createBtn = w.findAll('button').find(btn => btn.text().trim() === '新建 Release')!
    expect(createBtn.attributes('disabled')).toBeDefined()

    vm.selectedProjectId = 'p1'
    await flushPromises()
    expect(vm.showCreate).toBe(false)
    expect(createBtn.attributes('disabled')).toBeUndefined()
  })

  it('RL.5 create flow with selected project calls createRelease and refreshes list', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchReleases)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ data: [RELEASES[0]] } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS.filter(d => d.status === 'SUCCEEDED') } as any)
    vi.mocked(createRelease).mockResolvedValue({ data: { id: 'r-new' } } as any)

    const router = makeRouter()
    await router.push('/releases')
    await router.isReady()
    const w = mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const vm = w.vm as any
    vm.selectedProjectId = 'p1'
    vm.form.version = '1.2.3'
    vm.form.deploymentId = 'd1'
    vm.form.notes = 'release note'
    await vm.handleCreate()
    await flushPromises()

    expect(createRelease).toHaveBeenCalledWith('p1', {
      version: '1.2.3',
      deploymentId: 'd1',
      notes: 'release note',
    })
    expect(fetchReleases).toHaveBeenCalledTimes(1)
    expect(vm.showCreate).toBe(false)
  })

  it('RL.6 loadReleases failure surfaces error toast', async () => {
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchReleases).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push({ path: '/releases', query: { projectId: 'p1' } })
    await router.isReady()
    mount(ReleaseListPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试')
  })
})
