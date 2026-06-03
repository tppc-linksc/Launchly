import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  function mockContext(user?: { role: string }): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
  }

  it('should return true when no roles are required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should return true when required roles array is empty', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should throw ForbiddenException when no user on request', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user has no role', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(mockContext({ role: '' }))).toThrow(ForbiddenException);
  });

  it('should return true when user role level meets the required level', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['DEVELOPER']);
    // OWNER (5) >= DEVELOPER (3)
    expect(guard.canActivate(mockContext({ role: 'OWNER' }))).toBe(true);
  });

  it('should throw ForbiddenException when user role level is below required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['ADMIN']);
    // TESTER (2) < ADMIN (4)
    expect(() => guard.canActivate(mockContext({ role: 'TESTER' }))).toThrow(ForbiddenException);
  });
});
