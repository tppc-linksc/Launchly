import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { DeployTargetService } from './target.service';
import { CreateDeployTargetDto, UpdateDeployTargetDto } from './dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller()
export class DeployTargetController {
  constructor(private readonly deployTargetService: DeployTargetService) {}

  @Get('projects/:projectId/deploy-targets')
  async list(@Param('projectId') projectId: string) {
    return this.deployTargetService.listByProject(projectId);
  }

  @Post('projects/:projectId/deploy-targets')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER')
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDeployTargetDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.deployTargetService.create(projectId, dto, user.workspaceId!);
  }

  @Get('deploy-targets/:id')
  async get(@Param('id') id: string) {
    return this.deployTargetService.getById(id);
  }

  @Patch('deploy-targets/:id')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER')
  async update(@Param('id') id: string, @Body() dto: UpdateDeployTargetDto) {
    return this.deployTargetService.update(id, dto);
  }

  @Delete('deploy-targets/:id')
  @Roles('OWNER', 'ADMIN')
  async delete(@Param('id') id: string) {
    await this.deployTargetService.delete(id);
  }

  @Post('deploy-targets/:id/verify')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER')
  async verify(@Param('id') id: string) {
    return this.deployTargetService.verify(id);
  }
}
