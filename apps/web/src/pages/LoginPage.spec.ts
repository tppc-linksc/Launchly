/**
 * TEST-WEB-02 / LoginPage
 *
 * Core login form behavior:
 * - Render: account + password fields + submit button
 * - Success: call login(), persist tokens via auth.setAuth, redirect to #/
 * - Failure (with server message): show el-alert with message
 * - Failure (no server message): show fallback "账号或密码错误"
 * - Loading state: button :loading while the request is in flight
 *
 * White-list: this file only. The page SFC and the api/auth store are
 * imported as production modules. All network and persistence are
 * mocked — there is no real /api/auth/login call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'

// Element Plus must be globally registered so el-card, el-form, el-button,
// el-input, el-alert render real components (their @click/@submit
// handlers are what we drive from the tests).
import ElementPlus from 'element-plus'

// jsdom does not provide a real localStorage by default. The auth store's
// `setAuth` calls `localStorage.setItem` and would throw, which onSubmit
// would catch and surface as a fake failure. Stub it.
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

// Mock ONLY the API functions this page touches. Anything else from
// ../api/client is a "not configured" call and must fail loudly.
vi.mock('../api/client', () => ({
  login: vi.fn(),
}))

import { login } from '../api/client'
import { useAuthStore } from '../stores/auth'
import LoginPage from './LoginPage.vue'

// Stable window.location.hash target for redirect assertions.
let lastHash: string | null = null
Object.defineProperty(window, 'location', {
  value: {
    get hash() {
      return lastHash ?? ''
    },
    set hash(v: string) {
      lastHash = v
    },
    set href(v: string) {
      lastHash = new URL(v).hash
    },
    get href() {
      return lastHash ?? ''
    },
  },
  configurable: true,
})

// Tiny router — LoginPage only needs `useRouter` for `window.location.hash`
// assignment, not actual navigation, but the import is part of the page.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/login', name: 'login', component: LoginPage },
    ],
  })
}

describe('LoginPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(login).mockReset()
    lastHash = null
    for (const k of Object.keys(store)) delete store[k]
  })

  it('L.1.1 renders account, password fields and the submit button', async () => {
    const wrapper = mount(LoginPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    expect(wrapper.find('input[placeholder="邮箱地址"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    // The button label is "登录"
    expect(wrapper.text()).toContain('登录')
  })

  it('L.1.2 successful login persists tokens via auth.setAuth and redirects to #/', async () => {
    const authPayload = {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      user: { id: 'u-1', account: 'admin', role: 'OWNER' },
      workspace: { id: 'w-1', name: 'Test' },
    }
    vi.mocked(login).mockResolvedValue({ data: authPayload } as any)

    const wrapper = mount(LoginPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    const auth = useAuthStore()

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('admin@x.com')
    await wrapper.find('input[type="password"]').setValue('secret-1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ account: 'admin@x.com', password: 'secret-1' })
    expect(auth.user).toEqual({ id: 'u-1', account: 'admin', role: 'OWNER' })
    expect(auth.workspace).toEqual({ id: 'w-1', name: 'Test' })
    expect(localStorage.getItem('accessToken')).toBe('at-1')
    expect(localStorage.getItem('refreshToken')).toBe('rt-1')
    expect(lastHash).toBe('#/')
  })

  it('L.1.3 failure with a server message shows that message in the el-alert', async () => {
    vi.mocked(login).mockRejectedValue({
      response: { data: { message: '账号已被锁定' } },
    })

    const wrapper = mount(LoginPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('bad')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(login).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('账号已被锁定')
  })

  it('L.1.4 failure without a server message falls back to "账号或密码错误"', async () => {
    vi.mocked(login).mockRejectedValue(new Error('network down'))

    const wrapper = mount(LoginPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('bad')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('账号或密码错误')
  })

  it('L.1.5 the submit button enters loading state while the request is in flight', async () => {
    let resolveLogin!: (v: any) => void
    vi.mocked(login).mockReturnValue(new Promise<any>((res) => { resolveLogin = res }))

    const wrapper = mount(LoginPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('p')
    const submitPromise = wrapper.find('form').trigger('submit.prevent')
    await nextTick()
    // While the promise is still pending, the button is disabled (loading).
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    resolveLogin({ data: { accessToken: 'a', refreshToken: 'b', user: { id: 'u' }, workspace: { id: 'w' } } })
    await submitPromise
    await flushPromises()
    // After the promise resolves, the button is enabled again.
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})
