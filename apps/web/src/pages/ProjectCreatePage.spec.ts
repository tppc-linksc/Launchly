/**
 * TEST-WEB-02 round 2 / ProjectCreatePage
 *
 * - Mount fetches the resource catalog and resolves the `?resource=`
 *   query into a single catalog item.
 * - An unknown resource id renders the "资源类型不存在或已下线" empty
 *   state.
 * - Form pre-fills via `applyItem` from the catalog item (projectType,
 *   resourceKind, sourceType, etc.).
 * - The form is hidden when the resource id is missing.
 * - Submitting an empty name surfaces the "请填写资源名称" error and
 *   does NOT call `createProject`.
 * - Submitting a valid form (PUBLIC_GIT resource) calls `createProject`
 *   with the right shape and pushes to /projects/:id.
 * - For an OCI_IMAGE resource, submitting without a `@sha256:` digest
 *   surfaces the "OCI 镜像必须使用 @sha256: digest" error.
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
  fetchResourceCatalog: vi.fn(),
  createProject: vi.fn(),
}))

import { fetchResourceCatalog, createProject } from '../api/client'
import ProjectCreatePage from './ProjectCreatePage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/projects/create', name: 'project-create', component: ProjectCreatePage },
      { path: '/projects/:id', name: 'project-detail', component: { template: '<div/>' } },
      { path: '/resources/new', name: 'resource-catalog', component: { template: '<div/>' } },
    ],
  })
}

const CATALOG = [
  {
    id: 'app-public', title: 'Public Git', description: 'Public GitHub',
    projectType: 'APP', resourceKind: 'APPLICATION',
    sourceType: 'GIT_PUBLIC', runtimeMode: 'BUILDKIT', availability: 'DEPLOYABLE',
  },
  {
    id: 'app-oci', title: 'OCI Image', description: 'Immutable OCI',
    projectType: 'APP', resourceKind: 'APPLICATION',
    sourceType: 'OCI_IMAGE', runtimeMode: 'BUILDKIT', availability: 'DEPLOYABLE',
  },
  {
    id: 'db-pg', title: 'PostgreSQL', description: 'Managed PG',
    projectType: 'STATEFUL', resourceKind: 'DATABASE',
    sourceType: 'DOCKER', runtimeMode: 'COMPOSE', availability: 'CONFIG_ONLY',
  },
]

async function gotoCreate(router: any, resourceId?: string) {
  if (resourceId) {
    await router.push({ name: 'project-create', query: { resource: resourceId } })
  } else {
    await router.push('/projects/create')
  }
  await router.isReady()
}

describe('ProjectCreatePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchResourceCatalog).mockReset()
    vi.mocked(createProject).mockReset()
    elMessageError.mockReset()
  })

  it('PC.1 mount fetches the catalog and renders the form for a known resource', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    const router = makeRouter()
    await gotoCreate(router, 'app-public')
    mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(fetchResourceCatalog).toHaveBeenCalledTimes(1)
    // The page renders the resource title + description in the head.
    expect(document.body.textContent).toContain('Public Git')
    // Availability badge "当前可部署" appears for DEPLOYABLE items.
    expect(document.body.textContent).toContain('当前可部署')
  })

  it('PC.2 an unknown resource id renders the "资源类型不存在或已下线" empty state', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    const router = makeRouter()
    await gotoCreate(router, 'nope')
    mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('资源类型不存在或已下线')
  })

  it('PC.3 a CONFIG_ONLY item (database) shows the "当前执行器尚未具备..." warning', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    const router = makeRouter()
    await gotoCreate(router, 'db-pg')
    mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('当前仅保存配置')
    expect(document.body.textContent).toContain('当前执行器尚未具备')
  })

  it('PC.4 an empty name submit shows "请填写资源名称" and does NOT call createProject', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    const router = makeRouter()
    await gotoCreate(router, 'app-public')
    const w = mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // Submit without filling the name.
    await w.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(createProject).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写资源名称')
  })

  it('PC.5 submitting a valid PUBLIC_GIT form calls createProject and pushes /projects/:id', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    vi.mocked(createProject).mockResolvedValue({ data: { id: 'p-new' } } as any)

    const router = makeRouter()
    await gotoCreate(router, 'app-public')
    const w = mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()
    const pushSpy = vi.spyOn(router, 'push')

    // Fill required fields.
    await w.find('input[placeholder^="例如：marketing-site"]').setValue('my-app')
    await w.find('input[placeholder^="https://github.com"]').setValue('https://github.com/org/repo.git')
    // registryRepository is required for DEPLOYABLE non-OCI.
    await w.find('input[placeholder^="ghcr.io/org"]').setValue('ghcr.io/org/my-app')
    await flushPromises()

    await w.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(createProject).toHaveBeenCalledTimes(1)
    const payload = (createProject as any).mock.calls[0][0]
    expect(payload.name).toBe('my-app')
    expect(payload.repositoryUrl).toBe('https://github.com/org/repo.git')
    expect(payload.registryRepository).toBe('ghcr.io/org/my-app')
    expect(payload.projectType).toBe('APP')
    expect(payload.sourceType).toBe('GIT_PUBLIC')
    expect(payload.resourceConfig).toEqual({ topology: 'SINGLE_SERVICE' })
    // The page must not accidentally leak the form's temporary
    // `topology`/`privateKey`/`hostKey` fields at the top level.
    expect(payload).not.toHaveProperty('topology')
    expect(payload).not.toHaveProperty('repositoryPrivateKey')
    expect(payload).not.toHaveProperty('repositoryHostKey')

    expect(pushSpy).toHaveBeenCalledWith('/projects/p-new')
  })

  it('PC.6 an OCI_IMAGE resource without @sha256: digest shows the dedicated error and does NOT call createProject', async () => {
    vi.mocked(fetchResourceCatalog).mockResolvedValue({ data: CATALOG } as any)
    const router = makeRouter()
    await gotoCreate(router, 'app-oci')
    const w = mount(ProjectCreatePage, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()

    // Fill name + bad image reference.
    await w.find('input[placeholder^="例如：marketing-site"]').setValue('my-oci-app')
    await w.find('input[placeholder^="ghcr.io/acme"]').setValue('ghcr.io/acme/app:latest')
    await flushPromises()

    await w.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(createProject).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('OCI 镜像必须使用 @sha256: digest')
  })
})
