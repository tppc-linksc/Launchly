import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from './secret-value.service';

@Injectable()
export class EnvironmentVariableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
  ) {}

  async listByEnvironment(environmentId: string) {
    const vars = await this.prisma.environmentVariable.findMany({
      where: { environmentId },
    });
    return vars.map(v => ({
      id: v.id,
      environmentId: v.environmentId,
      key: v.key,
      maskedValue: v.maskedValue,
      sensitive: v.sensitive,
      description: v.description,
    }));
  }

  async create(environmentId: string, data: { key: string; value: string; sensitive?: boolean; description?: string }, userId: string, workspaceId: string) {
    await this.verifyOwnership(environmentId, workspaceId);

    const encryptedValue = this.secrets.encrypt(data.value);
    const maskedValue = this.secrets.mask(data.value);

    const variable = await this.prisma.environmentVariable.create({
      data: {
        environmentId,
        key: data.key,
        encryptedValue,
        maskedValue,
        sensitive: data.sensitive || false,
        description: data.description,
      },
    });

    return {
      id: variable.id,
      environmentId: variable.environmentId,
      key: variable.key,
      maskedValue: variable.maskedValue,
      sensitive: variable.sensitive,
      description: variable.description,
    };
  }

  async delete(variableId: string, userId: string, workspaceId: string) {
    const variable = await this.prisma.environmentVariable.findUnique({
      where: { id: variableId },
      include: { environment: true },
    });
    if (!variable) throw new ForbiddenException('变量不存在');

    const project = await this.prisma.project.findUnique({
      where: { id: variable.environment.projectId },
    });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权删除此变量');
    }

    await this.prisma.environmentVariable.delete({ where: { id: variableId } });
  }

  private async verifyOwnership(environmentId: string, workspaceId: string) {
    const env = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });
    if (!env) throw new ForbiddenException('环境不存在');

    const project = await this.prisma.project.findUnique({
      where: { id: env.projectId },
    });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权操作此环境');
    }
  }
}
