import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { IssueService } from './issue.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects/:projectId/issues')
export class IssueController {
  constructor(private readonly issueService: IssueService) {}

  @Roles('TESTER')
  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal) {
    return this.issueService.createIssue(projectId, body, user.userId);
  }

  @Roles('TESTER')
  @Post('from-failed-test')
  async createFromFailedTest(
    @Param('projectId') projectId: string,
    @Query('testRunCaseId') testRunCaseId: string,
    @Query('deploymentId') deploymentId: string,
    @Query('testCaseTitle') testCaseTitle: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.issueService.createFromFailedTest(testRunCaseId, projectId, deploymentId, testCaseTitle || null, user.userId);
  }

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    return this.issueService.listIssues(projectId, status, priority, assigneeId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.issueService.getIssue(id);
  }

  @Roles('DEVELOPER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.issueService.updateIssue(id, body);
  }

  @Roles('TESTER')
  @Put(':id/status')
  async transition(@Param('id') id: string, @Body() body: { toStatus: string }, @CurrentUser() user: AuthPrincipal) {
    return this.issueService.transition(id, body, user.userId);
  }
}
