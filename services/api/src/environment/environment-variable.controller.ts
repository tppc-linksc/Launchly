import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { EnvironmentVariableService } from './environment-variable.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';
import { CreateEnvironmentVariableDto } from './dto/create-environment-variable.dto';
import { UpdateEnvironmentVariableDto } from './dto/update-environment-variable.dto';

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

  @Put(':variableId')
  async update(
    @Param('variableId') variableId: string,
    @Body() body: UpdateEnvironmentVariableDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireEnvironmentVariable(variableId, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.variableService.update(variableId, body, user.workspaceId!);
  }

  @Post()
  async create(
    @Param('environmentId') environmentId: string,
    @Body() body: CreateEnvironmentVariableDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireEnvironment(environmentId, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.variableService.create(environmentId, body, user.userId, user.workspaceId!);
  }

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
