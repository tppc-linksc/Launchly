import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let jwtService: JwtService;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    jwtService = { verify: jest.fn() } as any;
    guard = new JwtAuthGuard(jwtService, reflector);
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

  it('should return true immediately if route is @Public()', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const { ctx } = mockContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException if no Authorization header', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const { ctx } = mockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if Authorization header is not Bearer', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const { ctx } = mockContext({ authorization: 'Basic abc123' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if token is invalid or expired', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('expired'); });
    const { ctx } = mockContext({ authorization: 'Bearer bad-token' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should set request.user and return true for a valid token', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (jwtService.verify as jest.Mock).mockReturnValue({ uid: 'u1', wid: 'w1', role: 'ADMIN' });
    const { ctx, request } = mockContext({ authorization: 'Bearer good-token' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.user).toEqual({ userId: 'u1', workspaceId: 'w1', role: 'ADMIN' });
  });
});
