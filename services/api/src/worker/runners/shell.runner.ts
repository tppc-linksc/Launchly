import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { assertSafeRefId } from './ref-id-safety';
import * as path from 'path';

/**
 * Shell 通用 Runner（KI-038 / KI-039 / R0-08）。
 *
 * 关键约束：
 * - refId 走 assertSafeRefId（KI-032），防止路径穿越。
 * - 健康检查改用 execFile('curl', [...args])，绝不走 bash -c 拼接（KI-038）：
 *   - host 必须是合法 hostname / IPv4 / IPv6 字面量；
 *   - port 必须是 1-65535 整数；
 *   - healthPath 必须以 / 开头且不含 shell 元字符。
 * - 健康响应判断：必须 HTTP 状态码 2xx 才算通过；非数字/0/字符串都失败（KI-039）。
 * - 最后一次失败不再等待 5 秒。
 */

const BUILD_ROOT = '/tmp/launchly-builds';
const SAFE_HOST = /^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])$/;
const SAFE_HEALTH_PATH = /^\/[A-Za-z0-9._\-\/]*$/;

@Injectable()
export class ShellRunner {
  private readonly logger = new Logger(ShellRunner.name);

  constructor(private readonly executor: CommandExecutor) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    try {
      assertSafeRefId(ctx.refId, 'refId');
    } catch (e: any) {
      return this.failure(e?.message || 'Invalid refId');
    }

    const workDir = path.join(BUILD_ROOT, `work-${ctx.refId}`);

    if (ctx.taskType === 'HEALTH_CHECK') {
      const host = typeof ctx.payload.host === 'string' && ctx.payload.host ? ctx.payload.host : 'localhost';
      const healthPort = Number(ctx.payload.healthPort ?? ctx.payload.port ?? 3000);
      return this.executeHealthCheck(ctx, host, healthPort);
    }

    const commands: string[] = [];
    if (typeof ctx.payload.installCommand === 'string') commands.push(ctx.payload.installCommand);
    if (typeof ctx.payload.buildCommand === 'string') commands.push(ctx.payload.buildCommand);

    if (commands.length === 0) {
      return { success: true, stdout: '未配置构建命令，跳过', stderr: '', exitCode: 0, errorMessage: '' };
    }

    const fullCommand = commands.join(' && ');
    // KI-028: stageLog 记录命令摘要，不写完整 payload（避免 secret 泄露）。
    await ctx.stageLogCallback?.('RUNNING', `Executing build pipeline (${commands.length} step${commands.length > 1 ? 's' : ''})`);

    const result = await this.executor.exec(fullCommand, { cwd: workDir, timeout: 1200 });
    return {
      success: result.exitCode === 0,
      stdout: CommandExecutor.sanitize(result.stdout),
      stderr: CommandExecutor.sanitize(result.stderr),
      exitCode: result.exitCode,
      errorMessage: result.exitCode !== 0 ? '构建失败' : '',
    };
  }

  /** KI-038 / KI-039: 健康检查走结构化 execFile，不入 shell；状态码必须 2xx。 */
  private async executeHealthCheck(ctx: RunnerContext, host: string, port: number): Promise<RunnerResult> {
    if (!SAFE_HOST.test(host)) {
      return this.failure(`Health check host 非法: ${host}`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return this.failure(`Health check port 非法: ${port}`);
    }
    const rawPath = typeof ctx.payload.healthCheckPath === 'string' && ctx.payload.healthCheckPath ? ctx.payload.healthCheckPath : '/';
    if (!SAFE_HEALTH_PATH.test(rawPath)) {
      return this.failure(`Health check path 非法: ${rawPath}`);
    }
    const url = `http://${host}:${port}${rawPath}`;
    await ctx.stageLogCallback?.('RUNNING', `健康检查: ${url}`);

    const MAX_ATTEMPTS = 10;
    let lastStatus = -1;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const result = await this.executor.execFile('curl', ['-sf', '-o', '/dev/null', '-w', '%{http_code}', url], { timeout: 30 });
        // KI-039: 必须有完整三位数字状态码且 exitCode=0 才算成功。
        const statusText = result.stdout.trim();
        const statusCode = /^\d{3}$/.test(statusText) ? Number(statusText) : Number.NaN;
        lastStatus = statusCode;
        if (result.exitCode === 0 && Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300) {
          return { success: true, stdout: `健康检查通过 (${statusCode})`, stderr: '', exitCode: 0, errorMessage: '' };
        }
      } catch {
        // 单次失败继续重试
      }
      if (i < MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    return {
      success: false,
      stdout: '',
      stderr: `健康检查 ${MAX_ATTEMPTS} 次均失败（最后状态码=${lastStatus}）`,
      exitCode: 1,
      errorMessage: '健康检查失败',
    };
  }

  private failure(message: string): RunnerResult {
    return { success: false, stdout: '', stderr: CommandExecutor.sanitize(message), exitCode: -1, errorMessage: message };
  }
}
