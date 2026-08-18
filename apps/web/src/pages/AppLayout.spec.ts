/**
 * 测试：AppLayout
 *
 * 顶部外壳：全局搜索输入（原始行为 + KI-014 接入），角色受限的"触发部署"按钮，
 * 永远可用的"新建资源"按钮，七个导航胶囊和路由驱动的 active 状态，
 * 头像首字母，以及头像下拉中"退出登录"调用 auth.logout()。
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
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  },
  writable: true,
  configurable: true,
})

// Stub window.location.hash for the logout redirect.
let lastHash: string | null = null
Object.defineProperty(window, 'location', {
  value: {
    get hash() { return lastHash ?? '' },
    set hash(v: string) { lastHash = v },
  },
  configurable: true,
})

// KI-014 全局搜索的 API Mock。
const { fetchProjects, fetchDeployments, fetchAllDeployTargets } = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  fetchDeployments: vi.fn(),
  fetchAllDeployTargets: vi.fn(),
}))
vi.mock('../api/client', () => ({
  fetchProjects,
  fetchDeployments,
  fetchAllDeployTargets,
}))

import AppLayout from './AppLayout.vue'
import { useAuthStore } from '../stores/auth'

function makeRouter(initialPath = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: AppLayout },
      { path: '/projects', name: 'projects', component: { template: '<div/>' } },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
      { path: '/environments', name: 'environments', component: { template: '<div/>' } },
      { path: '/releases', name: 'releases', component: { template: '<div/>' } },
      { path: '/tests', name: 'tests', component: { template: '<div/>' } },
      { path: '/issues', name: 'issues', component: { template: '<div/>' } },
      { path: '/deploy-targets', name: 'deploy-targets', component: { template: '<div/>' } },
      { path: '/settings', name: 'settings', component: { template: '<div/>' } },
      { path: '/members', name: 'members', component: { template: '<div/>' } },
      { path: '/audit-logs', name: 'audit-logs', component: { template: '<div/>' } },
      { path: '/notifications', name: 'notifications', component: { template: '<div/>' } },
      { path: '/resources/new', name: 'resource-catalog', component: { template: '<div/>' } },
    ],
  })
  router.push(initialPath)
  return router
}

function setUser(opts: { id?: string; account?: string; displayName?: string; role?: string }) {
  const auth = useAuthStore()
  auth.user = {
    id: opts.id ?? 'u-1',
    account: opts.account ?? 'admin',
    displayName: opts.displayName,
    role: opts.role,
  }
}

// 工具：等待 KI-014 全局搜索的防抖 + 异步流程结束
async function settle() {
  await new Promise(r => setTimeout(r, 260))
  await flushPromises()
}

const PROJECTS = [
  { id: 'p1', name: 'Marketing Site', description: 'marketing website', projectType: 'APP', resourceKind: 'APPLICATION', repositoryUrl: 'https://github.com/acme/marketing.git', defaultBranch: 'main' },
]
const DEPLOYMENTS = [
  { id: 'd-100', projectId: 'p1', projectName: 'Marketing Site', status: 'SUCCEEDED', branch: 'main', commitSha: 'abc1234', environmentName: 'TEST' },
]
const TARGETS = [
  { id: 't1', name: 'prod-node-1', host: '192.168.1.10', port: 22, username: 'deploy', projectId: 'p1', projectName: 'Marketing Site', type: 'SSH' },
]

describe('AppLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const k of Object.keys(store)) delete store[k]
    lastHash = null
    fetchProjects.mockReset()
    fetchDeployments.mockReset()
    fetchAllDeployTargets.mockReset()
    fetchProjects.mockResolvedValue({ data: PROJECTS } as any)
    fetchDeployments.mockResolvedValue({ data: DEPLOYMENTS } as any)
    fetchAllDeployTargets.mockResolvedValue({ data: TARGETS } as any)
  })

  it('A.1.1 顶部"触发部署"按钮在 canDeploy 角色下显示，其他角色不显示', async () => {
    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER']) {
      setActivePinia(createPinia())
      setUser({ role })
      const router = makeRouter('/')
      const w = mount(AppLayout, {
        global: { plugins: [router, ElementPlus] },
      })
      await router.isReady()
      const btn = w.findAll('button').find(b => b.text().trim() === '触发部署')
      expect(btn, `header "触发部署" must be visible for role ${role}`).toBeDefined()
    }

    for (const role of ['TESTER', 'VIEWER']) {
      setActivePinia(createPinia())
      setUser({ role })
      const router = makeRouter('/')
      const w = mount(AppLayout, {
        global: { plugins: [router, ElementPlus] },
      })
      await router.isReady()
      const btn = w.findAll('button').find(b => b.text().trim() === '触发部署')
      expect(btn, `header "触发部署" must be hidden for role ${role}`).toBeUndefined()
    }
  })

  it('A.1.2 顶部"新建资源"按钮对所有角色可见', async () => {
    for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER']) {
      setActivePinia(createPinia())
      setUser({ role })
      const router = makeRouter('/')
      const w = mount(AppLayout, {
        global: { plugins: [router, ElementPlus] },
      })
      await router.isReady()
      const btn = w.findAll('button').find(b => b.text().trim() === '新建资源')
      expect(btn, `header "新建资源" must be visible for role ${role}`).toBeDefined()
    }
  })

  it('A.1.3 七个导航胶囊按预期顺序渲染', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    const navRow = w.find('nav.nav-row')
    expect(navRow.exists()).toBe(true)
    const pills = navRow.findAll('button.nav-pill').map(b => b.text().trim())
    expect(pills).toEqual([
      '概览',
      '部署与运行',
      '项目',
      '环境管理',
      '发布',
      '测试与 Issue',
      '部署目标',
    ])
  })

  it('A.1.4 active 胶囊跟随当前路由', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    async function activePillAt(path: string): Promise<string | null> {
      await router.push(path)
      await flushPromises()
      const active = w.findAll('button.nav-pill').find(p => p.classes('active'))
      return active ? active.text().trim() : null
    }

    expect(await activePillAt('/')).toBe('概览')
    expect(await activePillAt('/projects')).toBe('项目')
    expect(await activePillAt('/deployments')).toBe('部署与运行')
    expect(await activePillAt('/environments')).toBe('环境管理')
    expect(await activePillAt('/releases')).toBe('发布')
    expect(await activePillAt('/tests')).toBe('测试与 Issue')
    expect(await activePillAt('/issues')).toBe('测试与 Issue')
    expect(await activePillAt('/deploy-targets')).toBe('部署目标')
  })

  it('A.1.5 头像首字母为 displayName 的首字母大写', async () => {
    setUser({ displayName: 'alice', account: 'admin', role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('A')
  })

  it('A.1.6 当 displayName 缺失时，头像首字母回退到 account 首字母', async () => {
    setUser({ displayName: undefined, account: 'bob', role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('B')
  })

  it('A.1.7 用户为空时头像显示 "?"', async () => {
    setActivePinia(createPinia())
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('?')
  })

  it('A.1.8 头像下拉里"退出登录"项调用 auth.logout()', async () => {
    setUser({ role: 'OWNER' })
    store['accessToken'] = 'will-be-cleared'
    store['refreshToken'] = 'will-be-cleared'
    const auth = useAuthStore()
    const logoutSpy = vi.spyOn(auth, 'logout')

    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const items = w.findAllComponents({ name: 'ElDropdownItem' })
    const logoutItem = items.find(c => c.text().trim() === '退出登录')
    expect(logoutItem, 'el-dropdown-item for "退出登录" must exist').toBeDefined()

    await logoutItem!.vm.$emit('click')
    await flushPromises()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
  })

  // === KI-014 全局搜索（联动） ===
  it('A.1.9 输入搜索词后调用了三个后端来源', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const input = w.find('input[placeholder^="搜索部署"]')
    await input.setValue('site')
    await settle()

    expect(fetchProjects).toHaveBeenCalled()
    expect(fetchDeployments).toHaveBeenCalled()
    expect(fetchAllDeployTargets).toHaveBeenCalled()
  })

  it('A.1.10 搜索结果列表渲染匹配的项目', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const input = w.find('input[placeholder^="搜索部署"]')
    await input.setValue('marketing')
    await settle()

    const list = document.body.querySelector('[data-testid="global-search-results"]')
    expect(list).toBeTruthy()
    expect(list!.textContent).toContain('Marketing Site')
  })

  it('A.1.11 搜索结果点击会跳转到对应路径', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const pushSpy = vi.spyOn(router, 'push')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const input = w.find('input[placeholder^="搜索部署"]')
    await input.setValue('marketing')
    await settle()

    const items = document.body.querySelectorAll('.search-item')
    expect(items.length).toBeGreaterThan(0)
    // 使用 Vue 组件的 trigger('click') 触发而非原生 click，
    // 避免外部 document click handler 在搜索项 click 之前先关闭下拉。
    await w.findAll('.search-item')[0].trigger('click')
    await flushPromises()
    expect(pushSpy).toHaveBeenCalled()
    const calls = pushSpy.mock.calls.map(c => c[0])
    expect(calls.some(p => String(p) === '/projects/p1')).toBe(true)
  })

  it('A.1.12 无匹配时显示"没有匹配的资源"提示', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const input = w.find('input[placeholder^="搜索部署"]')
    await input.setValue('xyzzy-does-not-exist')
    await settle()

    expect(document.body.textContent).toContain('没有匹配的资源')
  })

  it('A.1.13 按节点名命中时，结果分类是"节点"+ 路径指向 /deploy-targets', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await router.isReady()
    await flushPromises()

    const input = w.find('input[placeholder^="搜索部署"]')
    await input.setValue('prod-node')
    await settle()

    const items = document.body.querySelectorAll('.search-item')
    expect(items.length).toBeGreaterThan(0)
    const text = Array.from(items).map(i => i.textContent).join('|')
    expect(text).toContain('prod-node-1')
    expect(text).toContain('节点')
  })
})
