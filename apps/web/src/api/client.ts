import axios from 'axios'

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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      window.location.hash = '#/login'
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

// Audit Log API
export function fetchAuditLogs(workspaceId?: string) {
  return api.get('/audit-logs', { params: { workspaceId } })
}
