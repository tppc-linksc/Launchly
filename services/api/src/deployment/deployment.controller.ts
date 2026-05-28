import { Controller, Get, Post, Param, Body, Query, Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, switchMap, takeWhile, map } from 'rxjs';
import { DeploymentService } from './deployment.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

@Controller('deployments')
export class DeploymentController {
  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('DEVELOPER')
  @Post()
  async create(@Body() dto: CreateDeploymentDto, @CurrentUser() user: AuthPrincipal) {
    return this.deploymentService.create(dto, user.userId, user.workspaceId!);
  }

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('environmentId') environmentId?: string,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    if (environmentId) return this.deploymentService.listByEnvironment(environmentId);
    if (projectId) return this.deploymentService.listByProject(projectId);
    return this.deploymentService.listForWorkspace(user!.workspaceId!);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.deploymentService.getById(id);
  }

  @Get(':id/logs')
  async logs(@Param('id') id: string) {
    return this.deploymentService.getLogs(id);
  }

  @Sse(':id/logs/stream')
  streamLogs(@Param('id') id: string): Observable<MessageEvent> {
    return interval(2000).pipe(
      switchMap(async () => {
        const deployment = await this.prisma.deployment.findUnique({ where: { id } });
        const logs = await this.prisma.deploymentStageLog.findMany({
          where: { deploymentId: id },
          orderBy: { stepOrder: 'asc' },
        });
        return { deployment, logs };
      }),
      takeWhile(({ deployment }) => {
        if (!deployment) return false;
        return !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(deployment.status);
      }, true),
      map(({ deployment, logs }) => ({
        data: JSON.stringify({
          logs,
          status: deployment?.status,
          errorMessage: deployment?.errorMessage,
        }),
        type: 'logs',
      })),
    );
  }

  @Roles('DEVELOPER')
  @Post(':id/rollback')
  async rollback(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.deploymentService.rollback(id, user.userId, user.workspaceId!);
  }
}
