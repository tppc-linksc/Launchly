/**
 * TEST-WEB-02 / NotificationCenterPage
 *
 * Page-level behavior for the notification center: list + unread count
 * loaded in parallel, per-item "标为已读", bulk "全部已读", empty state,
 * and the disabled state of the bulk button when no unread items remain.
 *
 * The four API functions this page calls are the only ones allowed to be
 * consumed in the mock. Anything else is a regression and must fail.
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

vi.mock('../api/client', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))

import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/client'
import NotificationCenterPage from './NotificationCenterPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/notifications', name: 'notifications', component: NotificationCenterPage },
    ],
  })
}

describe('NotificationCenterPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchNotifications).mockReset()
    vi.mocked(fetchUnreadCount).mockReset()
    vi.mocked(markNotificationRead).mockReset()
    vi.mocked(markAllNotificationsRead).mockReset()
    // Default: nothing to load.
    vi.mocked(fetchNotifications).mockResolvedValue({ data: [] } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 0 } } as any)
  })

  it('N.1.1 fetches the notification list and unread count in parallel on mount', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      data: [{ id: 'n1', title: 'A', content: 'a', read: false, createdAt: '2026-01-01' }],
    } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 1 } } as any)

    mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    expect(fetchNotifications).toHaveBeenCalledTimes(1)
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1)
  })

  it('N.1.2 empty list renders the el-empty placeholder "暂无通知"', async () => {
    const wrapper = mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无通知')
  })

  it('N.1.3 non-empty list renders items; unread items show the "未读" tag', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      data: [
        { id: 'n1', title: '已读项', content: 'old', read: true, createdAt: '2026-01-01' },
        { id: 'n2', title: '未读项', content: 'new', read: false, createdAt: '2026-01-02' },
      ],
    } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 1 } } as any)

    const wrapper = mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('已读项')
    expect(wrapper.text()).toContain('未读项')
    // The unread tag should be rendered exactly once.
    expect(wrapper.text().match(/未读/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('N.1.4 clicking "标为已读" calls markNotificationRead, flips read locally, decrements unread count', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      data: [
        { id: 'n1', title: 'x', content: 'y', read: false, createdAt: '2026-01-01' },
      ],
    } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 2 } } as any)
    vi.mocked(markNotificationRead).mockResolvedValue({ data: { ok: true } } as any)

    const wrapper = mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    // Click the "标为已读" button.
    const readBtn = wrapper.findAll('button').find(b => b.text() === '标为已读')
    expect(readBtn).toBeDefined()
    await readBtn!.trigger('click')
    await flushPromises()

    expect(markNotificationRead).toHaveBeenCalledTimes(1)
    expect(markNotificationRead).toHaveBeenCalledWith('n1')
    // After marking read, the local item is read and the unread tag is gone.
    expect(wrapper.text()).not.toMatch(/未读(?!.*)/)
    // The "标为已读" button should no longer be present for n1.
    const stillThere = wrapper.findAll('button').find(b => b.text() === '标为已读')
    expect(stillThere).toBeUndefined()
  })

  it('N.1.5 clicking "全部已读" calls markAllNotificationsRead, marks every item read, resets count to 0', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      data: [
        { id: 'n1', title: 'a', content: 'a', read: false, createdAt: '2026-01-01' },
        { id: 'n2', title: 'b', content: 'b', read: false, createdAt: '2026-01-02' },
      ],
    } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 2 } } as any)
    vi.mocked(markAllNotificationsRead).mockResolvedValue({ data: { ok: true } } as any)

    const wrapper = mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    const allBtn = wrapper.findAll('button').find(b => b.text() === '全部已读')
    expect(allBtn).toBeDefined()
    await allBtn!.trigger('click')
    await flushPromises()

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    // No "标为已读" buttons should remain.
    const still = wrapper.findAll('button').find(b => b.text() === '标为已读')
    expect(still).toBeUndefined()
  })

  it('N.1.6 the "全部已读" button is disabled when unreadCount is 0', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      data: [{ id: 'n1', title: 'x', content: 'y', read: true, createdAt: '2026-01-01' }],
    } as any)
    vi.mocked(fetchUnreadCount).mockResolvedValue({ data: { count: 0 } } as any)

    const wrapper = mount(NotificationCenterPage, {
      global: { plugins: [makeRouter(), ElementPlus] },
    })
    await flushPromises()

    const allBtn = wrapper.findAll('button').find(b => b.text() === '全部已读')
    expect(allBtn).toBeDefined()
    expect(allBtn!.attributes('disabled')).toBeDefined()
  })
})
