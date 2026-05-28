import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import * as path from 'path';
import * as fs from 'fs';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class GitRunner {
  private readonly logger = new Logger(GitRunner.name);

  constructor(private readonly executor: CommandExecutor) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const { projectId, branch = 'main', commitSha } = ctx.payload;
    const repoUrl = ctx.payload.repositoryUrl || '';

    if (!repoUrl) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, errorMessage: 'No repository URL configured' };
    }

    const workDir = path.join(BUILD_ROOT, ctx.refId);

    try {
      // Clean and create work directory
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workDir, { recursive: true });

      // Clone
      await ctx.stageLogCallback?.('RUNNING', `Cloning ${repoUrl} (branch: ${branch})...`);
      const cloneResult = await this.executor.exec(
        `git clone --depth 1 --branch ${branch} ${repoUrl} .`,
        { cwd: workDir, timeout: 300 },
      );

      if (cloneResult.exitCode !== 0) {
        return { success: false, stdout: cloneResult.stdout, stderr: cloneResult.stderr, exitCode: cloneResult.exitCode, errorMessage: 'Git clone failed' };
      }

      // Checkout specific commit if provided
      if (commitSha) {
        const checkoutResult = await this.executor.exec(
          `git fetch --depth 1 origin ${commitSha} && git checkout ${commitSha}`,
          { cwd: workDir, timeout: 120 },
        );
        if (checkoutResult.exitCode !== 0) {
          this.logger.warn(`Failed to checkout ${commitSha}, using branch HEAD`);
        }
      }

      return { success: true, stdout: cloneResult.stdout, stderr: cloneResult.stderr, exitCode: 0, errorMessage: '' };
    } catch (e: any) {
      return { success: false, stdout: '', stderr: e.message, exitCode: -1, errorMessage: e.message };
    }
  }
}
