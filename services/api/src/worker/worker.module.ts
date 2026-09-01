import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { GitRunner } from './runners/git.runner';
import { ShellRunner } from './runners/shell.runner';
import { DockerRunner } from './runners/docker.runner';
import { RemoteSshRunner } from './runners/remote-ssh.runner';
import { RunnerFactory } from './runners/runner.factory';
import { CommandExecutor } from './runners/command.executor';
import { BuildCleanupService } from './cleanup/build-cleanup.service';
import { BuildkitRunner } from './runners/buildkit.runner';
import { OciImageRunner } from './runners/oci-image.runner';
import { TemplateSourceRunner } from './runners/template-source.runner';
import { EnvironmentModule } from '../environment/environment.module';
import { GitModule } from '../git/git.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [EnvironmentModule, GitModule, NotificationModule],
  providers: [
    WorkerService,
    GitRunner,
    ShellRunner,
    DockerRunner,
    BuildkitRunner,
    OciImageRunner,
    TemplateSourceRunner,
    RemoteSshRunner,
    RunnerFactory,
    CommandExecutor,
    BuildCleanupService,
  ],
})
export class WorkerModule {}
