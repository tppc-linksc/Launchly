import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { TestService } from './test.service';
import { UpdateTestRunCaseDto } from './dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller()
export class TestRunController {
  constructor(private readonly testService: TestService) {}

  @Post('deployments/:deploymentId/test-runs')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')
  async create(
    @Param('deploymentId') deploymentId: string,
    @Query('projectId') projectId: string,
    @Query('environmentId') environmentId: string | undefined,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.testService.createTestRun(deploymentId, projectId, environmentId || '', user.userId);
  }

  @Get('test-runs')
  async list(@Query('projectId') projectId: string) {
    return this.testService.listTestRuns(projectId);
  }

  @Get('test-runs/:id')
  async get(@Param('id') id: string) {
    return this.testService.getTestRun(id);
  }

  @Get('test-runs/:id/cases')
  async cases(@Param('id') id: string) {
    return this.testService.getTestRunCases(id);
  }

  @Put('test-runs/:testRunId/cases/:caseId')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')
  async updateCase(
    @Param('testRunId') testRunId: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateTestRunCaseDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.testService.updateTestRunCase(testRunId, caseId, dto, user.userId);
  }
}
