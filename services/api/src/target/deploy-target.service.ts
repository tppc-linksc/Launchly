import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from '../environment/secret-value.service';

@Injectable()
export class DeployTargetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
  ) {}

  async listByProject(projectId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map(t => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      type: t.type,
      host: t.host,
      port: t.port,
      username: t.username,
      authMethod: t.authMethod,
      status: t.status,
      lastVerifiedAt: t.lastVerifiedAt?.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listAll(workspaceId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { project: { workspaceId } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map(t => ({
      id: t.id,
      projectId: t.projectId,
      projectName: t.project.name,
      name: t.name,
      type: t.type,
      host: t.host,
      port: t.port,
      username: t.username,
      authMethod: t.authMethod,
      status: t.status,
      lastVerifiedAt: t.lastVerifiedAt?.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async create(projectId: string, data: any) {
    const encryptedCredential = this.secrets.encrypt(data.credential);

    const target = await this.prisma.deployTarget.create({
      data: {
        projectId,
        name: data.name,
        type: data.type || 'SSH',
        host: data.host,
        port: data.port || 22,
        username: data.username,
        authMethod: data.authMethod || 'KEY',
        encryptedCredential,
      },
    });

    return {
      id: target.id,
      projectId: target.projectId,
      name: target.name,
      type: target.type,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      status: target.status,
      createdAt: target.createdAt.toISOString(),
    };
  }

  async getById(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');
    return {
      id: target.id,
      projectId: target.projectId,
      name: target.name,
      type: target.type,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      status: target.status,
      lastVerifiedAt: target.lastVerifiedAt?.toISOString(),
      createdAt: target.createdAt.toISOString(),
    };
  }

  async update(id: string, data: any) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.host !== undefined) updateData.host = data.host;
    if (data.port !== undefined) updateData.port = data.port;
    if (data.username !== undefined) updateData.username = data.username;
    if (data.authMethod !== undefined) updateData.authMethod = data.authMethod;
    if (data.credential !== undefined) updateData.encryptedCredential = this.secrets.encrypt(data.credential);

    const updated = await this.prisma.deployTarget.update({
      where: { id },
      data: updateData,
    });

    return {
      id: updated.id,
      projectId: updated.projectId,
      name: updated.name,
      type: updated.type,
      host: updated.host,
      port: updated.port,
      username: updated.username,
      authMethod: updated.authMethod,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async delete(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    // Check if any deployments reference this target
    const deployCount = await this.prisma.deployment.count({
      where: { deployTargetId: id },
    });
    if (deployCount > 0) {
      throw new ForbiddenException('该部署目标已被部署记录引用，无法删除');
    }

    await this.prisma.deployTarget.delete({ where: { id } });
  }

  async verify(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    // SSH verification would happen here (via worker)
    // For now, return a placeholder
    return {
      success: true,
      message: '连接验证已提交，请查看部署日志',
    };
  }
}
