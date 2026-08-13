import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { TestService } from './test.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';

@Controller()
export class TestRunController {
  constructor(
    private readonly testService: TestService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Roles('TESTER')
  @Post('deployments/:deploymentId/test-runs')
  async create(
    @Param('deploymentId') deploymentId: string,
    @Query('projectId') projectId: string,
    @Query('environmentId') environmentId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'TESTER');
    return this.testService.createTestRun(deploymentId, projectId, environmentId || '', user.userId);
  }

  @Get('test-runs/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestRun(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.testService.getTestRun(id);
  }

  @Get('test-runs')
  async list(@Query('projectId') projectId: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'VIEWER');
    return this.testService.listTestRuns(projectId);
  }

  @Get('test-runs/:id/cases')
  async cases(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireTestRun(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.testService.getTestRunCases(id);
  }

  @Roles('TESTER')
  @Put('test-runs/:testRunId/cases/:caseId')
  async updateCase(
    @Param('testRunId') testRunId: string,
    @Param('caseId') caseId: string,
    @Body() body: any,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireTestRun(testRunId, user.userId, user.workspaceId!, 'TESTER');
    return this.testService.updateTestRunCase(testRunId, caseId, body, user.userId);
  }
}
