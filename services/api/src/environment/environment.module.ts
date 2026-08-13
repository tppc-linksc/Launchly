import { Module } from '@nestjs/common';
import { EnvironmentController } from './environment.controller';
import { EnvironmentVariableController } from './environment-variable.controller';
import { EnvironmentService } from './environment.service';
import { EnvironmentVariableService } from './environment-variable.service';
import { SecretValueService } from './secret-value.service';

@Module({
  controllers: [EnvironmentController, EnvironmentVariableController],
  providers: [EnvironmentService, EnvironmentVariableService, SecretValueService],
  exports: [SecretValueService],
})
export class EnvironmentModule {}
