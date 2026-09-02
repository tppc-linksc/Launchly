import { Controller, Get, Post, Put, Delete, Param, Body, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectAccessService } from './project-access.service';
import { CreateComponentDto, UpdateComponentDto } from './dto';

/**
 * 项目内的组件（Service）CRUD 控制器。
 *
 * 关键点（KI-005 / R0-05）：
 * - 入参采用 class-validator DTO，全局 ValidationPipe 启用 whitelist + forbidNonWhitelisted，
 *   任意未声明字段、非法格式都会被拒绝。
 * - 写操作同时按 URL 的 projectId 与数据库真实 projectId 校验归属，避免跨项目更新。
 * - 列表/读取仍按项目主接口走 ProjectAccessService；ADMIN 才能删除；isDefault 字段不开放给
 *   普通接口直接修改。
 */
@Controller('projects/:projectId/components')
export class ComponentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(@Param('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.prisma.component.findMany({ where: { projectId } });
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateComponentDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'DEVELOPER');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    return this.prisma.component.create({
      data: {
        projectId,
        name: body.name,
        description: body.description,
        repositoryUrl: body.repositoryUrl,
        buildCommand: body.buildCommand,
        startCommand: body.startCommand,
        healthCheckPath: body.healthCheckPath,
        defaultPort: body.defaultPort,
        // KI-005: 不允许通过公开接口直接将组件设为默认；仅 Bootstrap 流程可修改。
        isDefault: false,
      },
    });
  }

  @Put(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: UpdateComponentDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.access.require(projectId, user.userId, user.workspaceId!, 'DEVELOPER');
    // KI-005: 用 URL projectId + 数据库真实 projectId 双重确认，避免跨项目更新。
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
