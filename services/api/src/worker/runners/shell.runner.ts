import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import * as path from 'path';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class ShellRunner {
  private readonly logger = new Logger(ShellRunner.name);

  constructor(private readonly executor: CommandExecutor) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const workDir = path.join(BUILD_ROOT, ctx.refId);
    const { installCommand, buildCommand, startCommand, testCommand, healthCheckPath, host, port = 3000 } = ctx.payload;

    // Health check mode
    if (ctx.taskType === 'HEALTH_CHECK') {
      return this.executeHealthCheck(ctx, host || 'localhost', port);
    }

    // Build mode
    const commands: string[] = [];
    if (installCommand) commands.push(installCommand);
    if (buildCommand) commands.push(buildCommand);

    if (commands.length === 0) {
      return { success: true, stdout: 'No build commands configured', stderr: '', exitCode: 0, errorMessage: '' };
    }

    const fullCommand = commands.join(' && ');
    await ctx.stageLogCallback?.('RUNNING', `Executing: ${fullCommand}`);

    const result = await this.executor.exec(fullCommand, {
      cwd: workDir,
      timeout: 1200,
    });

    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      errorMessage: result.exitCode !== 0 ? 'Build failed' : '',
    };
  }

  private async executeHealthCheck(ctx: RunnerContext, host: string, port: number): Promise<RunnerResult> {
    const healthPath = ctx.payload.healthCheckPath || '/';
    const url = `http://${host}:${port}${healthPath}`;

    await ctx.stageLogCallback?.('RUNNING', `Health check: ${url}`);

    for (let i = 0; i < 10; i++) {
      try {
        const result = await this.executor.exec(`curl -sf -o /dev/null -w "%{http_code}" "${url}"`, { timeout: 30 });
        const statusCode = parseInt(result.stdout.trim());
        if (statusCode >= 200 && statusCode < 400) {
          return { success: true, stdout: `Health check passed (${statusCode})`, stderr: '', exitCode: 0, errorMessage: '' };
        }
      } catch {}
      await new Promise(r => setTimeout(r, 5000));
    }

    return { success: false, stdout: '', stderr: 'Health check failed after 10 attempts', exitCode: 1, errorMessage: 'Health check failed' };
  }
}
