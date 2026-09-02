import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditMutationInterceptor, classifyAuditMutation } from './audit-mutation.interceptor';

function httpContext(request: any) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('AuditMutationInterceptor', () => {
  it('records the route template without leaking secret path parameters or bodies', async () => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'POST',
      baseUrl: '/api/invitations',
      route: { path: '/:token/accept' },
      originalUrl: '/api/invitations/super-secret-token/accept',
      params: { token: 'super-secret-token' },
      body: { password: 'super-secret-password' },
      headers: {},
      socket: {},
    };
    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({ success: true }) } as any));
    await Promise.resolve();

    const data = auditLog.create.mock.calls[0][0].data;
    expect(data.detail).toBe(JSON.stringify({ path: '/api/invitations/:token/accept' }));
    expect(JSON.stringify(data)).not.toContain('super-secret-token');
    expect(JSON.stringify(data)).not.toContain('super-secret-password');
  });

  it.each([
    ['POST', '/api/workspace/rotate-secrets', 'WORKSPACE_SECRET_ROTATE', 'WORKSPACE'],
    ['POST', '/api/environments/:environmentId/variables', 'ENVIRONMENT_VARIABLE_CREATE', 'ENVIRONMENT_VARIABLE'],
    [
      'PUT',
      '/api/environments/:environmentId/variables/:variableId',
      'ENVIRONMENT_VARIABLE_UPDATE',
      'ENVIRONMENT_VARIABLE',
    ],
    [
      'DELETE',
      '/api/environments/:environmentId/variables/:variableId',
      'ENVIRONMENT_VARIABLE_DELETE',
      'ENVIRONMENT_VARIABLE',
    ],
    ['POST', '/api/invitations', 'INVITATION_CREATE', 'MEMBER'],
    ['POST', '/api/invitations/:token/accept', 'INVITATION_ACCEPT', 'MEMBER'],
    ['PUT', '/api/members/:id/role', 'MEMBER_ROLE_UPDATE', 'MEMBER'],
    ['DELETE', '/api/members/:id', 'MEMBER_REMOVE', 'MEMBER'],
    ['POST', '/api/projects/:projectId/deploy-targets', 'DEPLOY_TARGET_CREATE', 'DEPLOY_TARGET'],
    ['PATCH', '/api/deploy-targets/:id', 'DEPLOY_TARGET_UPDATE', 'DEPLOY_TARGET'],
    ['DELETE', '/api/deploy-targets/:id', 'DEPLOY_TARGET_DELETE', 'DEPLOY_TARGET'],
    ['POST', '/api/deploy-targets/:id/verify', 'DEPLOY_TARGET_VERIFY', 'DEPLOY_TARGET'],
    ['POST', '/api/projects/:projectId/releases', 'RELEASE_CREATE', 'RELEASE'],
    ['PUT', '/api/projects/:projectId/releases/:id/publish', 'RELEASE_PUBLISH', 'RELEASE'],
    ['POST', '/api/projects/:projectId/releases/:id/gates/:gateName/exempt', 'RELEASE_GATE_EXEMPT', 'RELEASE'],
  ])('classifies %s %s as the %s domain event', (method, path, action, targetType) => {
    expect(classifyAuditMutation(method, path)).toEqual({ action, targetType });
  });

  it('falls back to a stable HTTP event for an unmapped mutation route', () => {
    expect(classifyAuditMutation('PATCH', '/api/projects/:id/?ignored=true')).toEqual({
      action: 'HTTP_PATCH',
      targetType: 'PROJECTS',
    });
    expect(classifyAuditMutation('POST', '/api')).toEqual({ action: 'HTTP_POST', targetType: 'HTTP' });
  });

  it('does not audit non-HTTP contexts or read requests', async () => {
    const auditLog = { create: vi.fn() };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const next = { handle: () => of('ok') } as any;
    const rpc = { getType: () => 'rpc' } as any;

    await expect(lastValueFrom(interceptor.intercept(rpc, next))).resolves.toBe('ok');
    await expect(lastValueFrom(interceptor.intercept(httpContext({ method: 'GET', headers: {} }), next))).resolves.toBe(
      'ok',
    );
    await expect(lastValueFrom(interceptor.intercept(httpContext({ headers: {} }), next))).resolves.toBe('ok');
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ method: 'POST', route: { path: '/jobs' }, params: {}, headers: {}, socket: {} }, '/jobs'],
    [{ method: 'POST', params: {}, headers: {}, socket: {} }, ''],
  ])('records the bounded path fallback without requiring Express URL fields', async (request, expectedPath) => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);

    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({}) } as any));
    await Promise.resolve();

    expect(JSON.parse(auditLog.create.mock.calls[0][0].data.detail)).toEqual({ path: expectedPath });
  });

  it('records a successful mutation with semantic identity and bounded transport metadata', async () => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'PUT',
      baseUrl: '/api/members',
      route: { path: '/:id/role' },
      params: { id: 'member-1' },
      user: { userId: 'user-1', workspaceId: 'workspace-1' },
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1', 'user-agent': 'test-agent' },
      socket: {},
    };

    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({ success: true }) } as any));
    await Promise.resolve();

    expect(auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        action: 'MEMBER_ROLE_UPDATE',
        targetType: 'MEMBER',
        targetId: 'member-1',
        detail: JSON.stringify({ path: '/api/members/:id/role' }),
        ipAddress: '203.0.113.10',
        userAgent: 'test-agent',
      },
    });
  });

  it('uses response identity for creates and does not fail the request when audit persistence fails', async () => {
    const auditLog = { create: vi.fn().mockRejectedValue(new Error('audit unavailable')) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'POST',
      originalUrl: '/api/projects/project-1/deploy-targets?source=ui',
      route: { path: '/projects/:projectId/deploy-targets' },
      baseUrl: '/api',
      params: {},
      headers: {},
      ip: '127.0.0.1',
      socket: {},
    };

    await expect(
      lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({ id: 'target-1' }) } as any)),
    ).resolves.toEqual({ id: 'target-1' });
    await Promise.resolve();
    await Promise.resolve();

    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'DEPLOY_TARGET_CREATE',
      targetType: 'DEPLOY_TARGET',
      targetId: 'target-1',
      ipAddress: '127.0.0.1',
    });
  });

  it('prefers the created resource identity over its parent route parameter', async () => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'POST',
      baseUrl: '/api',
      route: { path: '/projects/:projectId/releases' },
      params: { projectId: 'project-1' },
      headers: {},
      socket: {},
    };

    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({ id: 'release-1' }) } as any));
    await Promise.resolve();

    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'RELEASE_CREATE',
      targetType: 'RELEASE',
      targetId: 'release-1',
    });
  });

  it('falls back to response user and workspace identity when authentication populated the response', async () => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'POST',
      route: { path: '/auth/login' },
      baseUrl: '/api',
      params: {},
      headers: {},
      socket: {},
    };

    await lastValueFrom(
      interceptor.intercept(httpContext(request), {
        handle: () => of({ user: { id: 'user-from-response' }, workspace: { id: 'workspace-from-response' } }),
      } as any),
    );
    await Promise.resolve();

    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      userId: 'user-from-response',
      workspaceId: 'workspace-from-response',
      action: 'HTTP_POST',
      targetType: 'AUTH',
    });
  });

  it('does not record a mutation whose handler fails', async () => {
    const auditLog = { create: vi.fn() };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = { method: 'DELETE', originalUrl: '/api/deploy-targets/target-1', headers: {}, socket: {} };

    await expect(
      lastValueFrom(
        interceptor.intercept(httpContext(request), {
          handle: () => throwError(() => new Error('delete failed')),
        } as any),
      ),
    ).rejects.toThrow('delete failed');
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['variableId', 'variable-1'],
    ['caseId', 'case-1'],
    ['testRunId', 'run-1'],
    ['deploymentId', 'deployment-1'],
    ['projectId', 'project-1'],
    ['environmentId', 'environment-1'],
  ])('uses the %s route parameter as the audit target identity', async (parameter, value) => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'PATCH',
      url: '/api/resources/value',
      params: { [parameter]: value },
      headers: {},
      socket: { remoteAddress: '::1' },
    };

    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({}) } as any));
    await Promise.resolve();

    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      targetId: value,
      ipAddress: '::1',
    });
  });

  it('drops an oversized route identity instead of writing unbounded audit metadata', async () => {
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const interceptor = new AuditMutationInterceptor({ auditLog } as any);
    const request = {
      method: 'DELETE',
      url: '/api/resources/oversized',
      params: { id: 'x'.repeat(37) },
      headers: {},
      socket: {},
    };

    await lastValueFrom(interceptor.intercept(httpContext(request), { handle: () => of({}) } as any));
    await Promise.resolve();

    expect(auditLog.create.mock.calls[0][0].data.targetId).toBeNull();
  });
});
