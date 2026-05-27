import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'

export function usePermission() {
  const auth = useAuthStore()

  const role = computed(() => auth.user?.role || 'VIEWER')

  const isOwner = computed(() => role.value === 'OWNER')
  const isAdmin = computed(() => role.value === 'OWNER' || role.value === 'ADMIN')
  const canWrite = computed(() => ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER'].includes(role.value))
  const canDeploy = computed(() => ['OWNER', 'ADMIN', 'DEVELOPER'].includes(role.value))
  const isViewer = computed(() => role.value === 'VIEWER')

  return { role, isOwner, isAdmin, canWrite, canDeploy, isViewer }
}
