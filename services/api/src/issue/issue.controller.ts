import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { IssueService } from './issue.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { ProjectResourceAccessPolicy } from '../common/access/project-resource-access-policy';
import { CreateIssueDto, UpdateIssueDto, IssueTransitionDto } from './dto';

@Controller('projects/:projectId/issues')
export class IssueController {
  constructor(
    private readonly issueService: IssueService,
    private readonly accessPolicy: ProjectResourceAccessPolicy,
  ) {}

  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: CreateIssueDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'TESTER');
    return this.issueService.createIssue(projectId, body, user.userId);
  }

  @Post('from-failed-test')
  async createFromFailedTest(
    @Param('projectId') projectId: string,
    @Query('testRunCaseId') testRunCaseId: string,
    @Query('deploymentId') deploymentId: string,
    @Query('testCaseTitle') testCaseTitle: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.accessPolicy.requireProject(projectId, user.userId, user.workspaceId!, 'TESTER');
    return this.issueService.createFromFailedTest(testRunCaseId, projectId, deploymentId, testCaseTitle || null, user.userId);
  }

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assigneeId') assigneeId?: string,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    await this.accessPolicy.requireProject(projectId, user!.userId, user!.workspaceId!, 'VIEWER');
    return this.issueService.listIssues(projectId, status, priority, assigneeId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireIssue(id, user.userId, user.workspaceId!, 'VIEWER');
    return this.issueService.getIssue(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateIssueDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireIssue(id, user.userId, user.workspaceId!, 'DEVELOPER');
    return this.issueService.updateIssue(id, body);
  }

  @Put(':id/status')
  async transition(@Param('id') id: string, @Body() body: IssueTransitionDto, @CurrentUser() user: AuthPrincipal) {
    await this.accessPolicy.requireIssue(id, user.userId, user.workspaceId!, 'TESTER');
    return this.issueService.transition(id, body, user.userId);
  }
}
