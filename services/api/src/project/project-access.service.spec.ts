import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('ProjectAccessService.require', () => {
  let service: ProjectAccessService;
  let prisma: MockPrismaService;

  const projectId = 'proj-1';
  const workspaceId = 'ws-1';
  const userId = 'user-1';

  const baseProject = { id: projectId, workspaceId, name: 'p', extra: 'sentinel' };

  beforeEach(() => {
    prisma = createPrismaMock();
    // The shared prisma-mock factory does not register projectMember; attach the
    // surface used by ProjectAccessService manually so each test gets fresh fns.
    (prisma as any).projectMember = { findFirst: jest.fn() };
    service = new ProjectAccessService(prisma as any);
  });

  describe('project lookup', () => {
    it('throws NotFoundException when the workspace-scoped project does not exist', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      const rejection = service.require(projectId, userId, workspaceId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('项目不存在');
      expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
      expect(prisma.projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the workspace-scoped lookup cannot find the project', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.require(projectId, userId, workspaceId)).rejects.toThrow(NotFoundException);
      expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: projectId, workspaceId } });
      expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
      expect(prisma.projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('queries project using BOTH projectId AND workspaceId in the same where clause', async () => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      await service.require(projectId, userId, workspaceId);

      expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: projectId, workspaceId } });
    });
  });

  describe('workspace OWNER short-circuit', () => {
    it('returns the project as-is when the workspace member is OWNER', async () => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const result = await service.require(projectId, userId, workspaceId);

      expect(result).toBe(baseProject);
      expect((result as unknown as { extra: string }).extra).toBe('sentinel');
      expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({ where: { workspaceId, userId } });
    });

    it('does NOT look up ProjectMember when the user is a workspace OWNER', async () => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      await service.require(projectId, userId, workspaceId);

      expect(prisma.projectMember.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('non-OWNER membership', () => {
    beforeEach(() => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    });

    it('rejects with the membership message when there is no ProjectMember', async () => {
      prisma.projectMember.findFirst.mockResolvedValue(null);

      await expect(service.require(projectId, userId, workspaceId)).rejects.toThrow(/缺少项目级权限/);
      expect(prisma.projectMember.findFirst).toHaveBeenCalledWith({ where: { projectId, userId } });
    });

    it('rejects with the membership message when ProjectMember role is unknown (production: levels[unknown] || 0 < any minimum)', async () => {
      prisma.projectMember.findFirst.mockResolvedValue({ role: 'MYSTERY' });

      await expect(service.require(projectId, userId, workspaceId)).rejects.toThrow(/缺少项目级权限/);
    });

    it.each([
      ['VIEWER', 1],
      ['TESTER', 2],
      ['DEVELOPER', 3],
      ['ADMIN', 4],
      ['OWNER', 5],
    ])('returns the project when ProjectMember role is %s', async (role) => {
      prisma.projectMember.findFirst.mockResolvedValue({ role });

      const result = await service.require(projectId, userId, workspaceId);

      expect(result).toEqual(baseProject);
    });
  });

  describe('minimumRole matrix (5 × 5)', () => {
    const matrix: Array<[string, string, boolean]> = [
      // membership VIEWER (1)
      ['VIEWER', 'VIEWER', true],
      ['VIEWER', 'TESTER', false],
      ['VIEWER', 'DEVELOPER', false],
      ['VIEWER', 'ADMIN', false],
      ['VIEWER', 'OWNER', false],
      // membership TESTER (2)
      ['TESTER', 'VIEWER', true],
      ['TESTER', 'TESTER', true],
      ['TESTER', 'DEVELOPER', false],
      ['TESTER', 'ADMIN', false],
      ['TESTER', 'OWNER', false],
      // membership DEVELOPER (3)
      ['DEVELOPER', 'VIEWER', true],
      ['DEVELOPER', 'TESTER', true],
      ['DEVELOPER', 'DEVELOPER', true],
      ['DEVELOPER', 'ADMIN', false],
      ['DEVELOPER', 'OWNER', false],
      // membership ADMIN (4)
      ['ADMIN', 'VIEWER', true],
      ['ADMIN', 'TESTER', true],
      ['ADMIN', 'DEVELOPER', true],
      ['ADMIN', 'ADMIN', true],
      ['ADMIN', 'OWNER', false],
      // membership OWNER (5)
      ['OWNER', 'VIEWER', true],
      ['OWNER', 'TESTER', true],
      ['OWNER', 'DEVELOPER', true],
      ['OWNER', 'ADMIN', true],
      ['OWNER', 'OWNER', true],
    ];

    it.each(matrix)('membership=%s minimumRole=%s → allowed=%s', async (membershipRole, minimumRole, allowed) => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.projectMember.findFirst.mockResolvedValue({ role: membershipRole });

      if (allowed) {
        const result = await service.require(projectId, userId, workspaceId, minimumRole);
        expect(result).toEqual(baseProject);
      } else {
        await expect(service.require(projectId, userId, workspaceId, minimumRole)).rejects.toThrow(ForbiddenException);
      }
    });
  });

  describe('unknown minimumRole — current production behaviour', () => {
    // Production code: `(levels[minimumRole] || 1)` — an unknown minimumRole silently
    // degrades to level 1 (= VIEWER). This is a candidate production defect; the
    // test below documents and locks in the CURRENT behaviour and must not be
    // considered a recommendation that the behaviour is correct.
    it('unknown minimumRole degrades to VIEWER level (1), so a VIEWER membership passes and a non-recognised membership is rejected', async () => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

      // membership = VIEWER (1) passes, because 1 >= 1
      prisma.projectMember.findFirst.mockResolvedValue({ role: 'VIEWER' });
      const result = await service.require(projectId, userId, workspaceId, 'MYSTERY_ROLE');
      expect(result).toEqual(baseProject);

      // membership = unknown role (0) rejects, because 0 < 1
      prisma.projectMember.findFirst.mockResolvedValue({ role: 'BOGUS' });
      await expect(service.require(projectId, userId, workspaceId, 'MYSTERY_ROLE')).rejects.toThrow(/缺少项目级权限/);
    });
  });
});
