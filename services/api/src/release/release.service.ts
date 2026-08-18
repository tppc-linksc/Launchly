import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GateCheckService } from './gate-check.service';

/**
 * 发布（Release）Service（KI-020 / KI-021 / R0-09 / R5）。
 *
 * 关键约束：
 * - publish 必须有完整的 Gate 评估结果；空 gates + allPassed=false 视为配置异常，fail closed。
 * - 同 digest 晋级不重新构建；gate status 写入用 PASSED/EXEMPTED/FAILED 三态明确区分。
 */

@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateCheck: GateCheckService,
  ) {}

  async createRelease(projectId: string, data: { environmentId: string; deploymentId: string; version: string; notes?: string }, userId: string) {
    if (!data.version || !data.version.trim()) {
      throw new BadRequestException('version 不能为空');
    }
    const environment = await this.prisma.environment.findUnique({
      where: { id: data.environmentId },
      select: { projectId: true },
    });
    if (!environment) throw new BadRequestException('环境不存在');
    if (environment.projectId !== projectId) throw new BadRequestException('环境不属于当前项目');

    const deployment = await this.prisma.deployment.findUnique({
      where: { id: data.deploymentId },
      select: { projectId: true },
    });
    if (!deployment) throw new BadRequestException('部署不存在');
    if (deployment.projectId !== projectId) throw new BadRequestException('部署不属于当前项目');

    return this.prisma.release.create({
      data: {
        projectId,
        environmentId: data.environmentId,
        deploymentId: data.deploymentId,
        version: data.version,
        notes: data.notes ?? null,
        releasedBy: userId,
      },
    });
  }

  async listReleases(projectId: string) {
    return this.prisma.release.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async getRelease(id: string) {
    const release = await this.prisma.release.findUnique({ where: { id } });
    if (!release) throw new NotFoundException('发布不存在');
    return release;
  }

  async getGateStatus(id: string) {
    return this.gateCheck.checkGates(id);
  }

  /**
   * 发布晋级。
   * KI-020 修复要点：
   * - 拒绝空 gates + allPassed=false 的"伪装 EXEMPTED"。
   * - 必须存在且通过（或被显式豁免）所有 Gate 才能发布。
   */
  async publish(id: string, userId: string) {
    const release = await this.prisma.release.findUnique({ where: { id } });
    if (!release) throw new NotFoundException('发布不存在');

    const gateStatus = await this.gateCheck.checkGates(id);

    // KI-020: 若 Gate 评估异常（结构矛盾/空集合 + allPassed=false），直接拒绝。
    if (!gateStatus || !Array.isArray(gateStatus.gates) || gateStatus.gates.length === 0) {
      throw new ForbiddenException('Gate 评估结果为空，无法判断发布安全，请先修复 Gate 配置');
    }
    if (gateStatus.gates.length === 0 && gateStatus.allPassed === false) {
      throw new ForbiddenException('Gate 评估结果矛盾（空集合且 allPassed=false），已 fail closed');
    }

    const exemptions = await this.prisma.gateExemption.findMany({ where: { releaseId: id } });
    const exemptedGates = new Set(exemptions.map(e => e.gateName));

    const unresolvedFailures = gateStatus.gates.filter(g => !g.passed && !exemptedGates.has(g.name));
    if (unresolvedFailures.length > 0) {
      throw new ForbiddenException('Gate 未通过: ' + unresolvedFailures.map(g => g.message).join('; '));
    }

    const allExempted = gateStatus.gates.every(g => !g.passed && exemptedGates.has(g.name));
    return this.prisma.release.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        gateStatus: gateStatus.allPassed ? 'PASSED' : (allExempted ? 'EXEMPTED' : 'PASSED'),
        releasedBy: userId,
        releasedAt: new Date(),
      },
    });
  }

  async exemptGate(id: string, gateName: string, data: { reason: string; ticket?: string }, userId: string) {
    if (!data.reason || !String(data.reason).trim()) {
      throw new BadRequestException('豁免原因不能为空（KI-020）');
    }
    return this.prisma.gateExemption.create({
      data: {
        releaseId: id,
        gateName,
        exemptedBy: userId,
        reason: data.reason,
      },
    });
  }

  async getExemptions(id: string) {
    return this.prisma.gateExemption.findMany({ where: { releaseId: id } });
  }
}
