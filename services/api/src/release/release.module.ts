import { Module } from '@nestjs/common';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';
import { GateCheckService } from './gate-check.service';

@Module({
  controllers: [ReleaseController],
  providers: [ReleaseService, GateCheckService],
})
export class ReleaseModule {}
