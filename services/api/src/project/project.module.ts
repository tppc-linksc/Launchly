import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ComponentController } from './component.controller';
import { ProjectService } from './project.service';

@Module({
  controllers: [ProjectController, ComponentController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
