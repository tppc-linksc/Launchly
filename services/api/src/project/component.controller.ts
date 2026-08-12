import { Controller, Get, Post, Put, Delete, Param, Body, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectAccessService } from './project-access.service';

@Controller('projects/:projectId/components')
export class ComponentController {
  constructor(private readonly prisma: PrismaService, private readonly access: ProjectAccessService) {}

  @Get()
  async list(@Param('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.prisma.component.findMany({ where: { projectId } });
  }

  @Roles('DEVELOPER')
  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'DEVELOPER');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    return this.prisma.component.create({
      data: {
        projectId,
        name: body.name || 'component',
        description: body.description,
        repositoryUrl: body.repositoryUrl,
        buildCommand: body.buildCommand,
        startCommand: body.startCommand,
        healthCheckPath: body.healthCheckPath,
        defaultPort: body.defaultPort,
        isDefault: false,
      },
    });
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('projectId') projectId: string, @Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'DEVELOPER');
    const component = await this.prisma.component.findFirst({ where: { id, projectId } });
    if (!component) throw new NotFoundException('组件不存在');

    return this.prisma.component.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.repositoryUrl !== undefined && { repositoryUrl: body.repositoryUrl }),
        ...(body.buildCommand !== undefined && { buildCommand: body.buildCommand }),
        ...(body.startCommand !== undefined && { startCommand: body.startCommand }),
        ...(body.healthCheckPath !== undefined && { healthCheckPath: body.healthCheckPath }),
        ...(body.defaultPort !== undefined && { defaultPort: body.defaultPort }),
      },
    });
  }

  @Roles('ADMIN')
  @Delete(':id')
  async delete(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'ADMIN');
    const component = await this.prisma.component.findFirst({ where: { id, projectId } });
    if (!component) throw new NotFoundException('组件不存在');
    if (component.isDefault) throw new ConflictException('不能删除默认组件');

    await this.prisma.component.delete({ where: { id } });
    return { success: true };
  }
}
