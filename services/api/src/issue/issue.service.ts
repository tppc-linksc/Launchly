import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['FIXING', 'OPEN'],
  FIXING: ['FIXED', 'ASSIGNED'],
  FIXED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'FIXING'],
};

@Injectable()
export class IssueService {
  constructor(private readonly prisma: PrismaService) {}

  async createIssue(projectId: string, data: any, userId: string) {
    if (data.environmentId) {
      const environment = await this.prisma.environment.findUnique({
        where: { id: data.environmentId },
        select: { projectId: true },
      });
      if (!environment) {
        throw new BadRequestException('环境不存在');
      }
      if (environment.projectId !== projectId) {
        throw new BadRequestException('环境不属于当前项目');
      }
    }

    if (data.deploymentId) {
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: data.deploymentId },
        select: { projectId: true },
      });
      if (!deployment) {
        throw new BadRequestException('部署不存在');
      }
      if (deployment.projectId !== projectId) {
        throw new BadRequestException('部署不属于当前项目');
      }
    }

    return this.prisma.issue.create({
      data: {
        projectId,
        environmentId: data.environmentId,
        deploymentId: data.deploymentId,
        title: data.title,
        description: data.description,
        priority: data.priority || 'P2',
        reporterId: userId,
        assigneeId: data.assigneeId,
      },
    });
  }

  async createFromFailedTest(
    testRunCaseId: string,
    projectId: string,
    deploymentId: string,
    testCaseTitle: string | null,
    userId: string,
  ) {
    const runCase = await this.prisma.testRunCase.findUnique({
      where: { id: testRunCaseId },
      include: { testCase: true, testRun: true },
    });
    if (!runCase) throw new NotFoundException('Test run case not found');

    return this.prisma.issue.create({
      data: {
        projectId,
        environmentId: runCase.testRun.environmentId,
        deploymentId,
        testCaseId: runCase.testCaseId,
        testRunCaseId,
        title: testCaseTitle || runCase.testCase.title,
        description: `测试用例失败: ${runCase.testCase.title}\n备注: ${runCase.notes || '无'}`,
        priority: runCase.testCase.priority,
        reporterId: userId,
      },
    });
  }

  async listIssues(projectId: string, status?: string, priority?: string, assigneeId?: string) {
    return this.prisma.issue.findMany({
      where: {
        projectId,
        ...(status && { status }),
        ...(priority && { priority }),
        ...(assigneeId && { assigneeId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getIssue(id: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  async updateIssue(id: string, data: any) {
    return this.prisma.issue.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId }),
        ...(data.fixedCommitSha !== undefined && { fixedCommitSha: data.fixedCommitSha }),
      },
    });
  }

  async transition(id: string, data: { toStatus: string }, _userId: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue not found');

    const allowed = VALID_TRANSITIONS[issue.status] || [];
    if (!allowed.includes(data.toStatus)) {
      throw new BadRequestException(`不能从 ${issue.status} 转换到 ${data.toStatus}`);
    }

    return this.prisma.issue.update({
      where: { id },
      data: { status: data.toStatus },
    });
  }
}
