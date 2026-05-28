import { Injectable, Logger } from '@nestjs/common';
import { execSync, spawn } from 'child_process';

const SENSITIVE_PATTERNS = [
  /password[:=]\s*[^\s]+/gi,
  /token[:=]\s*[^\s]+/gi,
  /secret[:=]\s*[^\s]+/gi,
  /key[:=]\s*[^\s]+/gi,
  /credential[:=]\s*[^\s]+/gi,
];

@Injectable()
export class CommandExecutor {
  private readonly logger = new Logger(CommandExecutor.name);

  async exec(command: string, options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const timeout = options.timeout || 300;
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

      proc.on('close', (code: number | null) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      proc.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  static sanitize(text: string): string {
    let sanitized = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }
}
