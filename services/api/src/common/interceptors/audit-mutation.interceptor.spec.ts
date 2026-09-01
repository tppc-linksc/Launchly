import { lastValueFrom, of } from 'rxjs';
import { AuditMutationInterceptor } from './audit-mutation.interceptor';

describe('AuditMutationInterceptor', () => {
  it('records the route template without leaking secret path parameters or bodies', async () => {
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
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
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ success: true }) } as any));
    await Promise.resolve();

    const data = auditLog.create.mock.calls[0][0].data;
    expect(data.detail).toBe(JSON.stringify({ path: '/api/invitations/:token/accept' }));
    expect(JSON.stringify(data)).not.toContain('super-secret-token');
    expect(JSON.stringify(data)).not.toContain('super-secret-password');
  });
});
