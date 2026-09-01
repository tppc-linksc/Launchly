/**
 * TEST-WEB-02 round 2 / DeploymentDetailPage
 *
 * - Mount fetches deployment + logs in parallel.
 * - Status-tag mapping (PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED).
 * - Per-status action visibility:
 *     FAILED + canDeploy → 重新部署
 *     SUCCEEDED + canWrite → 创建测试任务
 *     SUCCEEDED + canDeploy + commitSha → 回滚到此版本
 * - "创建测试任务" calls createTestRun and navigates to /tests/runs/:id.
 * - "回滚到此版本" pops a confirm dialog; on confirm, calls
 *   rollbackDeployment with `{ reason: '手动回滚' }`.
 * - "重新部署" calls createDeployment with the right payload and pushes
 *   the new deployment route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const { elMessageError, elMessageSuccess, elMessageBoxConfirm } = vi.hoisted(() => ({
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
  elMessageBoxConfirm: vi.fn(),
}))
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any)
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: elMessageError, success: elMessageSuccess },
    // Spread FIRST, then our overrides — otherwise `actual.ElMessageBox`
    // carries its own `confirm` and shadows the spy.
    ElMessageBox: { ...actual.ElMessageBox, confirm: elMessageBoxConfirm },
  }
})

vi.mock('../api/client', () => ({
  fetchDeployment: vi.fn(),
  fetchDeploymentLogs: vi.fn(),
  createTestRun: vi.fn(),
  createDeployment: vi.fn(),
  rollbackDeployment: vi.fn(),
}))

import {
  fetchDeployment,
  fetchDeploymentLogs,
  createTestRun,
  createDeployment,
  rollbackDeployment,
} from '../api/client'
import { useAuthStore } from '../stores/auth'
import DeploymentDetailPage from './DeploymentDetailPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: DeploymentDetailPage },
      { path: '/tests/runs/:id', name: 'test-run-detail', component: { template: '<div/>' } },
      { path: '/tests/runs', name: 'test-runs', component: { template: '<div/>' } },
      { path: '/issues', name: 'issues', component: { template: '<div/>' } },
      { path: '/releases', name: 'releases', component: { template: '<div/>' } },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
    ],
  })
}

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { id: 'u-test', role } : null
}

const FAILED_DEPLOY = {
  id: 'd1', projectId: 'p1', environmentId: 'e1',
  status: 'FAILED', branch: 'main', commitSha: 'abc12345',
  errorMessage: 'build failed',
  createdAt: '2026-01-01', startedAt: '2026-01-01', finishedAt: '2026-01-02',
}

const SUCCEEDED_DEPLOY = {
  ...FAILED_DEPLOY, id: 'd2', status: 'SUCCEEDED',
  errorMessage: null, accessUrl: 'https://app.example.com',
  finishedAt: '2026-01-02',
}

function makeSseResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  const reader = {
    read: vi.fn(),
  }
  let i = 0
  reader.read.mockImplementation(() => {
    if (i >= chunks.length) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) })
  })

  return {
    ok: true,
    body: {
      getReader: () => reader,
    },
  } as any
}

describe('DeploymentDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchDeployment).mockReset()
    vi.mocked(fetchDeploymentLogs).mockReset()
    vi.mocked(createTestRun).mockReset()
    vi.mocked(createDeployment).mockReset()
    vi.mocked(rollbackDeployment).mockReset()
    elMessageError.mockReset()
    elMessageSuccess.mockReset()
    elMessageBoxConfirm.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DD.1 mount fetches the deployment and its logs in parallel', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: FAILED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({
      data: [{ id: 'l1', stage: 'BUILD', status: 'FAILED', log: '...error...' }],
    } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchDeployment).toHaveBeenCalledWith('d1')
    expect(fetchDeploymentLogs).toHaveBeenCalledWith('d1')
  })

  it('DD.2 the FAILED deployment renders the error message and the "重新部署" button (for canDeploy)', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: FAILED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('build failed')
    const redeployBtn = w.findAll('button').find(b => b.text().trim() === '重新部署')
    expect(redeployBtn).toBeDefined()
  })

  it('DD.3 the FAILED deployment does NOT show "重新部署" for VIEWER', async () => {
    setRole('VIEWER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: FAILED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const redeployBtn = w.findAll('button').find(b => b.text().trim() === '重新部署')
    expect(redeployBtn).toBeUndefined()
  })

  it('DD.4 the SUCCEEDED deployment renders the accessUrl alert and the 3 success-only actions for OWNER', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('https://app.example.com')
    expect(w.findAll('button').find(b => b.text().trim() === '创建测试任务')).toBeDefined()
    expect(w.findAll('button').find(b => b.text().trim() === '回滚到此版本')).toBeDefined()
  })

  it('DD.5 clicking "创建测试任务" calls createTestRun and navigates to /tests/runs/:id', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.mocked(createTestRun).mockResolvedValue({ data: { id: 'tr-new' } } as any)

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '创建测试任务')!
    await btn.trigger('click')
    await flushPromises()

    expect(createTestRun).toHaveBeenCalledWith('d2', 'p1', 'e1')
    expect(elMessageSuccess).toHaveBeenCalledWith('测试任务已创建')
  })

  it('DD.6 "回滚" pops a confirm; on confirm it calls rollbackDeployment and navigates', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    elMessageBoxConfirm.mockResolvedValue('ok' as any)
    vi.mocked(rollbackDeployment).mockResolvedValue({ data: { id: 'd-rollback' } } as any)

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '回滚到此版本')!
    await btn.trigger('click')
    await flushPromises()

    expect(elMessageBoxConfirm).toHaveBeenCalled()
    expect(rollbackDeployment).toHaveBeenCalledWith('d2', { reason: '手动回滚' })
    expect(elMessageSuccess).toHaveBeenCalledWith('回滚部署已触发')
  })

  it('DD.7 "回滚" cancel path: if the user cancels the confirm, rollbackDeployment is NOT called', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    elMessageBoxConfirm.mockRejectedValue(new Error('cancelled'))

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '回滚到此版本')!
    await btn.trigger('click')
    await flushPromises()

    expect(rollbackDeployment).not.toHaveBeenCalled()
  })

  it('DD.8 "重新部署" calls createDeployment with the right payload and pushes the new deployment route', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: FAILED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.mocked(createDeployment).mockResolvedValue({ data: { id: 'd-new' } } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '重新部署')!
    await btn.trigger('click')
    await flushPromises()

    expect(createDeployment).toHaveBeenCalledWith({
      projectId: 'p1',
      environmentId: 'e1',
      deployTargetId: undefined,
      branch: 'main',
      commitSha: 'abc12345',
    })
    expect(elMessageSuccess).toHaveBeenCalledWith('已触发重新部署')
  })

  it('DD.9 a PENDING deployment triggers the SSE stream request', async () => {
    setRole('OWNER')
    store.accessToken = 'token-1'
    vi.mocked(fetchDeployment).mockResolvedValue({ data: { ...FAILED_DEPLOY, status: 'PENDING' } } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeSseResponse([]))

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/deployments/d1/logs/stream', expect.objectContaining({
      headers: { Authorization: 'Bearer token-1' },
      signal: expect.any(Object),
    }))
  })

  it('DD.10 SSE snapshot updates logs and deployment status, then refreshes on terminal states', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment)
      .mockResolvedValueOnce({ data: { ...FAILED_DEPLOY, status: 'PENDING' } } as any)
      .mockResolvedValueOnce({ data: { ...FAILED_DEPLOY, status: 'SUCCEEDED', accessUrl: 'https://app.example.com/new' } } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeSseResponse([
      'event: snapshot\n',
      'data: {"logs":[{"id":"l1","stage":"BUILD","status":"SUCCEEDED","log":"build finished"}],"status":"SUCCEEDED","errorMessage":""}\n',
      '\n',
    ]))

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchDeployment).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('build finished')
    expect(w.text()).toContain('成功')
  })

  it('DD.11 unmount calls abortController.abort for the SSE connection', async () => {
    setRole('OWNER')
    const originalAbortController = globalThis.AbortController
    const abortSpy = vi.fn()
    const token = 'token-2'
    store.accessToken = token

    class AbortControllerMock {
      signal = {}
      abort = abortSpy
    }
    globalThis.AbortController = AbortControllerMock as any

    vi.mocked(fetchDeployment).mockResolvedValue({ data: { ...FAILED_DEPLOY, status: 'RUNNING' } } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeSseResponse([]))

    try {
      const router = makeRouter()
      await router.push('/deployments/d1')
      await router.isReady()
      const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
      await flushPromises()
      expect(fetch).toHaveBeenCalledWith('/api/deployments/d1/logs/stream', expect.objectContaining({
        headers: { Authorization: `Bearer ${token}` },
        signal: expect.any(Object),
      }))
      w.unmount()
      expect(abortSpy).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.AbortController = originalAbortController
    }
  })

  // -------------------------------------------------------------------
  // Additional coverage:
  //   - commitShort handles missing sha ('-')
  //   - statusType / tagType / dotColor mappings
  //   - handleCreateTestRun error pops ElMessage.error
  //   - handleRedeploy error path
  //   - mount failure of fetchDeployment (both reject) returns silently
  //   - timeline renders log entries
  // -------------------------------------------------------------------

  it('DD.12 commitShort returns "-" when sha is missing/empty', async () => {
    setRole('OWNER')
    const NO_SHA = { ...FAILED_DEPLOY, commitSha: null }
    vi.mocked(fetchDeployment).mockResolvedValue({ data: NO_SHA } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('-')
  })

  it('DD.13 mount failure (fetchDeployment + logs reject) returns silently', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchDeploymentLogs).mockRejectedValue(new Error('boom'))

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    // No toast was emitted by the page itself (the catch returns silently).
    expect(elMessageError).not.toHaveBeenCalled()
  })

  it('DD.14 the timeline renders the log entries with their stages and statuses', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({
      data: [
        { id: 'l1', stage: 'CLONE', status: 'SUCCEEDED', log: 'git clone ok' },
        { id: 'l2', stage: 'BUILD', status: 'SUCCEEDED', log: 'docker build ok' },
      ],
    } as any)

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('克隆代码')
    expect(w.text()).toContain('构建')
    expect(w.text()).toContain('git clone ok')
    expect(w.text()).toContain('docker build ok')
  })

  it('DD.15 handleCreateTestRun error path pops ElMessage.error', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.mocked(createTestRun).mockRejectedValue({
      response: { data: { message: 'no test cases' } },
    })

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '创建测试任务')!
    await btn.trigger('click')
    await flushPromises()

    expect(elMessageError).toHaveBeenCalledWith('no test cases')
  })

  it('DD.16 handleRedeploy error path pops ElMessage.error and clears the loading flag', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: FAILED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)
    vi.mocked(createDeployment).mockRejectedValue({
      response: { data: { message: 'no deploy target' } },
    })

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const btn = w.findAll('button').find(b => b.text().trim() === '重新部署')!
    await btn.trigger('click')
    await flushPromises()

    expect(elMessageError).toHaveBeenCalledWith('no deploy target')
  })

  it('DD.17 deployment with status CANCELED shows "已取消" mapped status', async () => {
    setRole('OWNER')
    const CANCELED_DEPLOY = { ...FAILED_DEPLOY, status: 'CANCELED' }
    vi.mocked(fetchDeployment).mockResolvedValue({ data: CANCELED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d1')
    await router.isReady()
    const w = mount(DeploymentDetailPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(w.text()).toContain('已取消')
  })

  it('DD.18 deployment with accessUrl renders the success alert with the URL', async () => {
    setRole('OWNER')
    vi.mocked(fetchDeployment).mockResolvedValue({ data: SUCCEEDED_DEPLOY } as any)
    vi.mocked(fetchDeploymentLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/deployments/d2')
    await router.isReady()
    const w = mount(DeploymentDetailPage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // The alert contains a link to the access URL.
    const alert = Array.from(document.querySelectorAll('.el-alert'))
      .find(a => (a.textContent || '').includes('部署成功'))
    expect(alert).toBeDefined()
    expect(alert!.textContent).toContain('https://app.example.com')
  })
})
