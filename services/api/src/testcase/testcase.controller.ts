import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TestService } from './test.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';
import { TestCaseRequestDto } from './dto';

@Controller('projects/:projectId/test-cases')
export class TestCaseController {
  constructor(
    private readonly testService: TestService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Roles('TESTER')
  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: TestCaseRequestDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'TESTER');
    return this.testService.createTestCase(projectId, body);
  }

  @Get()
  async list(@Param('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.testService.listTestCases(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestCase(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.testService.getTestCase(id);
  }

  @Roles('TESTER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestCase(id, user.userId, user.workspaceId!, 'TESTER');
    return this.testService.updateTestCase(id, body);
  }

  @Roles('TESTER')
  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestCase(id, user.userId, user.workspaceId!, 'TESTER');
    await this.testService.deleteTestCase(id);
    return { success: true };
  }
}
