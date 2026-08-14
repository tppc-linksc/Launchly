/**
 * TEST-WEB-02 round 2 / ResourceCatalogPage
 *
 * - Mount fetches the resource catalog and groups items by category into
 *   the four sections (APPLICATION, DATABASE, CACHE, TEMPLATE).
 * - The search input filters the visible items by title/description.
 * - Empty filter (no matches) renders the `el-empty "没有匹配的资源"`.
 * - Clicking a card calls `router.push('/projects/create?resource=...')`.
 * - DEPLOYABLE items show the green "可部署" tag; non-deployable shows
 *   "仅配置".
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
  fetchResourceCatalog: vi.fn(),
}))

import { fetchResourceCatalog } from '../api/client'
import ResourceCatalogPage from './ResourceCatalogPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/resources/new', name: 'resource-catalog', component: ResourceCatalogPage },
      { path: '/projects/create', name: 'project-create', component: { template: '<div/>' } },
    ],
  })
}

const ITEMS = [
  { id: 'app-public', title: 'Public Git', description: 'Connect a public repo', category: 'APPLICATION', availability: 'DEPLOYABLE' },
  { id: 'app-docker', title: 'OCI Image', description: 'Use a fixed image', category: 'APPLICATION', sourceType: 'OCI_IMAGE', availability: 'DEPLOYABLE' },
  { id: 'db-pg', title: 'PostgreSQL', description: 'Managed Postgres', category: 'DATABASE', availability: 'CONFIG_ONLY', requirements: ['PG14+'] },
  { id: 'cache-redis', title: 'Redis', description: 'In-memory cache', category: 'CACHE', availability: 'CONFIG_ONLY' },
  { id: 'tmpl-blog', title: 'Static Blog', description: 'One-click blog', category: 'TEMPLATE', availability: 'DEPLOYABLE' },
]

describe('ResourceCatalogPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchResourceCatalog).mockReset()
  })

  it('RC.1 mount fetches the catalog and groups items into four section headings', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: ITEMS } as any)

    const router = makeRouter()
    await router.push('/resources/new')
    await router.isReady()
    const w = mount(ResourceCatalogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    expect(fetchResourceCatalog).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('应用与交付来源')
    expect(w.text()).toContain('数据库')
    expect(w.text()).toContain('缓存与队列')
    expect(w.text()).toContain('一键模板')
    // Cards rendered.
    expect(w.text()).toContain('Public Git')
    expect(w.text()).toContain('PostgreSQL')
    expect(w.text()).toContain('Redis')
  })

  it('RC.2 DEPLOYABLE items show the green "可部署" tag, CONFIG_ONLY shows "仅配置"', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: ITEMS } as any)

    const router = makeRouter()
    await router.push('/resources/new')
    await router.isReady()
    const w = mount(ResourceCatalogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const text = w.text()
    // 3 deployable + 2 config only.
    const deployable = (text.match(/可部署/g) || []).length
    const configOnly = (text.match(/仅配置/g) || []).length
    expect(deployable).toBe(3)
    expect(configOnly).toBe(2)
  })

  it('RC.3 typing into the search box filters visible items; no matches shows el-empty', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: ITEMS } as any)

    const router = makeRouter()
    await router.push('/resources/new')
    await router.isReady()
    const w = mount(ResourceCatalogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const search = w.find('input[placeholder="搜索资源或模板"]')
    await search.setValue('postgresql')
    await flushPromises()

    // PostgreSQL still visible; the others hidden by filter.
    expect(w.text()).toContain('PostgreSQL')
    expect(w.text()).not.toContain('Redis')

    // No match at all.
    await search.setValue('xyzzy')
    await flushPromises()
    expect(w.text()).toContain('没有匹配的资源')
  })

  it('RC.4 clicking a card calls router.push("/projects/create?resource=...")', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: ITEMS } as any)

    const router = makeRouter()
    await router.push('/resources/new')
    await router.isReady()
    const pushSpy = vi.spyOn(router, 'push')
    const w = mount(ResourceCatalogPage, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()

    const card = w.findAll('button.resource-card').find(c => c.text().includes('Public Git'))!
    expect(card, 'card for Public Git must be present').toBeDefined()
    await card.trigger('click')
    await flushPromises()

    expect(pushSpy).toHaveBeenCalledWith({ path: '/projects/create', query: { resource: 'app-public' } })
  })
})
