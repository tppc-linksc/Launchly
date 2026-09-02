import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from './secret-value.service';

/**
 * 环境变量 Service（KI-016 / R0-05）。
 *
 * 行为约束：
 * - 创建/更新前显式校验同一 Environment 下 key 不重复；
 *   数据库层也有 @@unique([environmentId, key]) 作为最后兜底。
 * - 加密/脱敏统一走 SecretValueService，绝不返回明文。
 * - 全部读/写都校验 Environment→Project→Workspace 归属链。
 */
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
    return vars.map((v) => ({
      id: v.id,
      environmentId: v.environmentId,
      key: v.key,
      maskedValue: v.sensitive ? '已设置' : v.maskedValue,
      sensitive: v.sensitive,
      description: v.description,
    }));
  }

  async create(
    environmentId: string,
    data: { key: string; value: string; sensitive?: boolean; description?: string },
    userId: string,
    workspaceId: string,
  ) {
    await this.verifyOwnership(environmentId, workspaceId);
    // KI-016: 显式校验重复 key，给出更友好的错误信息；
    // 数据库唯一约束是兜底，避免 race condition 下静默覆盖。
    const existing = await this.prisma.environmentVariable.findFirst({
      where: { environmentId, key: data.key },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`环境变量 ${data.key} 已存在，请使用更新接口或选择其他 key`);
    }

    const encryptedValue = this.secrets.encrypt(data.value);
    const maskedValue = data.sensitive ? '已设置' : this.secrets.mask(data.value);

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
      maskedValue: variable.sensitive ? '已设置' : variable.maskedValue,
      sensitive: variable.sensitive,
      description: variable.description,
    };
  }

  async update(
    variableId: string,
    data: { value?: string; sensitive?: boolean; description?: string },
    workspaceId: string,
  ) {
    const variable = await this.prisma.environmentVariable.findUnique({
      where: { id: variableId },
      include: { environment: true },
    });
    if (!variable) throw new ForbiddenException('变量不存在');
    await this.verifyOwnership(variable.environmentId, workspaceId);

    const sensitive = data.sensitive ?? variable.sensitive;
    const updated = await this.prisma.environmentVariable.update({
      where: { id: variableId },
      data: {
        ...(data.value !== undefined && {
          encryptedValue: this.secrets.encrypt(data.value),
          maskedValue: sensitive ? '已设置' : this.secrets.mask(data.value),
        }),
        ...(data.value === undefined && data.sensitive === true && { maskedValue: '已设置' }),
        ...(data.sensitive !== undefined && { sensitive: data.sensitive }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
    return {
      id: updated.id,
      environmentId: updated.environmentId,
      key: updated.key,
      maskedValue: updated.sensitive ? '已设置' : updated.maskedValue,
      sensitive: updated.sensitive,
      description: updated.description,
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
