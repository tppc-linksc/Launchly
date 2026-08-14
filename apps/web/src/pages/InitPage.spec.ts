/**
 * TEST-WEB-02 / InitPage
 *
 * Bootstrap initialization form: account + password + displayName +
 * workspaceName. The page calls `createOwner(...)` exactly once, surfaces
 * the server error if any, and shows an `el-result` success block on
 * success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'

// Stub localStorage (jsdom does not provide it by default).
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

// Stub window.location.hash for the "前往登录" navigation. InitPage
// navigates by `$router.push('/login')`, not by `window.location.hash`,
// so this is only a safety net.
let lastHash: string | null = null
Object.defineProperty(window, 'location', {
  value: {
    get hash() { return lastHash ?? '' },
    set hash(v: string) { lastHash = v },
  },
  configurable: true,
})

vi.mock('../api/client', () => ({
  createOwner: vi.fn(),
}))

import { createOwner } from '../api/client'
import InitPage from './InitPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/init', name: 'init', component: InitPage },
      { path: '/login', name: 'login', component: { template: '<div/>' } },
    ],
  })
}

describe('InitPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(createOwner).mockReset()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('I.1.1 renders account, password, displayName, workspaceName fields and the submit button', async () => {
    const wrapper = mount(InitPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    expect(wrapper.find('input[placeholder="邮箱地址"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    // The page renders four el-input fields; the four placeholders are
    // distinct enough to assert each is present.
    expect(wrapper.find('input[placeholder="可选"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="例如：My Team"]').exists()).toBe(true)
    // Submit button label.
    expect(wrapper.text()).toContain('创建管理员并初始化')
  })

  it('I.1.2 successful submit calls createOwner and shows the el-result success block', async () => {
    vi.mocked(createOwner).mockResolvedValue({ data: { ok: true } } as any)

    const wrapper = mount(InitPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('admin@x.com')
    await wrapper.find('input[type="password"]').setValue('Strong-1')
    await wrapper.find('input[placeholder="例如：My Team"]').setValue('My Team')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(createOwner).toHaveBeenCalledTimes(1)
    expect(createOwner).toHaveBeenCalledWith({
      account: 'admin@x.com',
      password: 'Strong-1',
      displayName: undefined,
      workspaceName: 'My Team',
    })
    // Success block: "初始化完成" + a "前往登录" button.
    expect(wrapper.text()).toContain('初始化完成')
  })

  it('I.1.3 failure with a server message surfaces that message in the el-alert', async () => {
    vi.mocked(createOwner).mockRejectedValue({
      response: { data: { message: '工作区已存在' } },
    })

    const wrapper = mount(InitPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('Strong-1')
    await wrapper.find('input[placeholder="例如：My Team"]').setValue('WS')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('工作区已存在')
    // No success block on failure.
    expect(wrapper.text()).not.toContain('初始化完成')
  })

  it('I.1.4 failure without a server message falls back to "初始化失败，请重试"', async () => {
    vi.mocked(createOwner).mockRejectedValue(new Error('network'))

    const wrapper = mount(InitPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('Strong-1')
    await wrapper.find('input[placeholder="例如：My Team"]').setValue('WS')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('初始化失败，请重试')
  })

  it('I.1.5 empty displayName is sent as `undefined` (not empty string)', async () => {
    vi.mocked(createOwner).mockResolvedValue({ data: { ok: true } } as any)

    const wrapper = mount(InitPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })

    await wrapper.find('input[placeholder="邮箱地址"]').setValue('a@x.com')
    await wrapper.find('input[type="password"]').setValue('Strong-1')
    // displayName is left empty (placeholder "可选")
    await wrapper.find('input[placeholder="例如：My Team"]').setValue('WS')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    const payload = vi.mocked(createOwner).mock.calls.at(0)![0] as any
    expect(payload.displayName).toBeUndefined()
    expect(payload).not.toHaveProperty('displayName', '')
  })
})
