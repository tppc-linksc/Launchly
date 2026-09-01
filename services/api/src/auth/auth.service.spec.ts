import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-token'),
      verify: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.resetAllMocks());

  describe('login', () => {
    it('should return tokens and user info on valid credentials', async () => {
      const user = { id: 'u1', account: 'admin', displayName: 'Admin', passwordHash: 'hashed' };
      const member = { workspaceId: 'w1', role: 'OWNER', workspace: { name: 'My Workspace' } };

      prisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.workspaceMember.findFirst.mockResolvedValue(member);
      jwtService.sign.mockReturnValue('mock-token');

      const result = await service.login('admin', 'password');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { account: 'admin' } });
      expect(bcrypt.compare).toHaveBeenCalledWith('password', 'hashed');
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(result.user).toEqual({ id: 'u1', account: 'admin', displayName: 'Admin', role: 'OWNER' });
      expect(result.workspace).toEqual({ id: 'w1', name: 'My Workspace' });
      expect(jwtService.sign).toHaveBeenNthCalledWith(1, expect.objectContaining({
        uid: 'u1', wid: 'w1', role: 'OWNER', typ: 'access',
      }), { audience: 'launchly:api' });
      expect(jwtService.sign).toHaveBeenNthCalledWith(2, expect.objectContaining({
        uid: 'u1', typ: 'refresh', jti: expect.any(String),
      }), { audience: 'launchly:refresh', expiresIn: '30d' });
      expect(jwtService.sign.mock.calls[0][0]).not.toHaveProperty('aud');
      expect(jwtService.sign.mock.calls[1][0]).not.toHaveProperty('aud');
    });

    it('should throw UnauthorizedException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('unknown', 'password')).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      const user = { id: 'u1', account: 'admin', passwordHash: 'hashed' };
      prisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('admin', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('should handle user with no workspace membership', async () => {
      const user = { id: 'u1', account: 'admin', displayName: 'Admin', passwordHash: 'hashed' };
      prisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.workspaceMember.findFirst.mockResolvedValue(null);

      const result = await service.login('admin', 'password');

      expect(result.workspace).toBeNull();
      expect(result.user.role).toBeUndefined();
    });

    it('rate-limits the sixth failed attempt for the same account and client address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.login('admin', 'wrong', '192.0.2.10')).rejects.toThrow(UnauthorizedException);
      }
      const blocked = service.login('admin', 'wrong', '192.0.2.10');
      await expect(blocked).rejects.toBeInstanceOf(HttpException);
      await expect(blocked).rejects.toMatchObject({ status: 429 });
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(5);
    });

    it('does not share login failure counters across client addresses', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.login('admin', 'wrong', '192.0.2.10')).rejects.toThrow(UnauthorizedException);
      }
      await expect(service.login('admin', 'wrong', '192.0.2.11')).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(6);
    });
  });

  it('signs a real access/refresh pair with distinct audiences and no duplicate aud option', async () => {
    const realJwt = new JwtService({ secret: 'real-jwt-test-secret', signOptions: { expiresIn: '1h' } });
    const realService = new AuthService(prisma as unknown as PrismaService, realJwt);

    const pair = await (realService as any).issueTokenPair('u-real', 'w-real', 'OWNER', 'Workspace', 'owner', 'Owner');
    const access = realJwt.verify(pair.accessToken, { audience: 'launchly:api' });
    const refresh = realJwt.verify(pair.refreshToken, { audience: 'launchly:refresh' });

    expect(access).toMatchObject({ uid: 'u-real', wid: 'w-real', role: 'OWNER', typ: 'access', aud: 'launchly:api' });
    expect(refresh).toMatchObject({ uid: 'u-real', typ: 'refresh', aud: 'launchly:refresh', jti: expect.any(String) });
  });

  describe('logout', () => {
    it('persists revocation for a valid refresh token', async () => {
      jwtService.verify.mockReturnValue({ uid: 'u1', typ: 'refresh', jti: 'jti-1', exp: 2_000_000_000 } as any);
      prisma.revokedRefreshToken.upsert.mockResolvedValue({});
      prisma.revokedRefreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('refresh-token')).resolves.toEqual({ success: true });
      expect(prisma.revokedRefreshToken.upsert).toHaveBeenCalledWith({
        where: { jti: 'jti-1' },
        create: { jti: 'jti-1', expiresAt: new Date(2_000_000_000_000) },
        update: {},
      });
    });

    it('is idempotent for an invalid or expired token', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('expired'); });
      await expect(service.logout('expired-token')).resolves.toEqual({ success: true });
      expect(prisma.revokedRefreshToken.upsert).not.toHaveBeenCalled();
    });

    it('does not report success when a valid token cannot be revoked', async () => {
      jwtService.verify.mockReturnValue({ uid: 'u1', typ: 'refresh', jti: 'jti-1' } as any);
      prisma.revokedRefreshToken.upsert.mockRejectedValue(new Error('database unavailable'));
      await expect(service.logout('refresh-token')).rejects.toThrow('database unavailable');
    });
  });

  describe('getStatus', () => {
    it('should return initialized true when users exist', async () => {
      prisma.user.count.mockResolvedValue(3);

      const result = await service.getStatus();

      expect(result).toEqual({ initialized: true });
    });

    it('should return initialized false when no users exist', async () => {
      prisma.user.count.mockResolvedValue(0);

      const result = await service.getStatus();

      expect(result).toEqual({ initialized: false });
    });
  });

  describe('createOwner', () => {
    it('should create user, workspace, and member in a transaction', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const txMock = {
        user: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'u1', account: 'admin', displayName: 'Admin' }) },
        workspace: { create: jest.fn().mockResolvedValue({ id: 'w1', name: 'Org' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));

      const result = await service.createOwner('admin', 'pass', 'Admin', 'Org');

      expect(txMock.user.count).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
      expect(bcrypt.hash).toHaveBeenCalledWith('pass', 10);
      expect(txMock.user.create).toHaveBeenCalled();
      expect(txMock.workspace.create).toHaveBeenCalledWith({ data: { name: 'Org' } });
      expect(txMock.workspaceMember.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-token');
      expect(result.user.role).toBe('OWNER');
    });

    it('should throw BadRequestException when users already exist', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => fn({ user: { count: jest.fn().mockResolvedValue(1) } }));

      await expect(service.createOwner('admin', 'pass', 'Admin', 'Org')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should use account as displayName when displayName is null', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const txMock = {
        user: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'u1', account: 'admin', displayName: 'admin' }) },
        workspace: { create: jest.fn().mockResolvedValue({ id: 'w1', name: 'Org' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));

      await service.createOwner('admin', 'pass', null, 'Org');

      expect(txMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ displayName: 'admin' }) }),
      );
    });

    it.each(['P2002', 'P2034'])('maps concurrent initialization error %s to BadRequest', async code => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.$transaction.mockRejectedValue(Object.assign(new Error('transaction conflict'), { code }));

      await expect(service.createOwner('admin', 'pass', 'Admin', 'Org')).rejects.toThrow(BadRequestException);
    });
  });
});
