import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProjectDto, workspaceId: string, userId: string) {
    const project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description,
          projectType: dto.projectType || 'CUSTOM',
          repositoryUrl: dto.repositoryUrl,
          defaultBranch: dto.defaultBranch || 'main',
          gitProvider: dto.gitProvider,
          installCommand: dto.installCommand,
          buildCommand: dto.buildCommand,
          startCommand: dto.startCommand,
          testCommand: dto.testCommand,
          healthCheckPath: dto.healthCheckPath,
          defaultPort: dto.defaultPort,
          createdBy: userId,
        },
      });

      // Create default environments
      await tx.environment.createMany({
        data: [
          { projectId: p.id, name: '测试环境', type: 'TEST', externalPort: 3001, deployMode: 'local' },
          { projectId: p.id, name: '预发环境', type: 'STAGING', externalPort: 3002, deployMode: 'local' },
          { projectId: p.id, name: '生产环境', type: 'PRODUCTION', externalPort: 3003, deployMode: 'local' },
        ],
      });

      // Create default component
      await tx.component.create({
        data: {
          projectId: p.id,
          name: dto.name,
          isDefault: true,
        },
      });

      return p;
    });

    return project;
  }

  async listByWorkspace(workspaceId: string) {
    return this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, workspaceId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('项目不存在');
    }
    return project;
  }

  async update(id: string, dto: CreateProjectDto, workspaceId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('项目不存在');
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.projectType !== undefined && { projectType: dto.projectType }),
        ...(dto.repositoryUrl !== undefined && { repositoryUrl: dto.repositoryUrl }),
        ...(dto.defaultBranch !== undefined && { defaultBranch: dto.defaultBranch }),
        ...(dto.gitProvider !== undefined && { gitProvider: dto.gitProvider }),
        ...(dto.installCommand !== undefined && { installCommand: dto.installCommand }),
        ...(dto.buildCommand !== undefined && { buildCommand: dto.buildCommand }),
        ...(dto.startCommand !== undefined && { startCommand: dto.startCommand }),
        ...(dto.testCommand !== undefined && { testCommand: dto.testCommand }),
        ...(dto.healthCheckPath !== undefined && { healthCheckPath: dto.healthCheckPath }),
        ...(dto.defaultPort !== undefined && { defaultPort: dto.defaultPort }),
      },
    });
  }
}
