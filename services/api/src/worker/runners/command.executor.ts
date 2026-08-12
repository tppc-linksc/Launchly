import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

const SENSITIVE_PATTERNS = [
  /\b(?:password|token|secret|api[_-]?key|private[_-]?key|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
  /authorization\s*:\s*bearer\s+[^\s,}]+/gi,
  /gh[opsu]_[a-zA-Z0-9_]+/g,
  /postgres(?:ql)?:\/\/[^\s@]+:[^\s@]+@[^\s]+/gi,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
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

  /** Executes a binary without a shell. Use this for every value originating outside Launchly. */
  async execFile(command: string, args: string[], options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const timeout = options.timeout || 300;
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

  static sanitize(text: string): string {
    let sanitized = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }
}
