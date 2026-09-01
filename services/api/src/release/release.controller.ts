import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';
import { CreateReleaseDto } from './dto/create-release.dto';
import { ExemptGateDto } from './dto';

/**
 * 发布（Release）Controller。
 *
 * 关键点：
 * - 所有写入均使用 class-validator DTO（KI-005）。
 * - 子资源 ID 走统一 ProjectResourceAccessPolicy 反查归属（KI-004 / R0-04）。
 * - 豁免 Gate 必须提供 reason，写入审计（KI-020 修复要求）。
 */
@Controller('projects/:projectId/releases')
export class ReleaseController {
  constructor(
    private readonly releaseService: ReleaseService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateReleaseDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.releaseService.createRelease(projectId, body, user.userId);
  }

  @Get()
  async list(@Param('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.releaseService.listReleases(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.releaseService.getRelease(id);
  }

  @Get(':id/gates')
  async gates(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.releaseService.getGateStatus(id);
  }

  @Put(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'ADMIN');
    return this.releaseService.publish(id, user.userId);
  }

  @Post(':id/gates/:gateName/exempt')
  async exempt(
    @Param('id') id: string,
    @Param('gateName') gateName: string,
    @Body() body: ExemptGateDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'ADMIN');
    return this.releaseService.exemptGate(id, gateName, body, user.userId);
  }

  @Get(':id/exemptions')
  async exemptions(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.releaseService.getExemptions(id);
  }
}
