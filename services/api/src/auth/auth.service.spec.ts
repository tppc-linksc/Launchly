import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
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
      prisma.user.count.mockResolvedValue(0);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const txMock = {
        user: { create: jest.fn().mockResolvedValue({ id: 'u1', account: 'admin', displayName: 'Admin' }) },
        workspace: { create: jest.fn().mockResolvedValue({ id: 'w1', name: 'Org' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));

      const result = await service.createOwner('admin', 'pass', 'Admin', 'Org');

      expect(prisma.user.count).toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalledWith('pass', 10);
      expect(txMock.user.create).toHaveBeenCalled();
      expect(txMock.workspace.create).toHaveBeenCalledWith({ data: { name: 'Org' } });
      expect(txMock.workspaceMember.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-token');
      expect(result.user.role).toBe('OWNER');
    });

    it('should throw BadRequestException when users already exist', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(service.createOwner('admin', 'pass', 'Admin', 'Org')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should use account as displayName when displayName is null', async () => {
      prisma.user.count.mockResolvedValue(0);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const txMock = {
        user: { create: jest.fn().mockResolvedValue({ id: 'u1', account: 'admin', displayName: 'admin' }) },
        workspace: { create: jest.fn().mockResolvedValue({ id: 'w1', name: 'Org' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));

      await service.createOwner('admin', 'pass', null, 'Org');

      expect(txMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ displayName: 'admin' }) }),
      );
    });
  });
});
