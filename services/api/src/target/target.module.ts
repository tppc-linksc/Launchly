import { Module } from '@nestjs/common';
import { DeployTargetController } from './deploy-target.controller';
import { DeployTargetService } from './deploy-target.service';
import { EnvironmentModule } from '../environment/environment.module';

@Module({
  imports: [EnvironmentModule],
  controllers: [DeployTargetController],
  providers: [DeployTargetService],
})
export class TargetModule {}
