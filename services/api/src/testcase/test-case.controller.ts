import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { TestService } from './test.service';
import { TestCaseRequestDto } from './dto';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects/:projectId/test-cases')
export class TestCaseController {
  constructor(private readonly testService: TestService) {}

  @Post()
  @Roles('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')
  async create(@Param('projectId') projectId: string, @Body() dto: TestCaseRequestDto) {
    return this.testService.createTestCase(projectId, dto);
  }

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.testService.listTestCases(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.testService.getTestCase(id);
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')
  async update(@Param('id') id: string, @Body() dto: TestCaseRequestDto) {
    return this.testService.updateTestCase(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')
  async delete(@Param('id') id: string) {
    await this.testService.deleteTestCase(id);
  }
}
