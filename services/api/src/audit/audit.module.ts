import { Module } from '@nestjs/common';
import { AuditLogController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
