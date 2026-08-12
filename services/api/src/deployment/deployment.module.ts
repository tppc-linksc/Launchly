import { Module } from '@nestjs/common';
import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
