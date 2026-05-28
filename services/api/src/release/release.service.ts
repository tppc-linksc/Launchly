import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GateCheckService } from './gate-check.service';

@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateCheck: GateCheckService,
  ) {}

  async createRelease(projectId: string, data: any, userId: string) {
    return this.prisma.release.create({
      data: {
        projectId,
        environmentId: data.environmentId,
        deploymentId: data.deploymentId,
        version: data.version,
        notes: data.notes,
        releasedBy: userId,
      },
    });
  }

  async listReleases(projectId: string) {
    return this.prisma.release.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRelease(id: string) {
    const release = await this.prisma.release.findUnique({ where: { id } });
    if (!release) throw new NotFoundException('Release not found');
    return release;
  }

  async getGateStatus(id: string) {
    return this.gateCheck.checkGates(id);
  }

  async publish(id: string, userId: string) {
    const release = await this.prisma.release.findUnique({ where: { id } });
    if (!release) throw new NotFoundException('Release not found');

    const gateStatus = await this.gateCheck.checkGates(id);

    // Check for exemptions
    const exemptions = await this.prisma.gateExemption.findMany({
      where: { releaseId: id },
    });
    const exemptedGates = new Set(exemptions.map(e => e.gateName));

    const unresolvedFailures = gateStatus.gates.filter(
      g => !g.passed && !exemptedGates.has(g.name),
    );

    if (unresolvedFailures.length > 0) {
      throw new ForbiddenException('门禁检查未通过: ' + unresolvedFailures.map(g => g.message).join(', '));
    }

    return this.prisma.release.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        gateStatus: gateStatus.allPassed ? 'PASSED' : 'EXEMPTED',
        releasedBy: userId,
        releasedAt: new Date(),
      },
    });
  }

  async exemptGate(id: string, gateName: string, data: any, userId: string) {
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
    return this.prisma.gateExemption.findMany({
      where: { releaseId: id },
    });
  }
}
