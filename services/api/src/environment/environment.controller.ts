import { Controller, Get, Put, Param, Body, Query, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EnvironmentService } from './environment.service';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('environments')
export class EnvironmentController {
  constructor(private readonly prisma: PrismaService, private readonly environmentService: EnvironmentService) {}

  @Get()
  async listByProject(@Query('projectId') projectId: string) {
    return this.prisma.environment.findMany({
      where: { projectId },
      orderBy: { type: 'asc' },
    });
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateEnvironmentDto, @CurrentUser() user: AuthPrincipal) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env) throw new ForbiddenException('环境不存在');

    // Verify workspace ownership
    const project = await this.prisma.project.findUnique({ where: { id: env.projectId } });
    if (!project || project.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('无权更新此环境');
    }

    return this.environmentService.update(id, body, user.workspaceId!);
  }
}
