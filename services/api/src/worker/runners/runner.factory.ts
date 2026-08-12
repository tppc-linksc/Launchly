import { Injectable, Logger } from '@nestjs/common';
import { GitRunner } from './git.runner';
import { ShellRunner } from './shell.runner';
import { DockerRunner } from './docker.runner';
import { RemoteSshRunner } from './remote-ssh.runner';
import { BuildkitRunner } from './buildkit.runner';
import { OciImageRunner } from './oci-image.runner';
import { TemplateSourceRunner } from './template-source.runner';

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
    private readonly buildkitRunner: BuildkitRunner,
    private readonly ociImageRunner: OciImageRunner,
    private readonly templateSourceRunner: TemplateSourceRunner,
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
      case 'PROJECT_BUILD': return this.buildkitRunner;
      case 'PROJECT_IMAGE_PREPARE': return this.ociImageRunner;
      case 'TEMPLATE_SOURCE': return this.templateSourceRunner;
      case 'PROJECT_DEPLOY':
      case 'PROJECT_BOOTSTRAP':
        if (context.payload.deployTargetId) return this.remoteSshRunner;
        return null;
      case 'ROLLBACK_DEPLOY':
        return this.remoteSshRunner;
      case 'HEALTH_CHECK': return this.shellRunner;
      default: return null;
    }
  }
}
