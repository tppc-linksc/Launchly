import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResourceCatalogService } from './resource-catalog.service';
import { ProjectAccessService } from './project-access.service';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly catalog: ResourceCatalogService,
    private readonly access: ProjectAccessService,
  ) {}

  @Roles('DEVELOPER')
  @Post()
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthPrincipal) {
    return this.projectService.create(dto, user.workspaceId!, user.userId);
  }

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    return this.projectService.listByWorkspace(user.workspaceId!, user.userId);
  }

  @Get('catalog')
  catalogItems() {
    return this.catalog.list();
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.projectService.getById(id, user.workspaceId!);
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: CreateProjectDto, @CurrentUser() user: AuthPrincipal) {
    await this.access.require(id, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.projectService.update(id, dto, user.workspaceId!);
  }
}
