import { Module } from '@nestjs/common';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';
import { GateCheckService } from './gate-check.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [ReleaseController],
  providers: [ReleaseService, GateCheckService],
})
export class ReleaseModule {}
