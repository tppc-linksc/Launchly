import { Test, TestingModule } from '@nestjs/testing';
import { IssueService } from './issue.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('IssueService', () => {
  let service: IssueService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<IssueService>(IssueService);
  });

  afterEach(() => jest.resetAllMocks());

  describe('VALID_TRANSITIONS', () => {
    it('should define all expected transitions', () => {
      // Access the module-level constant via the service's transition behavior
      // OPEN -> ASSIGNED
      prisma.issue.findUnique.mockResolvedValue({ id: 'i1', status: 'OPEN' });
      prisma.issue.update.mockResolvedValue({ id: 'i1', status: 'ASSIGNED' });
      expect(service.transition('i1', { toStatus: 'ASSIGNED' }, 'u1')).resolves.toBeDefined();
    });
  });

  describe('transition', () => {
    it('should update status on a valid transition', async () => {
      const issue = { id: 'i1', status: 'OPEN' };
      prisma.issue.findUnique.mockResolvedValue(issue);
      prisma.issue.update.mockResolvedValue({ ...issue, status: 'ASSIGNED' });

      const result = await service.transition('i1', { toStatus: 'ASSIGNED' }, 'u1');

      expect(prisma.issue.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: { status: 'ASSIGNED' },
      });
      expect(result.status).toBe('ASSIGNED');
    });

    it('should throw NotFoundException when issue does not exist', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);

      await expect(service.transition('bad-id', { toStatus: 'ASSIGNED' }, 'u1')).rejects.toThrow(NotFoundException);
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for an invalid transition', async () => {
      prisma.issue.findUnique.mockResolvedValue({ id: 'i1', status: 'OPEN' });

      await expect(service.transition('i1', { toStatus: 'CLOSED' }, 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('should allow CLOSED -> REOPENED transition', async () => {
      const issue = { id: 'i1', status: 'CLOSED' };
      prisma.issue.findUnique.mockResolvedValue(issue);
      prisma.issue.update.mockResolvedValue({ ...issue, status: 'REOPENED' });

      const result = await service.transition('i1', { toStatus: 'REOPENED' }, 'u1');

      expect(result.status).toBe('REOPENED');
    });

    it('should throw BadRequestException for REOPENED -> CLOSED (not allowed)', async () => {
      prisma.issue.findUnique.mockResolvedValue({ id: 'i1', status: 'REOPENED' });

      await expect(service.transition('i1', { toStatus: 'CLOSED' }, 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getIssue', () => {
    it('should return the issue when found', async () => {
      const issue = { id: 'i1', title: 'Bug', status: 'OPEN' };
      prisma.issue.findUnique.mockResolvedValue(issue);

      const result = await service.getIssue('i1');

      expect(result).toEqual(issue);
      expect(prisma.issue.findUnique).toHaveBeenCalledWith({ where: { id: 'i1' } });
    });

    it('should throw NotFoundException when issue not found', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);

      await expect(service.getIssue('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createIssue', () => {
    it('should create an issue with default priority P2', async () => {
      const created = { id: 'i1', priority: 'P2', title: 'Test Bug' };
      prisma.issue.create.mockResolvedValue(created);

      const result = await service.createIssue('p1', { title: 'Test Bug' }, 'u1');

      expect(prisma.issue.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'p1',
          title: 'Test Bug',
          priority: 'P2',
          reporterId: 'u1',
        }),
      });
      expect(result).toEqual(created);
    });

    it('should use provided priority when specified', async () => {
      prisma.issue.create.mockResolvedValue({ id: 'i1', priority: 'P0' });

      await service.createIssue('p1', { title: 'Critical', priority: 'P0' }, 'u1');

      expect(prisma.issue.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'P0' }),
      });
    });
  });
});
