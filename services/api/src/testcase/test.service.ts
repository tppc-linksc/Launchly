import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class TestService {
  constructor(private readonly prisma: PrismaService) {}

  async createTestCase(projectId: string, data: any) {
    return this.prisma.testCase.create({
      data: {
        projectId,
        title: data.title,
        description: data.description,
        priority: data.priority || 'P2',
        steps: data.steps,
        expectedResult: data.expectedResult,
      },
    });
  }

  async listTestCases(projectId: string) {
    return this.prisma.testCase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTestCase(id: string) {
    const tc = await this.prisma.testCase.findUnique({ where: { id } });
    if (!tc) throw new NotFoundException('Test case not found');
    return tc;
  }

  async updateTestCase(id: string, data: any) {
    return this.prisma.testCase.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.steps !== undefined && { steps: data.steps }),
        ...(data.expectedResult !== undefined && { expectedResult: data.expectedResult }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
  }

  async deleteTestCase(id: string) {
    await this.prisma.testCase.delete({ where: { id } });
  }

  async createTestRun(deploymentId: string, projectId: string, environmentId: string, userId: string) {
    const testCases = await this.prisma.testCase.findMany({
      where: { projectId, status: 'ACTIVE' },
    });

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.create({
        data: {
          deploymentId,
          projectId,
          environmentId,
          totalCases: testCases.length,
          triggeredBy: userId,
        },
      });

      if (testCases.length > 0) {
        await tx.testRunCase.createMany({
          data: testCases.map(tc => ({
            testRunId: run.id,
            testCaseId: tc.id,
          })),
        });
      }

      return run;
    });
  }

  async getTestRun(id: string) {
    const run = await this.prisma.testRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Test run not found');
    return run;
  }

  async listTestRuns(projectId: string) {
    return this.prisma.testRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTestRunCases(testRunId: string) {
    return this.prisma.testRunCase.findMany({
      where: { testRunId },
      include: { testCase: true },
    });
  }

  async updateTestRunCase(testRunId: string, caseId: string, data: any, userId: string) {
    const runCase = await this.prisma.testRunCase.findFirst({
      where: { id: caseId, testRunId },
    });
    if (!runCase) throw new NotFoundException('Test run case not found');

    const updated = await this.prisma.testRunCase.update({
      where: { id: caseId },
      data: {
        result: data.result,
        notes: data.notes,
        executedBy: userId,
        executedAt: new Date(),
      },
    });

    // Update test run counters
    await this.updateTestRunCounters(testRunId);

    return updated;
  }

  private async updateTestRunCounters(testRunId: string) {
    const cases = await this.prisma.testRunCase.findMany({
      where: { testRunId },
    });

    const passed = cases.filter(c => c.result === 'PASSED').length;
    const failed = cases.filter(c => c.result === 'FAILED').length;
    const skipped = cases.filter(c => c.result === 'SKIPPED').length;
    const allDone = cases.every(c => c.result !== 'PENDING');

    await this.prisma.testRun.update({
      where: { id: testRunId },
      data: {
        passedCases: passed,
        failedCases: failed,
        skippedCases: skipped,
        status: allDone ? 'COMPLETED' : 'RUNNING',
        finishedAt: allDone ? new Date() : null,
      },
    });
  }
}
