import { Controller, Get, Post, Patch, Delete, Param, Body, HttpStatus } from '@nestjs/common';
import { DeployTargetService } from './deploy-target.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';

@Controller()
export class DeployTargetController {
  constructor(private readonly service: DeployTargetService) {}

  @Get('deploy-targets')
  async listAll(@CurrentUser() user: AuthPrincipal) {
    return this.service.listAll(user.workspaceId!);
  }

  @Get('projects/:projectId/deploy-targets')
  async list(@Param('projectId') projectId: string) {
    return this.service.listByProject(projectId);
  }

  @Roles('DEVELOPER')
  @Post('projects/:projectId/deploy-targets')
  async create(@Param('projectId') projectId: string, @Body() body: any) {
    return this.service.create(projectId, body);
  }

  @Get('deploy-targets/:id')
  async get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Roles('DEVELOPER')
  @Patch('deploy-targets/:id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Roles('ADMIN')
  @Delete('deploy-targets/:id')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true };
  }

  @Roles('DEVELOPER')
  @Post('deploy-targets/:id/verify')
  async verify(@Param('id') id: string) {
    return this.service.verify(id);
  }
}
