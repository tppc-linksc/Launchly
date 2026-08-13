import { Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EnvironmentService } from './environment.service';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';

@Controller('environments')
export class EnvironmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environmentService: EnvironmentService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Get()
  async listByProject(@Query('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.prisma.environment.findMany({
      where: { projectId },
      orderBy: { type: 'asc' },
    });
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateEnvironmentDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireEnvironment(id, user.userId, user.workspaceId!, 'DEVELOPER');

    return this.environmentService.update(id, body, user.workspaceId!);
  }
}
