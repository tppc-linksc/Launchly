import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'

// Mock localStorage for jsdom
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k in store) delete store[k] }),
  get length() { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

vi.mock('../api/client', () => ({
  fetchSetupStatus: vi.fn(),
}))

import { fetchSetupStatus } from '../api/client'
const mockFetchSetupStatus = vi.mocked(fetchSetupStatus)

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('has correct initial state', () => {
    const auth = useAuthStore()
    expect(auth.initialized).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.workspace).toBeNull()
  })

  it('setAuth stores tokens in localStorage and sets user/workspace', () => {
    const auth = useAuthStore()
    auth.setAuth({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
      user: { id: 'u1', account: 'admin', role: 'OWNER' },
      workspace: { id: 'w1', name: 'Test' },
    })

    expect(localStorage.getItem('accessToken')).toBe('at-123')
    expect(localStorage.getItem('refreshToken')).toBe('rt-456')
    expect(auth.user).toEqual({ id: 'u1', account: 'admin', role: 'OWNER' })
    expect(auth.workspace).toEqual({ id: 'w1', name: 'Test' })
  })

  it('logout clears tokens and user state', () => {
    const auth = useAuthStore()
    auth.setAuth({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
      user: { id: 'u1' },
      workspace: { id: 'w1' },
    })

    auth.logout()

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken')
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken')
    expect(auth.user).toBeNull()
    expect(auth.workspace).toBeNull()
  })

  it('checkSetupStatus sets initialized to true when API returns true', async () => {
    mockFetchSetupStatus.mockResolvedValue({ data: { initialized: true } } as any)
    const auth = useAuthStore()
    await auth.checkSetupStatus()
    expect(auth.initialized).toBe(true)
  })

  it('checkSetupStatus sets initialized to false on error', async () => {
    mockFetchSetupStatus.mockRejectedValue(new Error('network'))
    const auth = useAuthStore()
    await auth.checkSetupStatus()
    expect(auth.initialized).toBe(false)
  })
})
