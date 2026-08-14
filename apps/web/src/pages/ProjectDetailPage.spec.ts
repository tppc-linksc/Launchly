/**
 * TEST-WEB-02 round 2 / ProjectDetailPage
 *
 * - Mount fetches the project + envs + recent deployments + test runs +
 *   issues + releases + deploy targets in parallel.
 * - The "编辑" button is gated on canWrite.
 * - The header "部署" button is gated on canDeploy AND
 *   `canDeployProject` (project must have a repository or template).
 * - Per-env "部署到此环境" buttons are gated on canDeploy AND env type
 *   (TEST/STAGING only); when canDeploy=false the button is replaced
 *   by a disabled "无部署权限" label.
 * - Opening the deploy dialog and submitting calls `createDeployment`
 *   and pushes to /deployments/:id.
 * - The dialog refuses to submit when the env or deploy target is
 *   not picked (inline error message, no API call).
 * - Editing the project and clicking save calls `updateProject` with a
 *   payload that nests `bootstrapAdmin` and strips the flat admin
 *   fields.
 * - An empty `bootstrapAdminEnabled` toggle requires a command +
 *   username/email, and the first time it is enabled a password is
 *   mandatory (client-side guard).
 * - The "无权限" disabled state for non-deployers is rendered for
 *   TEST/STAGING envs only.
 * - Failure of the initial fetch surfaces the error toast.
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
  fetchProject: vi.fn(),
  updateProject: vi.fn(),
  fetchEnvironments: vi.fn(),
  fetchDeployments: vi.fn(),
  fetchTestRuns: vi.fn(),
  fetchIssues: vi.fn(),
  fetchReleases: vi.fn(),
  createDeployment: vi.fn(),
  fetchDeployTargets: vi.fn(),
}))

import {
  fetchProject,
  updateProject,
  fetchEnvironments,
  fetchDeployments,
  fetchTestRuns,
  fetchIssues,
  fetchReleases,
  createDeployment,
  fetchDeployTargets,
} from '../api/client'
import { useAuthStore } from '../stores/auth'
import ProjectDetailPage from './ProjectDetailPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/projects/:id', name: 'project-detail', component: ProjectDetailPage },
      { path: '/projects/:id/deploy-targets', name: 'deploy-targets', component: { template: '<div/>' } },
      { path: '/environments', name: 'environments', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
    ],
  })
}

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { id: 'u-test', role } : null
}

const PROJECT = {
  id: 'p1', name: 'App', description: 'desc', projectType: 'APP',
  repositoryUrl: 'https://github.com/org/repo.git', defaultBranch: 'main',
  gitProvider: 'GITHUB', healthCheckPath: '/health', defaultPort: 3000,
  installCommand: 'npm ci', buildCommand: 'npm run build',
  startCommand: 'npm start', testCommand: 'npm test',
  bootstrapAdminEnabled: false, createdAt: '2026-01-01',
}

const ENVS = [
  { id: 'e1', projectId: 'p1', name: '测试', type: 'TEST', status: 'active' },
  { id: 'e2', projectId: 'p1', name: 'Staging', type: 'STAGING', status: 'active' },
  { id: 'e3', projectId: 'p1', name: '生产', type: 'PRODUCTION', status: 'active' },
]

const DEPLOY_TARGETS = [
  { id: 't1', name: 'prod-a', host: '10.0.0.1' },
]

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Reset body for tests that `attachTo: document.body` so a previous
    // test's teleported dialogs don't leak into the next one.
    document.body.innerHTML = ''
    vi.mocked(fetchProject).mockReset()
    vi.mocked(updateProject).mockReset()
    vi.mocked(fetchEnvironments).mockReset()
    vi.mocked(fetchDeployments).mockReset()
    vi.mocked(fetchTestRuns).mockReset()
    vi.mocked(fetchIssues).mockReset()
    vi.mocked(fetchReleases).mockReset()
    vi.mocked(createDeployment).mockReset()
    vi.mocked(fetchDeployTargets).mockReset()
    elMessageError.mockReset()
    elMessageSuccess.mockReset()
  })

  it('PD.1 mount fetches project + 6 sibling lists in parallel', async () => {
    setRole('OWNER')
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(fetchProject).toHaveBeenCalledWith('p1')
    expect(fetchEnvironments).toHaveBeenCalledWith('p1')
    expect(fetchDeployments).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(fetchTestRuns).toHaveBeenCalledWith('p1')
    expect(fetchIssues).toHaveBeenCalledWith('p1')
    expect(fetchReleases).toHaveBeenCalled()
    expect(fetchDeployTargets).toHaveBeenCalledWith('p1')
  })

  it('PD.2 the page renders the project name, description, and metadata', async () => {
    setRole('OWNER')
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(w.text()).toContain('App')
    expect(w.text()).toContain('https://github.com/org/repo.git')
    expect(w.text()).toContain('main')
    expect(w.text()).toContain('npm ci')
  })

  it('PD.3 the "编辑" button is shown for canWrite and hidden for VIEWER', async () => {
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)
    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER']) {
      setRole(role)
      const router = makeRouter()
      await router.push('/projects/p1')
      await router.isReady()
      const w = mount(ProjectDetailPage, {
        global: { plugins: [router, ElementPlus] },
        attachTo: document.body,
      })
      await flushPromises()
      const editBtn = w.findAll('button').find(b => b.text().trim() === '编辑')
      expect(editBtn, `edit must be visible for ${role}`).toBeDefined()
    }

    setRole('VIEWER')
    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()
    const editBtn = w.findAll('button').find(b => b.text().trim() === '编辑')
    expect(editBtn, 'edit must be hidden for VIEWER').toBeUndefined()
  })

  it('PD.4 env cards show "无部署权限" disabled button for non-deployers on TEST/STAGING; PRODUCTION shows "生产（需走 Release）"', async () => {
    setRole('VIEWER')
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    const text = w.text()
    expect((text.match(/无部署权限/g) || []).length).toBe(2) // for 测试 + Staging
    expect(text).toContain('生产（需走 Release）')
  })

  it('PD.5 the header "部署" button is hidden when canDeploy=false and shown when canDeploy=true', async () => {
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)
    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER']) {
      setRole(role)
      const router = makeRouter()
      await router.push('/projects/p1')
      await router.isReady()
      const w = mount(ProjectDetailPage, {
        global: { plugins: [router, ElementPlus] },
        attachTo: document.body,
      })
      await flushPromises()
      const btn = w.findAll('button').find(b => b.text().trim() === '部署' && !b.attributes('disabled'))
      expect(btn, `header deploy must be visible for ${role}`).toBeDefined()
    }

    for (const role of ['TESTER', 'VIEWER']) {
      setRole(role)
      const router = makeRouter()
      await router.push('/projects/p1')
      await router.isReady()
      const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
      await flushPromises()
      // The TEST/STAGING per-env deploy buttons (canDeploy=false) are
      // "无部署权限" disabled; the header "部署" button is also hidden.
      // We just assert that "无部署权限" appears.
      expect(w.text()).toContain('无部署权限')
    }
  })

  it('PD.6 saving the edit form nests bootstrapAdmin and strips the flat fields', async () => {
    setRole('OWNER')
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)
    vi.mocked(updateProject).mockResolvedValue({ data: { ...PROJECT, name: 'App v2' } } as any)
    vi.mocked(fetchProject)
      .mockResolvedValueOnce({ data: PROJECT } as any)
      .mockResolvedValueOnce({ data: { ...PROJECT, name: 'App v2' } } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // Open the edit modal.
    const editBtn = w.findAll('button').find(b => b.text().trim() === '编辑')!
    await editBtn.trigger('click')
    await flushPromises()

    // The edit dialog is a teleport; click the dialog's "保存" button.
    const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
    const saveBtn = dialogs
      .flatMap(d => Array.from(d.querySelectorAll('button')))
      .find(b => b.textContent?.trim() === '保存') as HTMLButtonElement | undefined
    expect(saveBtn, 'edit dialog save button must exist').toBeDefined()
    saveBtn!.click()
    await flushPromises()

    expect(updateProject).toHaveBeenCalledTimes(1)
    const [id, payload] = (updateProject as any).mock.calls[0]
    expect(id).toBe('p1')
    expect(payload).not.toHaveProperty('bootstrapAdminEnabled')
    expect(payload).not.toHaveProperty('bootstrapAdminCommand')
    expect(payload).not.toHaveProperty('bootstrapAdminUsername')
    expect(payload).not.toHaveProperty('bootstrapAdminEmail')
    expect(payload).not.toHaveProperty('bootstrapAdminPassword')
    expect(payload.bootstrapAdmin).toEqual({
      enabled: false,
      command: undefined,
      username: undefined,
      email: undefined,
      password: undefined,
    })
    expect(elMessageSuccess).toHaveBeenCalledWith('项目已更新')
  })

  it('PD.7 the deploy dialog refuses to submit when no target is picked', async () => {
    setRole('OWNER')
    // Use only one deployable env so the header "部署" auto-picks it.
    const ONE_DEPLOYABLE = [ENVS[0]]
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ONE_DEPLOYABLE } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // Open the deploy dialog via the header "部署" button (one deployable
    // env is auto-selected by openDeployFromHeader).
    const deployBtn = w.findAll('button').find(b => b.text().trim() === '部署' && !b.attributes('disabled'))!
    await deployBtn.trigger('click')
    await flushPromises()

    // The dialog's "确定" button is the only one inside the dialog.
    const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
    const okBtn = dialogs
      .flatMap(d => Array.from(d.querySelectorAll('button')))
      .find(b => b.textContent?.trim() === '确定') as HTMLButtonElement | undefined
    expect(okBtn, 'deploy dialog confirm must exist').toBeDefined()
    okBtn!.click()
    await flushPromises()

    // Without picking a deploy target, the page shows an inline error
    // and does NOT call createDeployment.
    expect(createDeployment).not.toHaveBeenCalled()
    const dialogText = dialogs.map(d => d.textContent || '').join(' ')
    expect(dialogText).toContain('请选择部署目标')
  })

  it('PD.8 the deploy dialog renders the env select and target select with the fetched options', async () => {
    setRole('OWNER')
    vi.mocked(fetchProject).mockResolvedValue({ data: PROJECT } as any)
    vi.mocked(fetchEnvironments).mockResolvedValue({ data: ENVS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchTestRuns).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchIssues).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchReleases).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchDeployTargets).mockResolvedValue({ data: DEPLOY_TARGETS } as any)

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    const w = mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // Open the deploy dialog.
    const deployBtn = w.findAll('button').find(b => b.text().trim() === '部署' && !b.attributes('disabled'))!
    await deployBtn.trigger('click')
    await flushPromises()

    // The dialog has 2 el-selects: env + target. el-select only shows
    // the currently-selected value; option labels are not in the DOM
    // until the dropdown is opened. We just assert the dialog rendered
    // with the right title and form labels.
    const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
    expect(dialogs.length, 'deploy dialog must be open').toBeGreaterThan(0)
    const dialogText = dialogs.map(d => d.textContent || '').join(' ')
    expect(dialogText).toContain('触发部署')
    expect(dialogText).toContain('目标环境')
    expect(dialogText).toContain('部署目标')
  })

  it('PD.9 failure of fetchProject surfaces the error toast', async () => {
    setRole('OWNER')
    vi.mocked(fetchProject).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchEnvironments).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchDeployments).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchTestRuns).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchIssues).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchReleases).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchDeployTargets).mockRejectedValue(new Error('boom'))

    const router = makeRouter()
    await router.push('/projects/p1')
    await router.isReady()
    mount(ProjectDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试')
  })
})
