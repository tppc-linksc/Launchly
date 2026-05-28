import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ProjectModule } from './project/project.module';
import { EnvironmentModule } from './environment/environment.module';
import { DeploymentModule } from './deployment/deployment.module';
import { TargetModule } from './target/target.module';
import { TestCaseModule } from './testcase/testcase.module';
import { IssueModule } from './issue/issue.module';
import { ReleaseModule } from './release/release.module';
import { NotificationModule } from './notification/notification.module';
import { AuditModule } from './audit/audit.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    AuthModule,
    WorkspaceModule,
    ProjectModule,
    EnvironmentModule,
    DeploymentModule,
    TargetModule,
    TestCaseModule,
    IssueModule,
    ReleaseModule,
    NotificationModule,
    AuditModule,
    WorkerModule,
  ],
})
export class AppModule {}
