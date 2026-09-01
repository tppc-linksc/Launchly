import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  PROJECT_ROLES,
  ProjectResourceAccessPolicy,
} from './project-resource-access-policy';
import { createPrismaMock, MockPrismaService } from '../../../test/helpers/prisma-mock';

/**
 * ProjectResourceAccessPolicy 单元测试（KI-004 / R0-04 / KI-018）。
 *
 * 测试重点：
 * - 角色字符串合法但级别不足时拒绝；
 * - 未知角色抛 500（fail closed）；
 * - 工作空间 OWNER 走短路；
 * - 子资源 ID 反查所属项目，再走统一校验。
 */
describe('ProjectResourceAccessPolicy', () => {
  let policy: ProjectResourceAccessPolicy;
  let prisma: MockPrismaService;

  const projectId = 'proj-1';
  const workspaceId = 'ws-1';
  const userId = 'user-1';

  const baseProject = { id: projectId, workspaceId, name: 'demo' };

  beforeEach(() => {
    prisma = createPrismaMock();
    // prisma-mock factory 没有注册 projectMember；按需补充。
    (prisma as any).projectMember = { findFirst: jest.fn() };
    policy = new ProjectResourceAccessPolicy(prisma as any);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============================================================
  // A. requireProject — 公共校验
  // ============================================================
  describe('A. requireProject - workspace 边界', () => {
    it('项目不存在或不属于当前工作空间 → NotFoundException，不查 membership', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      const rejection = policy.requireProject(projectId, userId, workspaceId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('项目不存在');
      expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
      expect((prisma as any).projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('项目查询必须同时过滤 projectId 与 workspaceId', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        policy.requireProject(projectId, userId, workspaceId),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: projectId, workspaceId },
      });
    });
  });

  describe('B. requireProject - workspace OWNER 短路', () => {
    it('workspace OWNER 直接返回项目，不再查 projectMember', async () => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const result = await policy.requireProject(projectId, userId, workspaceId);

      expect(result).toBe(baseProject);
      expect((prisma as any).projectMember.findFirst).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: { workspaceId, userId },
      });
    });
  });

  describe('C. requireProject - project membership 级别判断', () => {
    beforeEach(() => {
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    });

    it('无 projectMember 行 → ForbiddenException "缺少项目级权限"', async () => {
      (prisma as any).projectMember.findFirst.mockResolvedValue(null);

      const rejection = policy.requireProject(projectId, userId, workspaceId);
      await expect(rejection).rejects.toThrow(ForbiddenException);
      await expect(rejection).rejects.toThrow('缺少项目级权限');
    });

    it.each([
      ['VIEWER',    'VIEWER',    true],
      ['VIEWER',    'TESTER',    true],
      ['VIEWER',    'DEVELOPER', true],
      ['VIEWER',    'ADMIN',     true],
      ['VIEWER',    'OWNER',     true],
      ['TESTER',    'VIEWER',    false],
      ['TESTER',    'TESTER',    true],
      ['DEVELOPER', 'TESTER',    false],
      ['DEVELOPER', 'DEVELOPER', true],
      ['ADMIN',     'DEVELOPER', false],
      ['ADMIN',     'OWNER',     true],
      ['OWNER',     'ADMIN',     false],
      ['OWNER',     'OWNER',     true],
    ])('minimumRole=%s 与 projectMember.role=%s → %s', async (minimumRole, memberRole, expectedPass) => {
      (prisma as any).projectMember.findFirst.mockResolvedValue({ role: memberRole });

      const p = policy.requireProject(projectId, userId, workspaceId, minimumRole as any);
      if (expectedPass) {
        const r = await p;
        expect(r).toBe(baseProject);
      } else {
        await expect(p).rejects.toThrow(/缺少项目级权限/);
      }
    });

    it('projectMember.role 是未知值 → 抛 500（fail closed）', async () => {
      (prisma as any).projectMember.findFirst.mockResolvedValue({ role: 'MYSTERY' });

      const rejection = policy.requireProject(projectId, userId, workspaceId);
      await expect(rejection).rejects.toThrow(InternalServerErrorException);
      await expect(rejection).rejects.toThrow(/membership 角色非法/);
    });

    it('projectMember.role 不是字符串（如数字）→ 抛 500', async () => {
      (prisma as any).projectMember.findFirst.mockResolvedValue({ role: 5 });

      await expect(
        policy.requireProject(projectId, userId, workspaceId),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('传入的 minimumRole 是未知值 → 抛 500，不进入 prisma 查询', async () => {
      const rejection = policy.requireProject(projectId, userId, workspaceId, 'GOD_MODE' as any);
      await expect(rejection).rejects.toThrow(InternalServerErrorException);
      await expect(rejection).rejects.toThrow(/minimumRole 角色非法/);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('PROJECT_ROLES 包含且仅包含 5 个固定值', () => {
      // 既保证未来角色不被偷偷加进来，也保证现有测试用例不会因为这里变化而误失效。
      expect(PROJECT_ROLES).toEqual(['VIEWER', 'TESTER', 'DEVELOPER', 'ADMIN', 'OWNER']);
    });
  });

  // ============================================================
  // D. requireEnvironment
  // ============================================================
  describe('D. requireEnvironment', () => {
    it('环境不存在 → NotFoundException "环境不存在"，不再走 requireProject', async () => {
      prisma.environment.findUnique.mockResolvedValue(null);

      const rejection = policy.requireEnvironment('env-1', userId, workspaceId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('环境不存在');
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('存在 → 反查 projectId 并走统一校验，最终返回项目行', async () => {
      prisma.environment.findUnique.mockResolvedValue({ projectId });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const result = await policy.requireEnvironment('env-1', userId, workspaceId);

      expect(prisma.environment.findUnique).toHaveBeenCalledWith({
        where: { id: 'env-1' },
        select: { projectId: true },
      });
      expect(result).toBe(baseProject);
    });
  });

  // ============================================================
  // E. requireEnvironmentVariable
  // ============================================================
  describe('E. requireEnvironmentVariable', () => {
    it('变量不存在 → NotFoundException "环境变量不存在"', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue(null);

      const rejection = policy.requireEnvironmentVariable('var-1', userId, workspaceId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('环境变量不存在');
    });

    it('变量存在但 environment 为 null → 同样 NotFoundException', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue({ environment: null });

      await expect(
        policy.requireEnvironmentVariable('var-1', userId, workspaceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('存在 → 反查所属 environment 的 projectId 并完成校验', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue({
        environment: { projectId },
      });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const result = await policy.requireEnvironmentVariable('var-1', userId, workspaceId);

      expect(prisma.environmentVariable.findUnique).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        select: { environment: { select: { projectId: true } } },
      });
      expect(result).toBe(baseProject);
    });
  });

  // ============================================================
  // F. requireDeployTarget
  // ============================================================
  describe('F. requireDeployTarget', () => {
    it('目标不存在 → NotFoundException "部署目标不存在"', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue(null);

      await expect(
        policy.requireDeployTarget('tgt-1', userId, workspaceId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        policy.requireDeployTarget('tgt-1', userId, workspaceId),
      ).rejects.toThrow('部署目标不存在');
    });

    it('存在 → 反查 projectId 并走校验', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue({ projectId });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const result = await policy.requireDeployTarget('tgt-1', userId, workspaceId);

      expect(prisma.deployTarget.findUnique).toHaveBeenCalledWith({
        where: { id: 'tgt-1' },
        select: { projectId: true },
      });
      expect(result).toBe(baseProject);
    });

    it('projectMember 角色不足 → ForbiddenException', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue({ projectId });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      (prisma as any).projectMember.findFirst.mockResolvedValue({ role: 'VIEWER' });

      await expect(
        policy.requireDeployTarget('tgt-1', userId, workspaceId, 'DEVELOPER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // G. requireIssue / requireRelease / requireTestCase / requireTestRun / requireDeployment
  //    同样的反查 + 校验模式，统一做一遍确认。
  // ============================================================
  describe.each([
    ['requireIssue',        'issue',       '问题不存在',       'issue-1'],
    ['requireRelease',      'release',     '发布不存在',       'rel-1'],
    ['requireTestCase',     'testCase',    '测试用例不存在',   'tc-1'],
    ['requireTestRun',      'testRun',     '测试运行不存在',   'tr-1'],
    ['requireDeployment',   'deployment',  '部署不存在',       'dep-1'],
  ] as const)('%s', (methodName, model, notFoundMessage, resourceId) => {
    it('资源不存在 → NotFoundException 带中文消息', async () => {
      ((prisma as any)[model].findUnique as jest.Mock).mockResolvedValue(null);

      const fn = (policy as any)[methodName].bind(policy);
      const rejection = fn(resourceId, userId, workspaceId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow(notFoundMessage);
    });

    it('存在 → 反查 projectId + 走 requireProject，最终返回项目行', async () => {
      ((prisma as any)[model].findUnique as jest.Mock).mockResolvedValue({ projectId });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'OWNER' });

      const fn = (policy as any)[methodName].bind(policy);
      const result = await fn(resourceId, userId, workspaceId);

      expect(result).toBe(baseProject);
      expect(((prisma as any)[model].findUnique as jest.Mock)).toHaveBeenCalledWith({
        where: { id: resourceId },
        select: { projectId: true },
      });
    });

    it('minimumRole 高于实际成员级别 → ForbiddenException "缺少项目级权限"', async () => {
      ((prisma as any)[model].findUnique as jest.Mock).mockResolvedValue({ projectId });
      prisma.project.findFirst.mockResolvedValue(baseProject);
      prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      (prisma as any).projectMember.findFirst.mockResolvedValue({ role: 'VIEWER' });

      const fn = (policy as any)[methodName].bind(policy);
      const rejection = fn(resourceId, userId, workspaceId, 'DEVELOPER');
      await expect(rejection).rejects.toThrow(/缺少项目级权限/);
    });
  });
});
