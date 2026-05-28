import { Module } from '@nestjs/common';
import { TestCaseController } from './testcase.controller';
import { TestRunController } from './testrun.controller';
import { TestService } from './test.service';

@Module({
  controllers: [TestCaseController, TestRunController],
  providers: [TestService],
})
export class TestCaseModule {}
