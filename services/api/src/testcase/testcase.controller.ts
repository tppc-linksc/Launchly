import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TestService } from './test.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects/:projectId/test-cases')
export class TestCaseController {
  constructor(private readonly testService: TestService) {}

  @Roles('TESTER')
  @Post()
  async create(@Param('projectId') projectId: string, @Body() body: any) {
    return this.testService.createTestCase(projectId, body);
  }

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.testService.listTestCases(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.testService.getTestCase(id);
  }

  @Roles('TESTER')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.testService.updateTestCase(id, body);
  }

  @Roles('TESTER')
  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.testService.deleteTestCase(id);
    return { success: true };
  }
}
