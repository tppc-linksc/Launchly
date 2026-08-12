import { Controller, Get, Post, Patch, Delete, Param, Body, ForbiddenException } from '@nestjs/common';
import { DeployTargetService } from './deploy-target.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateDeployTargetDto } from './dto/create-deploy-target.dto';
import { UpdateDeployTargetDto } from './dto/update-deploy-target.dto';

@Controller()
export class DeployTargetController {
  constructor(private readonly service: DeployTargetService, private readonly prisma: PrismaService) {}

  private async requireProject(projectId: string, workspaceId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) throw new ForbiddenException('无权访问部署目标');
  }

  private async requireTarget(id: string, workspaceId: string) {
    const target = await this.prisma.deployTarget.findFirst({ where: { id, project: { workspaceId } } });
    if (!target) throw new ForbiddenException('无权访问部署目标');
  }

  @Get('deploy-targets')
  async listAll(@CurrentUser() user: AuthPrincipal) {
    return this.service.listAll(user.workspaceId!);
  }

  @Get('projects/:projectId/deploy-targets')
  async list(@Param('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.requireProject(projectId, user.workspaceId!);
    return this.service.listByProject(projectId);
  }

  @Roles('DEVELOPER')
  @Post('projects/:projectId/deploy-targets')
  async create(@Param('projectId') projectId: string, @Body() body: CreateDeployTargetDto, @CurrentUser() user: AuthPrincipal) {
    await this.requireProject(projectId, user.workspaceId!);
    return this.service.create(projectId, { ...body, credential: body.privateKey });
  }

  @Get('deploy-targets/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.requireTarget(id, user.workspaceId!);
    return this.service.getById(id);
  }

  @Roles('DEVELOPER')
  @Patch('deploy-targets/:id')
  async update(@Param('id') id: string, @Body() body: UpdateDeployTargetDto, @CurrentUser() user: AuthPrincipal) {
    await this.requireTarget(id, user.workspaceId!);
    return this.service.update(id, { ...body, credential: body.privateKey });
  }

  @Roles('ADMIN')
  @Delete('deploy-targets/:id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.requireTarget(id, user.workspaceId!);
    await this.service.delete(id);
    return { success: true };
  }

  @Roles('DEVELOPER')
  @Post('deploy-targets/:id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.requireTarget(id, user.workspaceId!);
    return this.service.verify(id);
  }
}
