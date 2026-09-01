import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateEnvironmentDto } from './dto';

@Injectable()
export class EnvironmentService {
  constructor(private readonly prisma: PrismaService) {}

  async listByProject(projectId: string) {
    return this.prisma.environment.findMany({
      where: { projectId },
      orderBy: { type: 'asc' },
    });
  }

  async update(id: string, dto: UpdateEnvironmentDto, workspaceId: string) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env) throw new NotFoundException('环境不存在: ' + id);

    // Ownership check
    const project = await this.prisma.project.findUnique({ where: { id: env.projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权更新此环境');
    }

    const data: any = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.url != null) data.url = dto.url;
    if (dto.domain != null) {
      const domain = this.normalizeDomain(dto.domain);
      if (domain) {
        const conflict = await this.prisma.environment.findFirst({
          where: { id: { not: id }, domain, project: { workspaceId } },
          select: { id: true },
        });
        if (conflict) throw new ForbiddenException('此工作空间中已有环境使用该域名');
      }
      data.domain = domain;
    }
    if (dto.deployMode != null) data.deployMode = dto.deployMode;
    if (dto.host != null) data.host = dto.host;
    if (dto.sshUser != null) data.sshUser = dto.sshUser;
    if (dto.deployDir != null) data.deployDir = dto.deployDir;
    if (dto.localWorkRoot != null) data.localWorkRoot = dto.localWorkRoot;
    if (dto.externalPort != null) data.externalPort = dto.externalPort;
    if (dto.dataStrategy != null) data.dataStrategy = dto.dataStrategy;
    if (dto.enabled != null) data.enabled = dto.enabled;
    if (dto.autoDeploy != null) data.autoDeploy = dto.autoDeploy;
    if (dto.branchPattern != null) data.branchPattern = dto.branchPattern;
    if (dto.requireCi != null) data.requireCi = dto.requireCi;
    if (dto.deployTargetId != null) {
      if (dto.deployTargetId === '') {
        data.deployTargetId = null;
      } else {
        const target = await this.prisma.deployTarget.findUnique({
          where: { id: dto.deployTargetId },
          select: { projectId: true },
        });
        if (!target || target.projectId !== env.projectId) {
          throw new ForbiddenException('部署目标不存在或不属于当前项目');
        }
        data.deployTargetId = dto.deployTargetId;
      }
    }

    return this.prisma.environment.update({ where: { id }, data });
  }

  private normalizeDomain(value: string): string | null {
    const domain = value.trim().toLowerCase();
    if (!domain) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      throw new ForbiddenException('域名格式无效；请填写例如 app.example.com 的主机名，不含协议和路径');
    }
    return domain;
  }
}
