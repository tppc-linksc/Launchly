import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretValueService } from '../../environment/secret-value.service';
import { GithubAppService } from '../../git/github-app.service';
import { assertSafeRefId } from './ref-id-safety';
import { BUILD_ROOT, buildContextDir } from './build-context';
import { isSafeGitReference, isSafeGitRepositoryUrl } from '../../common/security/git-repository-url';
import { canonicalSshHostKey } from '../../common/security/ssh-host-key';
import { isGithubInstallationBoundToWorkspace } from '../../common/security/github-installation-binding';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Git 源码拉取 Runner（KI-032 / KI-033 / KI-034 / R2-01）。
 *
 * 关键约束：
 * - refId / projectId 走 assertSafeRefId；防止路径穿越（KI-032）。
 * - Deploy Key 凭据位于构建上下文之外并在 finally 清理，源码保留给下一阶段 BuildKit。
 * - 指定 commitSha 时，fetch 和 detached checkout 任一失败必须 fail closed（KI-033），
 *   并读取实际 HEAD 写入 Artifact，避免"声称 X commit 实际是 Y head"。
 * - 所有报错与 stdout/stderr 走 CommandExecutor.sanitize。
 */

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

    // KI-032: 用单一权威校验 caller 控制的 ID。
    try {
      assertSafeRefId(ctx.refId, 'refId');
      if (typeof projectId === 'string' && projectId) assertSafeRefId(projectId, 'projectId');
    } catch (e: any) {
      return this.failure(e?.message || 'Invalid identifier');
    }

    if (!isSafeGitRepositoryUrl(repoUrl) || !isSafeGitReference(branch) || (commitSha && !/^[a-f0-9]{7,64}$/i.test(commitSha))) {
      return this.failure('仓库 URL / branch / commit 非法');
    }

    // REPO_CLONE 与后续 PROJECT_BUILD 必须共享同一个构建上下文。
    const workDir = buildContextDir(ctx.refId);
    let privateKeyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let sourceReady = false;

    try {
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });

      const clone = await this.clone(sourceType, repoUrl, String(branch), String(projectId || ''), workDir, ctx.refId);
      privateKeyPath = clone.privateKeyPath;
      knownHostsPath = clone.knownHostsPath;
      if (clone.result.exitCode !== 0) return this.resultFrom(clone.result, 'Git clone 失败');

      if (commitSha) {
        // KI-033: fetch + detached checkout 任一步失败必须 fail closed。
        const fetch = await this.executor.execFile('git', ['fetch', '--depth', '1', 'origin', String(commitSha)], { cwd: workDir, timeout: 120, env: clone.env });
        if (fetch.exitCode !== 0) {
          return this.failure(`指定 commit ${commitSha} 拉取失败：${CommandExecutor.sanitize(fetch.stderr) || '未知错误'}`);
        }
        const checkout = await this.executor.execFile('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: workDir, timeout: 120, env: clone.env });
        if (checkout.exitCode !== 0) {
          return this.failure(`指定 commit ${commitSha} 检出失败：${CommandExecutor.sanitize(checkout.stderr) || '未知错误'}`);
        }
        // 再次核对实际 HEAD 与请求一致；不一致时拒绝。
        const head = await this.executor.execFile('git', ['rev-parse', 'HEAD'], { cwd: workDir, timeout: 30, env: clone.env });
        if (head.exitCode !== 0 || head.stdout.trim() !== String(commitSha)) {
          return this.failure(`实际 HEAD 与请求 commit 不一致：请求=${commitSha} 实际=${head.stdout.trim()}`);
        }
      }

      // A GitHub App clone records its credentialed URL in .git/config. BuildKit
      // never needs repository metadata, so remove all of .git before handing off.
      fs.rmSync(path.join(workDir, '.git'), { recursive: true, force: true });
      sourceReady = true;

      return {
        success: true,
        stdout: CommandExecutor.sanitize(clone.result.stdout),
        stderr: CommandExecutor.sanitize(clone.result.stderr),
        exitCode: 0,
        errorMessage: '',
      };
    } catch (e: any) {
      return this.failure(e?.message || 'Git clone 失败');
    } finally {
      if (privateKeyPath) this.safeUnlink(privateKeyPath);
      if (knownHostsPath) this.safeUnlink(knownHostsPath);
      // Only a complete, credential-free source tree may survive for BuildKit.
      if (!sourceReady) {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    }
  }

  private async clone(sourceType: string, repositoryUrl: string, branch: string, projectId: string, workDir: string, deploymentId: string) {
    let url = repositoryUrl;
    let env: Record<string, string> | undefined;
    let privateKeyPath: string | undefined;
    let knownHostsPath: string | undefined;
    try {
      if (sourceType === 'GITHUB_APP') {
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        if (!project?.githubInstallationId) throw new Error('GitHub App 源缺少 installation ID');
        if (!isGithubInstallationBoundToWorkspace(project.githubInstallationId, project.workspaceId)) {
          throw new Error('GitHub App installation 未绑定到项目工作空间');
        }
        url = this.githubTokenUrl(repositoryUrl, await this.githubApp.installationToken(project.githubInstallationId));
      } else if (sourceType === 'DEPLOY_KEY') {
        const credential = await this.prisma.repositoryCredential.findUnique({ where: { projectId } });
        if (!credential || credential.credentialType !== 'DEPLOY_KEY' || !credential.hostKey) {
          throw new Error('Deploy Key 源缺少密钥或 pinned host key');
        }
        const host = this.sshHost(repositoryUrl);
        if (!host) throw new Error('Deploy Key 源必须是 SSH 仓库 URL');
        // Keep credentials outside workDir: `git clone ... .` requires an empty
        // destination and BuildKit must never receive secret material as context.
        privateKeyPath = path.join(BUILD_ROOT, `.git-key-${deploymentId}`);
        knownHostsPath = path.join(BUILD_ROOT, `.git-known-hosts-${deploymentId}`);
        fs.writeFileSync(privateKeyPath, this.secrets.decrypt(credential.encryptedValue), { mode: 0o600 });
        const hostKey = canonicalSshHostKey(credential.hostKey);
        if (!hostKey) throw new Error('Deploy Key pinned host key 格式无效');
        fs.writeFileSync(knownHostsPath, `${host} ${hostKey}\n`, { mode: 0o600 });
        env = {
          GIT_SSH_COMMAND: `ssh -i ${privateKeyPath} -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${knownHostsPath}`,
        };
      } else if (sourceType !== 'GIT_PUBLIC') {
        throw new Error(`不支持的 Git 源类型: ${sourceType}`);
      }
      return {
        result: await this.executor.execFile('git', ['clone', '--depth', '1', '--branch', branch, '--', url, '.'], { cwd: workDir, timeout: 300, env }),
        env,
        privateKeyPath,
        knownHostsPath,
      };
    } catch (error) {
      if (privateKeyPath) this.safeUnlink(privateKeyPath);
      if (knownHostsPath) this.safeUnlink(knownHostsPath);
      throw error;
    }
  }

  private githubTokenUrl(repositoryUrl: string, token: string): string {
    const url = new URL(repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('GitHub App 源必须是 HTTPS github.com 仓库 URL');
    }
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

  private safeUnlink(file: string) { try { fs.unlinkSync(file); } catch { /* 清理失败忽略 */ } }
  private failure(message: string): RunnerResult {
    const sanitized = CommandExecutor.sanitize(message);
    return { success: false, stdout: '', stderr: sanitized, exitCode: -1, errorMessage: sanitized };
  }
  private resultFrom(result: { stdout: string; stderr: string; exitCode: number }, message: string): RunnerResult {
    return {
      success: false,
      stdout: CommandExecutor.sanitize(result.stdout),
      stderr: CommandExecutor.sanitize(result.stderr),
      exitCode: result.exitCode,
      errorMessage: message,
    };
  }
}
