import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Roles('DEVELOPER')
  @Post()
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthPrincipal) {
    return this.projectService.create(dto, user.workspaceId!, user.userId);
  }

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    return this.projectService.listByWorkspace(user.workspaceId!);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.projectService.getById(id, user.workspaceId!);
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: CreateProjectDto, @CurrentUser() user: AuthPrincipal) {
    return this.projectService.update(id, dto, user.workspaceId!);
  }
}
