import axios from 'axios'
import { ElMessage } from 'element-plus'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Token refresh state
let isRefreshing = false
let refreshPromise: Promise<any> | null = null
let failedQueue: Array<{
  resolve: (value?: unknown) => void
  reject: (reason?: any) => void
}> = []

function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) {
    throw new Error('No refresh token available')
  }

  const response = await axios.post('/api/auth/refresh', { refreshToken })
  const newAccessToken = response.data.accessToken
  const newRefreshToken = response.data.refreshToken

  localStorage.setItem('accessToken', newAccessToken)
  localStorage.setItem('refreshToken', newRefreshToken)

  return newAccessToken
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't try to refresh if we're already refreshing or this is the refresh endpoint itself
      if (originalRequest.url === '/auth/refresh') {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        window.location.hash = '#/login'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        // Queue requests while token is being refreshed
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api(originalRequest)
          })
          .catch((err) => {
            return Promise.reject(err)
          })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const newToken = await refreshAccessToken()
        processQueue(null, newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        window.location.hash = '#/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // Global error toasts for common HTTP errors
    const status = error.response?.status
    const serverMsg = error.response?.data?.message
    if (status === 403) {
      ElMessage.error(serverMsg || '无权限执行此操作')
    } else if (status === 404) {
      ElMessage.error(serverMsg || '请求的资源不存在')
    } else if (status === 409) {
      ElMessage.error(serverMsg || '操作冲突，请刷新后重试')
    } else if (status === 500) {
      ElMessage.error(serverMsg || '服务器内部错误，请稍后重试')
    }

    return Promise.reject(error)
  }
)

export default api

// Setup API
export function fetchSetupStatus() {
  return api.get('/setup/status')
}

export function createOwner(data: {
  account: string
  password: string
  displayName?: string
  workspaceName: string
}) {
  return api.post('/setup/owner', data)
}

// Auth API
export function login(data: { account: string; password: string }) {
  return api.post('/auth/login', data)
}

// Project API
export function fetchProjects() {
  return api.get('/projects')
}

export function fetchProject(id: string) {
  return api.get(`/projects/${id}`)
}

export function createProject(data: any) {
  return api.post('/projects', data)
}

export function updateProject(id: string, data: any) {
  return api.put(`/projects/${id}`, data)
}

// Environment API
export function fetchEnvironments(projectId: string) {
  return api.get('/environments', { params: { projectId } })
}

// Environment API
export function updateEnvironment(id: string, data: any) {
  return api.put(`/environments/${id}`, data)
}

// Environment Variable API
export function fetchEnvVariables(environmentId: string) {
  return api.get(`/environments/${environmentId}/variables`)
}

export function createEnvVariable(environmentId: string, data: any) {
  return api.post(`/environments/${environmentId}/variables`, data)
}

export function deleteEnvVariable(environmentId: string, variableId: string) {
  return api.delete(`/environments/${environmentId}/variables/${variableId}`)
}

// Deployment API
export function fetchDeployments(params?: { projectId?: string; environmentId?: string }) {
  return api.get('/deployments', { params })
}

export function fetchDeployment(id: string) {
  return api.get(`/deployments/${id}`)
}

export function fetchDeploymentLogs(id: string) {
  return api.get(`/deployments/${id}/logs`)
}

export function createDeployment(data: any) {
  return api.post('/deployments', data)
}

// TestCase API
export function fetchTestCases(projectId: string) {
  return api.get(`/projects/${projectId}/test-cases`)
}

export function createTestCase(projectId: string, data: any) {
  return api.post(`/projects/${projectId}/test-cases`, data)
}

export function updateTestCase(projectId: string, id: string, data: any) {
  return api.put(`/projects/${projectId}/test-cases/${id}`, data)
}

export function deleteTestCase(projectId: string, id: string) {
  return api.delete(`/projects/${projectId}/test-cases/${id}`)
}

// TestRun API
export function fetchTestRuns(projectId: string) {
  return api.get('/test-runs', { params: { projectId } })
}

export function fetchTestRun(id: string) {
  return api.get(`/test-runs/${id}`)
}

