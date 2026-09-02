import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

// Routes that do not require an authenticated session.
const PUBLIC_PATHS = new Set<string>(['/login', '/init', '/invite']);

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
        {
          path: 'resources/new',
          name: 'resource-catalog',
          component: () => import('../pages/ResourceCatalogPage.vue'),
        },
        { path: 'projects/create', name: 'project-create', component: () => import('../pages/ProjectCreatePage.vue') },
        { path: 'projects/:id', name: 'project-detail', component: () => import('../pages/ProjectDetailPage.vue') },
        {
          path: 'projects/:id/deploy-targets',
          name: 'deploy-targets',
          component: () => import('../pages/DeployTargetListPage.vue'),
        },
        {
          path: 'deploy-targets',
          name: 'deploy-targets-all',
          component: () => import('../pages/DeployTargetsPage.vue'),
        },
        { path: 'deployments', name: 'deployments', component: () => import('../pages/DeploymentListPage.vue') },
        {
          path: 'deployments/:id',
          name: 'deployment-detail',
          component: () => import('../pages/DeploymentDetailPage.vue'),
        },
        { path: 'environments', name: 'environments', component: () => import('../pages/EnvironmentListPage.vue') },
        { path: 'tests', name: 'tests', component: () => import('../pages/TestCaseListPage.vue') },
        { path: 'tests/runs', name: 'test-runs', component: () => import('../pages/TestRunListPage.vue') },
        { path: 'tests/runs/:id', name: 'test-run-detail', component: () => import('../pages/TestRunDetailPage.vue') },
        { path: 'issues', name: 'issues', component: () => import('../pages/IssueListPage.vue') },
        {
          path: 'issues/:projectId/:id',
          name: 'issue-detail',
          component: () => import('../pages/IssueDetailPage.vue'),
        },
        { path: 'releases', name: 'releases', component: () => import('../pages/ReleaseListPage.vue') },
        {
          path: 'releases/:projectId/:id',
          name: 'release-detail',
          component: () => import('../pages/ReleaseDetailPage.vue'),
        },
        { path: 'audit-logs', name: 'audit-logs', component: () => import('../pages/AuditLogPage.vue') },
        {
          path: 'notifications',
          name: 'notifications',
          component: () => import('../pages/NotificationCenterPage.vue'),
        },
        { path: 'members', name: 'members', component: () => import('../pages/MemberListPage.vue') },
        { path: 'settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },
      ],
    },
    {
      path: '/init',
      name: 'init',
      component: () => import('../pages/InitPage.vue'),
    },
    {
      path: '/invite/:token',
      name: 'invite',
      component: () => import('../pages/AcceptInvitationPage.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/LoginPage.vue'),
    },
  ],
});

/**
 * KI-009: global route guard. Without this, an unauthenticated user could
 * land on any protected route and only see the auth failure once an API
 * call fired. The guard:
 *   1. Rehydrates the in-memory auth state from localStorage on every
 *      navigation, so a hard refresh mid-session does not flash to a
 *      logged-out state.
 *   2. Redirects to /login when the resolved state still has no user and
 *      the target route is not in the public allowlist.
 *   3. Lets public routes (/login, /init) through unconditionally so the
 *      bootstrap and sign-in flows remain reachable.
 */
export function runAuthGuard(to: { path: string }): true | { path: string } {
  const auth = useAuthStore();
  auth.restoreSession();

  if (PUBLIC_PATHS.has(to.path) || to.path.startsWith('/invite/')) return true;
  if (auth.user?.id) return true;
  return { path: '/login' };
}

router.beforeEach((to) => runAuthGuard(to));

export default router;
