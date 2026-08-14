/**
 * TEST-WEB-02 / AppLayout
 *
 * Top-level chrome: global search input, role-gated "触发部署" button,
 * the always-on "新建资源" button, the seven nav pills with route-driven
 * active state, the avatar letter, and the avatar dropdown's "退出登录"
 * item that calls `auth.logout()`.
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

// No API calls in this page; use a router that satisfies the inline
// `useRouter`/`useRoute` calls.
import { useAuthStore } from '../stores/auth'
import AppLayout from './AppLayout.vue'

function makeRouter(initialPath = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: AppLayout },
      { path: '/projects', name: 'projects', component: { template: '<div/>' } },
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
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

describe('AppLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const k of Object.keys(store)) delete store[k]
    lastHash = null
  })

  it('A.1.1 the "触发部署" header button is shown for canDeploy roles and hidden for others', async () => {
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

  it('A.1.2 the "新建资源" header button is shown for every role', async () => {
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

  it('A.1.3 the seven nav pills are rendered in the expected order', async () => {
    setUser({ role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    // Nav pills are inside <nav class="nav-row">; query it specifically
    // to avoid picking up duplicates from any teleported copy.
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

  it('A.1.4 the active pill follows the current route (one assertion per top-level section)', async () => {
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

  it('A.1.5 the avatar letter is the first character of displayName, upper-cased', async () => {
    setUser({ displayName: 'alice', account: 'admin', role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('A')
  })

  it('A.1.6 the avatar falls back to the first character of account when displayName is missing', async () => {
    setUser({ displayName: undefined, account: 'bob', role: 'OWNER' })
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('B')
  })

  it('A.1.7 the avatar shows "?" when there is no user', async () => {
    setActivePinia(createPinia())
    const router = makeRouter('/')
    const w = mount(AppLayout, {
      global: { plugins: [router, ElementPlus] },
    })
    await router.isReady()

    expect(w.find('.avatar').text()).toBe('?')
  })

  it('A.1.8 the dropdown logout item calls auth.logout()', async () => {
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

    // The dropdown's @click="auth.logout()" listens to the el-dropdown-item
    // component's `click` emit. We find the right item via findAllComponents
    // (teleported nodes are still in the component tree) and emit the
    // event programmatically.
    const items = w.findAllComponents({ name: 'ElDropdownItem' })
    const logoutItem = items.find(c => c.text().trim() === '退出登录')
    expect(logoutItem, 'el-dropdown-item for "退出登录" must exist').toBeDefined()

    await logoutItem!.vm.$emit('click')
    await flushPromises()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
  })
})
