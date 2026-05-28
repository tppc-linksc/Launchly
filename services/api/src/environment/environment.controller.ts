import { Controller, Get, Put, Param, Body, Query, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('environments')
export class EnvironmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listByProject(@Query('projectId') projectId: string) {
    return this.prisma.environment.findMany({
      where: { projectId },
      orderBy: { type: 'asc' },
    });
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env) throw new ForbiddenException('环境不存在');

    // Verify workspace ownership
    const project = await this.prisma.project.findUnique({ where: { id: env.projectId } });
    if (!project || project.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('无权更新此环境');
    }

    return this.prisma.environment.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.url !== undefined && { url: body.url }),
        ...(body.deployMode !== undefined && { deployMode: body.deployMode }),
        ...(body.host !== undefined && { host: body.host }),
        ...(body.sshUser !== undefined && { sshUser: body.sshUser }),
        ...(body.deployDir !== undefined && { deployDir: body.deployDir }),
        ...(body.localWorkRoot !== undefined && { localWorkRoot: body.localWorkRoot }),
        ...(body.externalPort !== undefined && { externalPort: body.externalPort }),
        ...(body.dataStrategy !== undefined && { dataStrategy: body.dataStrategy }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
    });
  }
}
