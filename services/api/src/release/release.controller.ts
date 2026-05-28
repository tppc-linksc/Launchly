import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects/:projectId/releases')
export class ReleaseController {
  constructor(private readonly releaseService: ReleaseService) {}

  @Roles('DEVELOPER')
  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    return this.releaseService.createRelease(projectId, body, user.userId);
  }

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.releaseService.listReleases(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.releaseService.getRelease(id);
  }

  @Get(':id/gates')
  async gates(@Param('id') id: string) {
    return this.releaseService.getGateStatus(id);
  }

  @Roles('ADMIN')
  @Put(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.releaseService.publish(id, user.userId);
  }

  @Roles('ADMIN')
  @Post(':id/gates/:gateName/exempt')
  async exempt(
    @Param('id') id: string,
    @Param('gateName') gateName: string,
    @Body() body: any,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.releaseService.exemptGate(id, gateName, body, user.userId);
  }

  @Get(':id/exemptions')
  async exemptions(@Param('id') id: string) {
    return this.releaseService.getExemptions(id);
  }
}
