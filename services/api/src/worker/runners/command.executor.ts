import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { redact } from './secret-redactor';

/**
 * 子进程执行器（KI-028 / KI-038 / R0-08）。
 *
 * 关键约束：
 * - exec 走 bash -c，但仅用于内部受信任命令；外部参数必须走 execFile。
 * - execFile 不经过 shell，避免命令注入。
 * - sanitize 统一走 ./secret-redactor.redact，支持 JSON 结构。
 */

@Injectable()
export class CommandExecutor {
  private readonly logger = new Logger(CommandExecutor.name);

  /** 通过 bash -c 执行；只用于 Launchly 自身拼接的命令。 */
  async exec(
    command: string,
    options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const timeout = options.timeout ?? 300;
    const env = { ...process.env, ...options.env };
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: options.cwd,
        env,
        timeout: timeout * 1000,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('close', (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
      proc.on('error', reject);
    });
  }

  /** 不通过 shell，直接执行二进制并传入参数数组；推荐用于所有外部可控参数。 */
  async execFile(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const timeout = options.timeout ?? 300;
    const env = { ...process.env, ...options.env };
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd: options.cwd, env, timeout: timeout * 1000, shell: false });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('close', (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
      proc.on('error', reject);
    });
  }

  /**
   * 对文本做脱敏；CommandExecutor 自身不再持有正则，
   * 真实规则统一在 secret-redactor.ts。
   */
  static sanitize(text: string): string {
    return redact(text);
  }
}
