import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { EnvironmentVariableService } from './environment-variable.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';

@Controller('environments/:environmentId/variables')
export class EnvironmentVariableController {
  constructor(
    private readonly variableService: EnvironmentVariableService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Get()
  async list(@Param('environmentId') environmentId: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireEnvironment(environmentId, user.userId, user.workspaceId!, 'VIEWER');
    return this.variableService.listByEnvironment(environmentId);
  }

  @Roles('DEVELOPER')
  @Post()
  async create(
    @Param('environmentId') environmentId: string,
    @Body() body: { key: string; value: string; sensitive?: boolean; description?: string },
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireEnvironment(environmentId, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.variableService.create(environmentId, body, user.userId, user.workspaceId!);
  }

  @Roles('DEVELOPER')
  @Delete(':variableId')
  async delete(
    @Param('environmentId') _: string,
    @Param('variableId') variableId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireEnvironmentVariable(variableId, user.userId, user.workspaceId!, 'DEVELOPER');
    await this.variableService.delete(variableId, user.userId, user.workspaceId!);
    return { success: true };
  }
}
