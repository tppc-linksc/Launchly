import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { GitRunner } from './runners/git.runner';
import { ShellRunner } from './runners/shell.runner';
import { DockerRunner } from './runners/docker.runner';
import { RemoteSshRunner } from './runners/remote-ssh.runner';
import { RunnerFactory } from './runners/runner.factory';
import { CommandExecutor } from './runners/command.executor';
import { BuildCleanupService } from './cleanup/build-cleanup.service';
import { EnvironmentModule } from '../environment/environment.module';

@Module({
  imports: [EnvironmentModule],
  providers: [
    WorkerService,
    GitRunner,
    ShellRunner,
    DockerRunner,
    RemoteSshRunner,
    RunnerFactory,
    CommandExecutor,
    BuildCleanupService,
  ],
})
export class WorkerModule {}
