import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'app',
      component: () => import('../pages/AppLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('../pages/DashboardPage.vue') },
        { path: 'projects', name: 'projects', component: () => import('../pages/ProjectListPage.vue') },
        { path: 'projects/create', name: 'project-create', component: () => import('../pages/ProjectCreatePage.vue') },
        { path: 'projects/:id', name: 'project-detail', component: () => import('../pages/ProjectDetailPage.vue') },
        { path: 'deployments', name: 'deployments', component: () => import('../pages/DeploymentListPage.vue') },
        { path: 'deployments/:id', name: 'deployment-detail', component: () => import('../pages/DeploymentDetailPage.vue') },
        { path: 'environments', name: 'environments', component: () => import('../pages/EnvironmentListPage.vue') },
        { path: 'tests', name: 'tests', component: () => import('../pages/TestCaseListPage.vue') },
        { path: 'tests/runs', name: 'test-runs', component: () => import('../pages/TestRunListPage.vue') },
        { path: 'tests/runs/:id', name: 'test-run-detail', component: () => import('../pages/TestRunDetailPage.vue') },
        { path: 'issues', name: 'issues', component: () => import('../pages/IssueListPage.vue') },
        { path: 'issues/:projectId/:id', name: 'issue-detail', component: () => import('../pages/IssueDetailPage.vue') },
        { path: 'releases', name: 'releases', component: () => import('../pages/ReleaseListPage.vue') },
        { path: 'releases/:projectId/:id', name: 'release-detail', component: () => import('../pages/ReleaseDetailPage.vue') },
        { path: 'audit-logs', name: 'audit-logs', component: () => import('../pages/AuditLogPage.vue') },
        { path: 'notifications', name: 'notifications', component: () => import('../pages/NotificationCenterPage.vue') },
        { path: 'members', name: 'members', component: () => import('../pages/PlaceholderPage.vue') },
        { path: 'settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },
      ],
    },
    {
      path: '/init',
      name: 'init',
      component: () => import('../pages/InitPage.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/LoginPage.vue'),
    },
  ],
})

export default router
