import { Injectable, Logger } from '@nestjs/common';
import { GitRunner } from './git.runner';
import { ShellRunner } from './shell.runner';
import { DockerRunner } from './docker.runner';
import { RemoteSshRunner } from './remote-ssh.runner';

export interface RunnerContext {
  taskType: string;
  refId: string;
  payload: Record<string, any>;
  stageLogCallback?: (status: string, logText: string) => Promise<void>;
}

export interface RunnerResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  errorMessage: string;
}

@Injectable()
export class RunnerFactory {
  private readonly logger = new Logger(RunnerFactory.name);

  constructor(
    private readonly gitRunner: GitRunner,
    private readonly shellRunner: ShellRunner,
    private readonly dockerRunner: DockerRunner,
    private readonly remoteSshRunner: RemoteSshRunner,
  ) {}

  async execute(taskType: string, context: RunnerContext): Promise<RunnerResult> {
    const runner = this.getRunner(taskType, context);
    if (!runner) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, errorMessage: `Unknown task type: ${taskType}` };
    }
    return runner.execute(context);
  }

  private getRunner(taskType: string, context: RunnerContext): { execute: (ctx: RunnerContext) => Promise<RunnerResult> } | null {
    switch (taskType) {
      case 'REPO_CLONE': return this.gitRunner;
      case 'PROJECT_BUILD': return this.shellRunner;
      case 'PROJECT_DEPLOY':
        // Check if BYOS SSH deployment
        if (context.payload.deployTargetId) return this.remoteSshRunner;
        return this.dockerRunner;
      case 'HEALTH_CHECK': return this.shellRunner;
      default: return null;
    }
  }
}
