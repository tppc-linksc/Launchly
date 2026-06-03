import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePermission } from './usePermission'
import { useAuthStore } from '../stores/auth'

function setRole(role: string | null) {
  const auth = useAuthStore()
  auth.user = role ? { role } : null
}

describe('usePermission', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults to VIEWER when no user', () => {
    const { role, isViewer } = usePermission()
    expect(role.value).toBe('VIEWER')
    expect(isViewer.value).toBe(true)
  })

  it('OWNER: all permissions except isViewer', () => {
    setRole('OWNER')
    const { isOwner, isAdmin, canWrite, canDeploy, isViewer } = usePermission()
    expect(isOwner.value).toBe(true)
    expect(isAdmin.value).toBe(true)
    expect(canWrite.value).toBe(true)
    expect(canDeploy.value).toBe(true)
    expect(isViewer.value).toBe(false)
  })

  it('ADMIN: not owner, but admin/write/deploy', () => {
    setRole('ADMIN')
    const { isOwner, isAdmin, canWrite, canDeploy } = usePermission()
    expect(isOwner.value).toBe(false)
    expect(isAdmin.value).toBe(true)
    expect(canWrite.value).toBe(true)
    expect(canDeploy.value).toBe(true)
  })

  it('DEVELOPER: can write and deploy, not admin', () => {
    setRole('DEVELOPER')
    const { isAdmin, canWrite, canDeploy } = usePermission()
    expect(isAdmin.value).toBe(false)
    expect(canWrite.value).toBe(true)
    expect(canDeploy.value).toBe(true)
  })

  it('TESTER: can write but not deploy', () => {
    setRole('TESTER')
    const { canWrite, canDeploy } = usePermission()
    expect(canWrite.value).toBe(true)
    expect(canDeploy.value).toBe(false)
  })

  it('VIEWER: no write, no deploy', () => {
    setRole('VIEWER')
    const { canWrite, canDeploy, isViewer } = usePermission()
    expect(canWrite.value).toBe(false)
    expect(canDeploy.value).toBe(false)
    expect(isViewer.value).toBe(true)
  })
})
