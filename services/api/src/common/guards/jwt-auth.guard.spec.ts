import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let jwtService: JwtService;
  let prisma: any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    jwtService = { verify: jest.fn() } as any;
    prisma = { workspaceMember: { findFirst: jest.fn() } };
    guard = new JwtAuthGuard(jwtService, reflector, prisma);
  });

  function mockContext(headers: Record<string, string> = {}): { ctx: ExecutionContext; request: any } {
    const request = { headers, user: undefined };
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
    return { ctx, request };
  }

  it('should return true immediately if route is @Public()', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const { ctx } = mockContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should throw UnauthorizedException if no Authorization header', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const { ctx } = mockContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should throw UnauthorizedException if Authorization header is not Bearer', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const { ctx } = mockContext({ authorization: 'Basic abc123' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should throw UnauthorizedException if token is invalid or expired', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('expired'); });
    const { ctx } = mockContext({ authorization: 'Bearer bad-token' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should set request.user after confirming the workspace membership still exists', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockReturnValue({ uid: 'u1', wid: 'w1', role: 'ADMIN', typ: 'access', aud: 'launchly:api' });
    prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'VIEWER' });
    const { ctx, request } = mockContext({ authorization: 'Bearer good-token' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('good-token', { audience: 'launchly:api' });
    expect(request.user).toEqual({ userId: 'u1', workspaceId: 'w1', role: 'VIEWER' });
  });

  it('rejects a validly signed refresh-token payload on protected routes', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockReturnValue({ uid: 'u1', jti: 'refresh-1', typ: 'refresh', aud: 'launchly:refresh' });
    const { ctx } = mockContext({ authorization: 'Bearer refresh-token' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an access-token payload without a user id', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockReturnValue({ typ: 'access', aud: 'launchly:api' });
    const { ctx } = mockContext({ authorization: 'Bearer incomplete-token' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid token after its workspace membership is removed', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockReturnValue({ uid: 'u1', wid: 'w1', role: 'OWNER', typ: 'access' });
    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    const { ctx } = mockContext({ authorization: 'Bearer stale-token' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
