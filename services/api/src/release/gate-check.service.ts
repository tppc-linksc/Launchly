import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export interface GateCheckResult {
  gates: { name: string; passed: boolean; message: string }[];
  allPassed: boolean;
}

@Injectable()
export class GateCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async checkGates(releaseId: string): Promise<GateCheckResult> {
    const release = await this.prisma.release.findUnique({ where: { id: releaseId } });
    if (!release) return { gates: [], allPassed: false };

    const gates = await Promise.all([
      this.checkStagingDeploy(release),
      this.checkHealthCheck(release),
      this.checkP0Tests(release),
      this.checkOpenIssues(release),
    ]);

    return {
      gates,
      allPassed: gates.every(g => g.passed),
    };
  }

  private async checkStagingDeploy(release: any) {
    const env = await this.prisma.environment.findUnique({
      where: { id: release.environmentId },
    });
    const hasStaging = env?.type === 'STAGING' || env?.type === 'PRODUCTION';
    return {
      name: 'staging_deploy',
      passed: hasStaging,
      message: hasStaging ? '预发环境部署完成' : '需要先在预发环境部署',
    };
  }

  private async checkHealthCheck(release: any) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: release.deploymentId },
    });
    const passed = deployment?.status === 'SUCCEEDED';
    return {
      name: 'health_check',
      passed,
      message: passed ? '健康检查通过' : '部署未成功完成',
    };
  }

  private async checkP0Tests(release: any) {
    const testRuns = await this.prisma.testRun.findMany({
      where: { deploymentId: release.deploymentId },
    });
    const hasP0Failure = testRuns.some(r => r.failedCases > 0);
    return {
      name: 'p0_tests',
      passed: !hasP0Failure,
      message: hasP0Failure ? '存在失败的测试用例' : '所有测试通过',
    };
  }

  private async checkOpenIssues(release: any) {
    const openIssues = await this.prisma.issue.count({
      where: {
        projectId: release.projectId,
        status: { in: ['OPEN', 'ASSIGNED', 'FIXING', 'REOPENED'] },
        priority: { in: ['P0', 'P1'] },
      },
    });
    return {
      name: 'open_issues',
      passed: openIssues === 0,
      message: openIssues === 0 ? '无未解决的 P0/P1 Issue' : `有 ${openIssues} 个未解决的 P0/P1 Issue`,
    };
  }
}
