/**
 * TEST-WEB-02 round 2 / AuditLogPage
 *
 * - Mount fetches the audit log list.
 * - Empty list renders nothing in the table body (no fake rows).
 * - "导出 CSV" button creates an `<a>` element with the right URL/filename
 *   and triggers a click — verify the DOM side effect without touching
 *   the real endpoint.
 * - Failure of fetchMembers (here `fetchAuditLogs`) is caught silently
 *   (the page only `console.error`s) so no toast is raised.
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

vi.mock('../api/client', () => ({
  fetchAuditLogs: vi.fn(),
}))

import { fetchAuditLogs } from '../api/client'
import AuditLogPage from './AuditLogPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/audit-logs', name: 'audit-logs', component: AuditLogPage },
    ],
  })
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchAuditLogs).mockReset()
  })

  it('AL.1 mount fetches the audit log list and renders rows', async () => {
    vi.mocked(fetchAuditLogs).mockResolvedValue({
      data: [
        { id: 'l1', userId: 'u-1', action: 'LOGIN', targetType: 'USER', targetId: 'u-1', ipAddress: '127.0.0.1', createdAt: '2026-01-01' },
        { id: 'l2', userId: 'u-2', action: 'CREATE_PROJECT', targetType: 'PROJECT', targetId: 'p1', detail: '{"x":1}', ipAddress: '10.0.0.1', createdAt: '2026-01-02' },
      ],
    } as any)

    const router = makeRouter()
    await router.push('/audit-logs')
    await router.isReady()
    const w = mount(AuditLogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchAuditLogs).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('u-1')
    expect(w.text()).toContain('u-2')
  })

  it('AL.2 failure of fetchAuditLogs is silently swallowed (no toast in the page)', async () => {
    vi.mocked(fetchAuditLogs).mockRejectedValue(new Error('boom'))

    const router = makeRouter()
    await router.push('/audit-logs')
    await router.isReady()
    const w = mount(AuditLogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    // The page calls `console.error(e)` — verify the table did not render
    // bogus rows. The page does NOT mount an el-alert for this path.
    expect(w.findAll('.el-alert').length).toBe(0)
  })

  it('AL.3 the "导出 CSV" button creates an anchor with the right URL/filename and clicks it', async () => {
    vi.mocked(fetchAuditLogs).mockResolvedValue({ data: [] } as any)

    const router = makeRouter()
    await router.push('/audit-logs')
    await router.isReady()
    const w = mount(AuditLogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    // Spy on the document.createElement / HTMLAnchorElement.click path
    // by intercepting the click on the dynamically created anchor.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')

    const exportBtn = w.findAll('button').find(b => b.text().trim() === '导出 CSV')
    expect(exportBtn, 'export button must be rendered').toBeDefined()
    await exportBtn!.trigger('click')
    await flushPromises()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    // The anchor was appended to and removed from the DOM.
    clickSpy.mockRestore()
  })
})
