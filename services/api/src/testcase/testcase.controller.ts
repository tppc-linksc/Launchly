import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TestService } from './test.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';
import { TestCaseRequestDto, UpdateTestCaseDto } from './dto';

/**
 * 测试用例 Controller（KI-005 / R0-05）。
 *
 * 所有写入接口均使用 class-validator DTO；URL 子资源 ID 走
 * ProjectResourceAccessPolicy 反查归属，避免跨项目写入。
 */
@Controller('projects/:projectId/test-cases')
export class TestCaseController {
  constructor(
    private readonly testService: TestService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: TestCaseRequestDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
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

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateTestCaseDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestCase(id, user.userId, user.workspaceId!, 'TESTER');
    return this.testService.updateTestCase(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestCase(id, user.userId, user.workspaceId!, 'TESTER');
    await this.testService.deleteTestCase(id);
    return { success: true };
  }
}
