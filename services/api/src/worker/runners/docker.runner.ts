import { Injectable } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';

/**
 * Deliberately disabled legacy runner. A control-plane Worker must never obtain a
 * host Docker socket; builds belong to the isolated BuildKit executor and runtime
 * deployment belongs to a BYOS Agent or the hardened SSH runner.
 */
@Injectable()
export class DockerRunner {
  async execute(_ctx: RunnerContext): Promise<RunnerResult> {
    return {
      success: false,
      stdout: '',
      stderr: 'Legacy local Docker Runner is disabled. Bind a verified BYOS target instead.',
      exitCode: -1,
      errorMessage: 'Local Docker Runner is disabled by the control-plane isolation policy',
    };
  }
}
