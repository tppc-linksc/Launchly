import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ComponentController } from './component.controller';
import { ProjectService } from './project.service';
import { ProjectAccessService } from './project-access.service';
import { ResourceCatalogService } from './resource-catalog.service';
import { EnvironmentModule } from '../environment/environment.module';

@Module({
  imports: [EnvironmentModule],
  controllers: [ProjectController, ComponentController],
  providers: [ProjectService, ProjectAccessService, ResourceCatalogService],
  exports: [ProjectService, ProjectAccessService],
})
export class ProjectModule {}