export function createTestRun(deploymentId: string, projectId: string, environmentId?: string) {
  return api.post(`/deployments/${deploymentId}/test-runs`, null, { params: { projectId, environmentId } })
}

export function fetchTestRunCases(testRunId: string) {
  return api.get(`/test-runs/${testRunId}/cases`)
}

export function updateTestRunCase(testRunId: string, caseId: string, data: any) {
  return api.put(`/test-runs/${testRunId}/cases/${caseId}`, data)
}

// Issue API
export function fetchIssues(projectId: string, params?: { status?: string; priority?: string; assigneeId?: string }) {
  return api.get(`/projects/${projectId}/issues`, { params })
}

export function fetchIssue(projectId: string, id: string) {
  return api.get(`/projects/${projectId}/issues/${id}`)
}

export function createIssue(projectId: string, data: any) {
  return api.post(`/projects/${projectId}/issues`, data)
}

export function updateIssue(projectId: string, id: string, data: any) {
  return api.put(`/projects/${projectId}/issues/${id}`, data)
}

export function transitionIssue(projectId: string, id: string, data: { targetStatus: string; fixedCommitSha?: string }) {
  return api.put(`/projects/${projectId}/issues/${id}/status`, data)
}

export function createIssueFromFailedTest(projectId: string, testRunCaseId: string, deploymentId: string, testCaseTitle?: string) {
  return api.post(`/projects/${projectId}/issues/from-failed-test`, null, { params: { testRunCaseId, deploymentId, testCaseTitle } })
}

// Notification API
export function fetchNotifications() {
  return api.get('/notifications')
}

export function fetchUnreadCount() {
  return api.get('/notifications/unread-count')
}

export function markNotificationRead(id: string) {
  return api.put(`/notifications/${id}/read`)
}

export function markAllNotificationsRead() {
  return api.put('/notifications/read-all')
}

// Release API
export function fetchReleases(projectId: string) {
  return api.get(`/projects/${projectId}/releases`)
}

export function fetchRelease(projectId: string, id: string) {
  return api.get(`/projects/${projectId}/releases/${id}`)
}

export function createRelease(projectId: string, data: any) {
  return api.post(`/projects/${projectId}/releases`, data)
}

export function publishRelease(projectId: string, id: string) {
  return api.put(`/projects/${projectId}/releases/${id}/publish`)
}

export function fetchReleaseGates(projectId: string, id: string) {
  return api.get(`/projects/${projectId}/releases/${id}/gates`)
}

export function exemptGate(projectId: string, releaseId: string, gateName: string, data: { reason: string }) {
  return api.post(`/projects/${projectId}/releases/${releaseId}/gates/${gateName}/exempt`, data)
}

// Rollback API
export function rollbackDeployment(deploymentId: string, data: { reason: string }) {
  return api.post(`/deployments/${deploymentId}/rollback`, data)
}

// Deploy Target API
export function fetchAllDeployTargets() {
  return api.get('/deploy-targets')
}

export function fetchDeployTargets(projectId: string) {
  return api.get(`/projects/${projectId}/deploy-targets`)
}

export function fetchDeployTarget(id: string) {
  return api.get(`/deploy-targets/${id}`)
}

export function createDeployTarget(projectId: string, data: any) {
  return api.post(`/projects/${projectId}/deploy-targets`, data)
}

export function updateDeployTarget(id: string, data: any) {
  return api.patch(`/deploy-targets/${id}`, data)
}

export function deleteDeployTarget(id: string) {
  return api.delete(`/deploy-targets/${id}`)
}

export function verifyDeployTarget(id: string) {
  return api.post(`/deploy-targets/${id}/verify`)
}

// Audit Log API
export function fetchAuditLogs(workspaceId?: string) {
  return api.get('/audit-logs', { params: { workspaceId } })
}

// Member API
export function fetchMembers() {
  return api.get('/members')
}

export function updateMemberRole(id: string, role: string) {
  return api.put(`/members/${id}/role`, { role })
}

export function removeMember(id: string) {
  return api.delete(`/members/${id}`)
}
