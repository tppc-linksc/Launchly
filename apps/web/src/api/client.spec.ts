import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted to the top of the file. They cannot close
// over outer variables — the factory must be self-contained.
vi.mock('axios', () => {
  const instance = {
    interceptors: { request: { use: () => {} }, response: { use: () => {} } },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }
  const callable: any = {
    create: vi.fn(() => instance),
    get: instance.get,
    post: instance.post,
    put: instance.put,
    patch: instance.patch,
    delete: instance.delete,
  }
  callable.interceptors = instance.interceptors
  return { default: callable, create: callable.create }
})

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), warning: vi.fn() } }))

// Import after the mocks are registered so the module under test sees them.
import axios from 'axios'
import {
  transitionIssue,
  createIssue,
  createTestRun,
  createRelease,
  fetchReleaseGates,
  fetchUnreadCount,
  markNotificationRead,
} from './client'

// axios.create() is invoked during client.ts module initialization and
// returns the same shared instance we stubbed into the mock factory.
const instance = (axios as any).create()
const mockGet = instance.get
const mockPost = instance.post
const mockPut = instance.put
const mockPatch = instance.patch
const mockDelete = instance.delete

beforeEach(() => {
  vi.clearAllMocks()
  mockPut.mockResolvedValue({ data: { ok: true } })
  mockPost.mockResolvedValue({ data: { ok: true } })
  mockGet.mockResolvedValue({ data: { ok: true } })
  mockPatch.mockResolvedValue({ data: { ok: true } })
  mockDelete.mockResolvedValue({ data: { ok: true } })
})

describe('API client — control plane contract', () => {
  describe('transitionIssue (KI-008 — body key must be `toStatus`)', () => {
    it('PUTs to the project-scoped issues status endpoint', () => {
      transitionIssue('proj-1', 'iss-1', { toStatus: 'ASSIGNED' })
      expect(mockPut).toHaveBeenCalledTimes(1)
      const [url] = mockPut.mock.calls[0]
      expect(url).toBe('/projects/proj-1/issues/iss-1/status')
    })

    it('serializes the body with `toStatus` (not `targetStatus`)', () => {
      transitionIssue('proj-1', 'iss-1', { toStatus: 'FIXED', fixedCommitSha: 'sha-abc' })
      const [, body] = mockPut.mock.calls[0]
      expect(body).toEqual({ toStatus: 'FIXED', fixedCommitSha: 'sha-abc' })
      // Hard guarantee: the old `targetStatus` key must not leak.
      expect(body).not.toHaveProperty('targetStatus')
    })
  })

  describe('createIssue (sanity)', () => {
    it('POSTs to the project-scoped issues endpoint with the caller body', () => {
      createIssue('proj-1', { title: 't', description: 'd' })
      const [url, body] = mockPost.mock.calls[0]
      expect(url).toBe('/projects/proj-1/issues')
      expect(body).toEqual({ title: 't', description: 'd' })
    })
  })

  describe('createTestRun (query body is null)', () => {
    it('POSTs deploymentId-scoped test-runs with projectId/environmentId as query params', () => {
      createTestRun('dep-1', 'proj-1', 'env-1')
      const [url, body, config] = mockPost.mock.calls[0]
      expect(url).toBe('/deployments/dep-1/test-runs')
      expect(body).toBeNull()
      expect(config).toEqual({ params: { projectId: 'proj-1', environmentId: 'env-1' } })
    })
  })

  describe('createRelease (POSTs body, not query)', () => {
    it('POSTs to the project-scoped releases endpoint with the body', () => {
      createRelease('proj-1', { environmentId: 'env-1', version: 'v1' })
      const [url, body] = mockPost.mock.calls[0]
      expect(url).toBe('/projects/proj-1/releases')
      expect(body).toEqual({ environmentId: 'env-1', version: 'v1' })
    })
  })

  describe('fetchReleaseGates (GET path, not POST/PATCH)', () => {
    it('GETs the project-scoped release gates endpoint', () => {
      fetchReleaseGates('proj-1', 'rel-1')
      const [url] = mockGet.mock.calls[0]
      expect(url).toBe('/projects/proj-1/releases/rel-1/gates')
    })
  })

  describe('fetchUnreadCount + markNotificationRead (KI-008 — API contract fixed)', () => {
    // Web contracts now align with the NotificationController routes.
    it('fetchUnreadCount targets /notifications/unread-count', () => {
      fetchUnreadCount()
      expect(mockGet).toHaveBeenCalledWith('/notifications/unread-count')
    })

    it('markNotificationRead targets /notifications/:id/read', () => {
      markNotificationRead('notif-1')
      expect(mockPut).toHaveBeenCalledWith('/notifications/notif-1/read')
    })
  })
})
