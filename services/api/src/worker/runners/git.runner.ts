import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretValueService } from '../../environment/secret-value.service';
import { GithubAppService } from '../../git/github-app.service';
import * as path from 'path';
import * as fs from 'fs';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class GitRunner {
  private readonly logger = new Logger(GitRunner.name);

  constructor(
    private readonly executor: CommandExecutor,
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
    private readonly githubApp: GithubAppService,
  ) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const { projectId, branch = 'main', commitSha } = ctx.payload;
    const repoUrl = ctx.payload.repositoryUrl || '';
    const sourceType = ctx.payload.sourceType || 'GIT_PUBLIC';
    const workDir = path.join(BUILD_ROOT, ctx.refId);
    let privateKeyPath: string | undefined;
    let knownHostsPath: string | undefined;

    if (!repoUrl || !this.safeGitReference(branch) || (commitSha && !this.safeGitReference(commitSha))) {
      return this.failure('Repository URL, branch, or commit reference is invalid');
    }
    try {
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });

      const clone = await this.clone(sourceType, repoUrl, String(branch), String(projectId || ''), workDir, ctx.refId);
      privateKeyPath = clone.privateKeyPath;
      knownHostsPath = clone.knownHostsPath;
      if (clone.result.exitCode !== 0) return this.resultFrom(clone.result, 'Git clone failed');

      if (commitSha) {
        const checkout = await this.executor.execFile('git', ['fetch', '--depth', '1', 'origin', String(commitSha)], { cwd: workDir, timeout: 120, env: clone.env });
        if (checkout.exitCode === 0) {
          const switchResult = await this.executor.execFile('git', ['checkout', '--detach', String(commitSha)], { cwd: workDir, timeout: 120, env: clone.env });
          if (switchResult.exitCode !== 0) this.logger.warn(`Unable to checkout requested revision for deployment ${ctx.refId}`);
        } else {
          this.logger.warn(`Unable to fetch requested revision for deployment ${ctx.refId}; using branch head`);
        }
      }
      return { success: true, stdout: CommandExecutor.sanitize(clone.result.stdout), stderr: CommandExecutor.sanitize(clone.result.stderr), exitCode: 0, errorMessage: '' };
    } catch (e: any) {
      return this.failure(e?.message || 'Git clone failed');
    } finally {
      for (const file of [privateKeyPath, knownHostsPath]) if (file) this.safeUnlink(file);
    }
  }

  private async clone(sourceType: string, repositoryUrl: string, branch: string, projectId: string, workDir: string, deploymentId: string) {
    let url = repositoryUrl;
    let env: Record<string, string> | undefined;
    let privateKeyPath: string | undefined;
    let knownHostsPath: string | undefined;
    if (sourceType === 'GITHUB_APP') {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project?.githubInstallationId) throw new Error('GitHub App source requires an installation ID');
      url = this.githubTokenUrl(repositoryUrl, await this.githubApp.installationToken(project.githubInstallationId));
    } else if (sourceType === 'DEPLOY_KEY') {
      const credential = await this.prisma.repositoryCredential.findUnique({ where: { projectId } });
      if (!credential || credential.credentialType !== 'DEPLOY_KEY' || !credential.hostKey) throw new Error('Deploy Key source requires a project deploy key and pinned host key');
      const host = this.sshHost(repositoryUrl);
      if (!host) throw new Error('Deploy Key source requires an SSH repository URL');
      privateKeyPath = path.join(BUILD_ROOT, `repo-key-${deploymentId}`);
      knownHostsPath = path.join(BUILD_ROOT, `repo-known-hosts-${deploymentId}`);
      fs.writeFileSync(privateKeyPath, this.secrets.decrypt(credential.encryptedValue), { mode: 0o600 });
      fs.writeFileSync(knownHostsPath, `${host} ${credential.hostKey.trim()}\n`, { mode: 0o600 });
      env = {
        GIT_SSH_COMMAND: `ssh -i ${privateKeyPath} -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${knownHostsPath}`,
      };
    } else if (sourceType !== 'GIT_PUBLIC') {
      throw new Error(`Unsupported Git source type: ${sourceType}`);
    }
    await Promise.resolve();
    return {
      result: await this.executor.execFile('git', ['clone', '--depth', '1', '--branch', branch, url, '.'], { cwd: workDir, timeout: 300, env }),
      env,
      privateKeyPath,
      knownHostsPath,
    };
  }

  private githubTokenUrl(repositoryUrl: string, token: string): string {
    const url = new URL(repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('GitHub App source requires an HTTPS github.com repository URL');
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
  }

  private sshHost(repositoryUrl: string): string | null {
    const scpStyle = repositoryUrl.match(/^[^@\s]+@([a-zA-Z0-9.-]+):/);
    if (scpStyle) return scpStyle[1];
    try {
      const url = new URL(repositoryUrl);
      return url.protocol === 'ssh:' ? url.hostname : null;
    } catch { return null; }
  }

  private safeGitReference(value: string): boolean { return value.length <= 255 && !/[\0\r\n]/.test(value); }
  private safeUnlink(file: string) { try { fs.unlinkSync(file); } catch { /* cleanup only */ } }
  private failure(message: string): RunnerResult { return { success: false, stdout: '', stderr: CommandExecutor.sanitize(message), exitCode: -1, errorMessage: message }; }
  private resultFrom(result: { stdout: string; stderr: string; exitCode: number }, message: string): RunnerResult {
    return { success: false, stdout: CommandExecutor.sanitize(result.stdout), stderr: CommandExecutor.sanitize(result.stderr), exitCode: result.exitCode, errorMessage: message };
  }
}
