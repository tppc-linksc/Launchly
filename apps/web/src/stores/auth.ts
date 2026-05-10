import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchSetupStatus } from '../api/client'

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref<boolean | null>(null)
  const user = ref<any>(null)
  const workspace = ref<any>(null)

  async function checkSetupStatus() {
    try {
      const res = await fetchSetupStatus()
      initialized.value = res.data.initialized
    } catch {
      initialized.value = false
    }
  }

  function setAuth(data: { accessToken: string; refreshToken: string; user: any; workspace: any }) {
    localStorage.setItem('accessToken', data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
    user.value = data.user
    workspace.value = data.workspace
  }

  function logout() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    user.value = null
    workspace.value = null
    window.location.hash = '#/login'
  }

  return { initialized, user, workspace, checkSetupStatus, setAuth, logout }
})
