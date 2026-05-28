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
    if (dto.deployMode != null) data.deployMode = dto.deployMode;
    if (dto.host != null) data.host = dto.host;
    if (dto.sshUser != null) data.sshUser = dto.sshUser;
    if (dto.deployDir != null) data.deployDir = dto.deployDir;
    if (dto.localWorkRoot != null) data.localWorkRoot = dto.localWorkRoot;
    if (dto.externalPort != null) data.externalPort = dto.externalPort;
    if (dto.dataStrategy != null) data.dataStrategy = dto.dataStrategy;
    if (dto.enabled != null) data.enabled = dto.enabled;

    return this.prisma.environment.update({ where: { id }, data });
  }
}
