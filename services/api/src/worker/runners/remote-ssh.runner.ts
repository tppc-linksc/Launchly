import { Injectable } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { SecretValueService } from '../../environment/secret-value.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertSafeRefId } from './ref-id-safety';
import * as path from 'path';
import * as fs from 'fs';
import { canonicalSshHostKey } from '../../common/security/ssh-host-key';

/**
 * 远程 SSH 部署 Runner（KI-004 / KI-031 / KI-032 / KI-035 / R3）。
 *
 * 关键约束：
 * - 所有 ID 走统一的 assertSafeRefId（KI-032），绝不允许 caller 把 `../escape` 之类字符写入路径。
 * - 目标主机/用户名严格白名单正则（KI-023）；target.projectId 必须等于 payload.projectId（KI-004）。
 * - Artifact 必须归属同一 project，且 digest/imageRef 严格校验（KI-031 / KI-035）：
 *   - digest 必须是 `sha256:[0-9a-f]{64}` 全长。
 *   - imageRef 只能是合法 OCI 路径 + 可选 tag。
 * - 所有临时文件使用 refId 隔离的目录，finally 中清理（KI-034 兜底）。
 */

const BUILD_ROOT = '/tmp/launchly-builds';
const DEFAULT_TARGET_WORK_ROOT = '/var/lib/launchly';
const PROXY_NETWORK = 'launchly_proxy';
const PROXY_CONTAINER = 'launchly-proxy';

/** 主机名 / IPv6 字面量白名单。 */
const SAFE_HOST = /^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])$/;
/** SSH 用户名白名单：字母/数字/下划线/连字符，首字符必须为字母或下划线。 */
const SAFE_USER = /^[a-z_][a-z0-9_-]*$/i;
/** 工作根路径白名单：绝对路径，每段 1-255 字符。 */
const SAFE_WORK_ROOT = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** 严格 OCI digest 校验：必须 `sha256:` + 64 位小写十六进制（KI-035）。 */
const SAFE_OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
/** OCI imageRef：仅允许 path + 可选 host:port + 可选 tag；不允许 shell 元字符。 */
const SAFE_OCI_IMAGE_REFERENCE = /^(?:[a-zA-Z0-9._/-]+:){0,2}[a-zA-Z0-9._/-]+(?::[a-zA-Z0-9._-]{1,128})?$/;

@Injectable()
export class RemoteSshRunner {
  constructor(
    private readonly executor: CommandExecutor,
    private readonly secrets: SecretValueService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    if (ctx.taskType === 'ROLLBACK_DEPLOY') return this.executeRollback(ctx);
    if (ctx.taskType === 'PROJECT_BOOTSTRAP') return this.executeBootstrap(ctx);
    const {
      deployTargetId,
      environmentId,
      projectId,
      port = 3000,
      containerPort = port,
      externalPort = port,
    } = ctx.payload;
    const domain = this.normalizeDomain(ctx.payload.domain);
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let composePath: string | undefined;
    let envPath: string | undefined;
    let nginxPath: string | undefined;
    let workDir: string | undefined;

    try {
      // KI-032: 用单一权威校验所有 ID，避免被 caller 注入路径片段。
      try {
        assertSafeRefId(ctx.refId, 'refId');
        assertSafeRefId(projectId, 'projectId');
        assertSafeRefId(environmentId, 'environmentId');
      } catch (e: any) {
        return this.failure(e?.message || 'Invalid deployment identifiers');
      }
      if (
        ![containerPort, externalPort].every(
          (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535,
        )
      ) {
        return this.failure('Invalid deployment identifiers or port');
      }

      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } });
      if (!target) return this.failure('Deploy target not found');
      // KI-004: 跨项目 Target 会被拒绝，防止部署到他人节点。
      if (target.projectId !== projectId)
        return this.failure('Deploy target does not belong to the deployment project');
      if (target.authMethod !== 'KEY')
        return this.failure('Only SSH key authentication is supported; register a deploy key instead of a password');
      if (!SAFE_HOST.test(target.host) || !SAFE_USER.test(target.username) || !target.hostKey) {
        return this.failure('Target host, username, or pinned host key is invalid');
      }

      const deploymentArtifact = await this.prisma.deployment.findUnique({
        where: { id: ctx.refId },
        select: { artifact: true },
      });
      const artifact =
        deploymentArtifact?.artifact ?? (await this.prisma.artifact.findUnique({ where: { deploymentId: ctx.refId } }));
      if (!artifact || !SAFE_OCI_DIGEST.test(artifact.digest) || !SAFE_OCI_IMAGE_REFERENCE.test(artifact.imageRef)) {
        return this.failure('Deployment does not have a verified OCI artifact');
      }
      // KI-031: Artifact 必须绑定同一 project；防止 payload 替换 Artifact。
      if (artifact.projectId !== projectId) return this.failure('Artifact does not belong to the deployment project');

      // KI-034: 用任务专属子目录隔离临时密钥/known_hosts，避免并发串扰；finally 兜底清理。
      workDir = path.join(BUILD_ROOT, `work-${ctx.refId}`);
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
      keyPath = path.join(workDir, 'id_ed25519');
      knownHostsPath = path.join(workDir, 'known_hosts');
      fs.writeFileSync(keyPath, this.secrets.decrypt(target.encryptedCredential), { mode: 0o600 });
      const targetHostKey = canonicalSshHostKey(target.hostKey);
      if (!targetHostKey) return this.failure('Target pinned host key is invalid');
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${targetHostKey}\n`, { mode: 0o600 });

      const remote = `${target.username}@${target.host}`;
      const targetRoot = this.targetRoot(target.workRoot);
      const remoteDir = `${targetRoot}/apps/${projectId}/${environmentId}/${ctx.refId}`;
      const proxyAlias = domain ? `app_${projectId}_${environmentId}`.replace(/-/g, '_') : undefined;
      const prepare = await this.executor.execFile(
        'ssh',
        [
          ...this.sshArgs(keyPath, knownHostsPath, target.port),
          remote,
          `set -eu; mkdir -p '${remoteDir}'; chmod 700 '${remoteDir}'`,
        ],
        { timeout: 60 },
      );
      if (prepare.exitCode !== 0)
        return this.resultFrom(prepare, 'Unable to create isolated remote deployment directory');

      await ctx.stageLogCallback?.('RUNNING', 'Transferring deployment manifest for immutable registry artifact...');
      const envVars = await this.getEnvironmentVariables(environmentId);
      const sensitiveValues = Object.values(envVars);
      composePath = path.join(workDir, 'compose.yml');
      envPath = path.join(workDir, 'app.env');
      const immutableImage = `${artifact.imageRef}@${artifact.digest}`;
      fs.writeFileSync(
        composePath,
        this.generateComposeFile(
          immutableImage,
          Number(externalPort),
          Number(containerPort),
          path.basename(envPath),
          proxyAlias,
        ),
        { mode: 0o600 },
      );
      fs.writeFileSync(envPath, this.generateEnvFile(envVars), { mode: 0o600 });
      if (domain && proxyAlias) {
        nginxPath = path.join(workDir, 'nginx.conf');
        fs.writeFileSync(nginxPath, this.generateNginxConfig(domain, proxyAlias, Number(containerPort)), {
          mode: 0o600,
        });
      }
      for (const localFile of [composePath, envPath, ...(nginxPath ? [nginxPath] : [])]) {
        const copy = await this.executor.execFile(
          'scp',
          [
            ...this.scpArgs(keyPath, knownHostsPath, target.port),
            localFile,
            `${remote}:${remoteDir}/${path.basename(localFile)}`,
          ],
          { timeout: 120 },
        );
        if (copy.exitCode !== 0) return this.resultFrom(copy, 'Deployment manifest transfer failed');
      }

      await ctx.stageLogCallback?.(
        'RUNNING',
        'Pulling immutable registry artifact and starting isolated Compose project...',
      );
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      if (domain) {
        const proxy = await this.executor.execFile(
          'ssh',
          [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, this.proxyBootstrapCommand(targetRoot)],
          { timeout: 180 },
        );
        if (proxy.exitCode !== 0)
          return this.resultFrom(
            proxy,
            'Unable to start the shared Launchly Nginx proxy; ensure ports 80 and 443 are available to Docker',
            sensitiveValues,
          );
      }
      const remoteDeploy = `set -eu; docker pull '${immutableImage}'; docker compose --project-name '${projectName}' --env-file '${remoteDir}/${path.basename(envPath)}' -f '${remoteDir}/${path.basename(composePath)}' up -d --no-build`;
      const deploy = await this.executor.execFile(
        'ssh',
        [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, remoteDeploy],
        { timeout: 600 },
      );
      if (deploy.exitCode !== 0) return this.resultFrom(deploy, 'Remote deployment failed', sensitiveValues);

      if (domain && nginxPath) {
        const proxyConfig = `launchly-${projectId}-${environmentId}.conf`;
        const proxyRoot = `${targetRoot}/proxy`;
        const activate = `set -eu; cp '${remoteDir}/${path.basename(nginxPath)}' '${proxyRoot}/conf.d/${proxyConfig}'; chmod 644 '${proxyRoot}/conf.d/${proxyConfig}'; if ! docker exec '${PROXY_CONTAINER}' nginx -t; then rm -f '${proxyRoot}/conf.d/${proxyConfig}'; exit 1; fi; docker exec '${PROXY_CONTAINER}' nginx -s reload`;
        await ctx.stageLogCallback?.('RUNNING', `Activating Nginx route for ${domain}...`);
        const configured = await this.executor.execFile(
          'ssh',
          [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, activate],
          { timeout: 120 },
        );
        if (configured.exitCode !== 0)
          return this.resultFrom(
            configured,
            'Nginx route activation failed; deployment was not exposed at the configured domain',
            sensitiveValues,
          );
      }

      // Keep only the five newest immutable snapshots per environment. The
      // active Compose process has already loaded app.env; older plaintext
      // manifests must not accumulate indefinitely on the target host.
      const environmentRoot = `${targetRoot}/apps/${projectId}/${environmentId}`;
      // IDs are strict SAFE_REF_ID values, so snapshot directory names cannot
      // contain whitespace/newlines. `ls -dt` + POSIX `tail` works on GNU,
      // BSD and BusyBox hosts, unlike GNU-only `find -printf`.
      const retention = `set -eu; if [ -d '${environmentRoot}' ]; then ls -1dt -- '${environmentRoot}'/*/ 2>/dev/null | tail -n +6 | while IFS= read -r old; do [ -n "$old" ] && rm -rf -- "$old"; done; fi`;
      const pruned = await this.executor.execFile(
        'ssh',
        [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, retention],
        { timeout: 120 },
      );
      if (pruned.exitCode !== 0)
        await ctx.stageLogCallback?.('RUNNING', 'Warning: old remote deployment snapshots could not be pruned');

      return {
        success: true,
        stdout: `${deploy.stdout}${domain ? `\nNginx route active: http://${domain}` : ''}`,
        stderr: deploy.stderr,
        exitCode: 0,
        errorMessage: '',
        sensitiveValues,
      };
    } catch (error: any) {
      return this.failure(error?.message || 'SSH deployment failed');
    } finally {
      // 兜底清理：先删文件，再删目录。删除失败不抛错。
      for (const file of [keyPath, knownHostsPath, composePath, envPath, nginxPath]) if (file) this.safeUnlink(file);
      if (workDir) this.safeRmdir(workDir);
    }
  }

  private async executeRollback(ctx: RunnerContext): Promise<RunnerResult> {
    const { deployTargetId, projectId, environmentId, rollbackDeploymentId } = ctx.payload;
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let workDir: string | undefined;
    try {
      try {
        assertSafeRefId(ctx.refId, 'refId');
        assertSafeRefId(projectId, 'projectId');
        assertSafeRefId(environmentId, 'environmentId');
        assertSafeRefId(rollbackDeploymentId, 'rollbackDeploymentId');
      } catch (e: any) {
        return this.failure(e?.message || 'Invalid rollback identifiers');
      }
      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } });
      if (
        !target ||
        target.authMethod !== 'KEY' ||
        !target.hostKey ||
        !SAFE_HOST.test(target.host) ||
        !SAFE_USER.test(target.username)
      ) {
        return this.failure('Rollback target is not safely configured');
      }
      // KI-004: 不允许跨项目 Target 进行回滚。
      if (target.projectId !== projectId)
        return this.failure('Rollback target does not belong to the deployment project');
      // KI-031: 回滚目标 Deployment 也必须在同一 project。
      const previousDeployment = await this.prisma.deployment.findUnique({
        where: { id: rollbackDeploymentId },
        select: { projectId: true },
      });
      if (!previousDeployment || previousDeployment.projectId !== projectId) {
        return this.failure('Rollback target deployment does not belong to the deployment project');
      }

      workDir = path.join(BUILD_ROOT, `rollback-${ctx.refId}`);
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
      keyPath = path.join(workDir, 'id_ed25519');
      knownHostsPath = path.join(workDir, 'known_hosts');
      fs.writeFileSync(keyPath, this.secrets.decrypt(target.encryptedCredential), { mode: 0o600 });
      const targetHostKey = canonicalSshHostKey(target.hostKey);
      if (!targetHostKey) return this.failure('Rollback pinned host key is invalid');
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${targetHostKey}\n`, { mode: 0o600 });
      const remote = `${target.username}@${target.host}`;
      const previousDir = `${this.targetRoot(target.workRoot)}/apps/${projectId}/${environmentId}/${rollbackDeploymentId}`;
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      const remoteRollback = `set -eu; test -f '${previousDir}/compose.yml'; test -f '${previousDir}/app.env'; docker compose --project-name '${projectName}' --env-file '${previousDir}/app.env' -f '${previousDir}/compose.yml' up -d --no-build`;
      await ctx.stageLogCallback?.('RUNNING', `Restoring previous immutable deployment ${rollbackDeploymentId}...`);
      const result = await this.executor.execFile(
        'ssh',
        [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, remoteRollback],
        { timeout: 300 },
      );
      return result.exitCode === 0
        ? { success: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0, errorMessage: '' }
        : this.resultFrom(result, 'Automatic rollback failed');
    } catch (error: any) {
      return this.failure(error?.message || 'Automatic rollback failed');
    } finally {
      if (keyPath) this.safeUnlink(keyPath);
      if (knownHostsPath) this.safeUnlink(knownHostsPath);
      if (workDir) this.safeRmdir(workDir);
    }
  }

  /**
   * 执行项目声明的、一次性的 Bootstrap 管理命令（创建管理员账号等）。
   * 仅在同一 (projectId, environmentId) 下未成功执行过时才运行。
   * 所有失败路径都尝试写入 ProjectBootstrapRun 状态，便于 UI 区分"从未执行/执行中/已成功/已失败"。
   */
  private async executeBootstrap(ctx: RunnerContext): Promise<RunnerResult> {
    const {
      deployTargetId,
      projectId,
      environmentId,
      bootstrapAdminCommand,
      bootstrapAdminUsername,
      bootstrapAdminEmail,
    } = ctx.payload;
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let bootstrapEnvPath: string | undefined;
    let workDir: string | undefined;
    try {
      try {
        assertSafeRefId(ctx.refId, 'refId');
        assertSafeRefId(projectId, 'projectId');
        assertSafeRefId(environmentId, 'environmentId');
        assertSafeRefId(deployTargetId, 'deployTargetId');
      } catch (e: any) {
        return this.failure(e?.message || 'Invalid bootstrap deployment identifiers');
      }
      if (
        typeof bootstrapAdminCommand !== 'string' ||
        !bootstrapAdminCommand ||
        /[\r\n\0]/.test(bootstrapAdminCommand)
      ) {
        return this.failure('Bootstrap command is not safely configured');
      }
      const prior = await this.prisma.projectBootstrapRun.findUnique({
        where: { projectId_environmentId: { projectId, environmentId } },
      });
      if (prior?.status === 'SUCCEEDED') {
        return {
          success: true,
          stdout: 'Bootstrap already completed for this environment; skipped',
          stderr: '',
          exitCode: 0,
          errorMessage: '',
        };
      }
      if (prior?.status === 'RUNNING') {
        return this.failure('Bootstrap is already in progress for this environment; refusing to run concurrently');
      }
      const [target, secret] = await Promise.all([
        this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } }),
        this.prisma.projectBootstrapSecret.findUnique({ where: { projectId } }),
      ]);
      if (
        !target ||
        target.authMethod !== 'KEY' ||
        !target.hostKey ||
        !SAFE_HOST.test(target.host) ||
        !SAFE_USER.test(target.username)
      ) {
        return this.failure('Bootstrap target is not safely configured');
      }
      // KI-004: Bootstrap 目标也必须与 project 一致。
      if (target.projectId !== projectId)
        return this.failure('Bootstrap target does not belong to the deployment project');
      if (!secret) return this.failure('Bootstrap admin password is not configured for this project');

      workDir = path.join(BUILD_ROOT, `bootstrap-${ctx.refId}`);
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
      keyPath = path.join(workDir, 'id_ed25519');
      knownHostsPath = path.join(workDir, 'known_hosts');
      bootstrapEnvPath = path.join(workDir, 'bootstrap.env');
      fs.writeFileSync(keyPath, this.secrets.decrypt(target.encryptedCredential), { mode: 0o600 });
      const targetHostKey = canonicalSshHostKey(target.hostKey);
      if (!targetHostKey) return this.failure('Bootstrap pinned host key is invalid');
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${targetHostKey}\n`, { mode: 0o600 });
      fs.writeFileSync(
        bootstrapEnvPath,
        this.generateEnvFile({
          LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME: String(bootstrapAdminUsername || ''),
          LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL: String(bootstrapAdminEmail || ''),
          LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD: this.secrets.decrypt(secret.encryptedPassword),
        }),
        { mode: 0o600 },
      );

      // 标记 RUNNING，避免并发重入。
      await this.recordBootstrapResult(projectId, environmentId, ctx.refId, 'RUNNING', null);

      const remote = `${target.username}@${target.host}`;
      const remoteDir = `${this.targetRoot(target.workRoot)}/apps/${projectId}/${environmentId}/${ctx.refId}`;
      const copy = await this.executor.execFile(
        'scp',
        [
          ...this.scpArgs(keyPath, knownHostsPath, target.port),
          bootstrapEnvPath,
          `${remote}:${remoteDir}/${path.basename(bootstrapEnvPath)}`,
        ],
        { timeout: 120 },
      );
      if (copy.exitCode !== 0) {
        await this.recordBootstrapResult(
          projectId,
          environmentId,
          ctx.refId,
          'FAILED',
          'Bootstrap credential transfer failed',
        );
        return this.resultFrom(copy, 'Bootstrap credential transfer failed');
      }
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      const command = `set -eu; trap "rm -f '${remoteDir}/${path.basename(bootstrapEnvPath)}'" EXIT; set -a; . '${remoteDir}/${path.basename(bootstrapEnvPath)}'; set +a; docker compose --project-name '${projectName}' --env-file '${remoteDir}/app.env' -f '${remoteDir}/compose.yml' exec -T -e LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME -e LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL -e LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD app sh -lc ${this.shellQuote(bootstrapAdminCommand)}`;
      await ctx.stageLogCallback?.(
        'RUNNING',
        'Running the project-declared admin bootstrap command inside the application container...',
      );
      const result = await this.executor.execFile(
        'ssh',
        [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, command],
        { timeout: 300 },
      );
      if (result.exitCode !== 0) {
        await this.recordBootstrapResult(projectId, environmentId, ctx.refId, 'FAILED', 'Bootstrap command failed');
        return this.failure('Application admin bootstrap command failed');
      }
      await this.recordBootstrapResult(projectId, environmentId, ctx.refId, 'SUCCEEDED', null);
      return {
        success: true,
        stdout: 'Application admin bootstrap completed',
        stderr: '',
        exitCode: 0,
        errorMessage: '',
      };
    } catch (error: any) {
      const message = error?.message || 'Application admin bootstrap failed';
      await this.recordBootstrapResult(projectId, environmentId, ctx.refId, 'FAILED', message).catch(() => undefined);
      return this.failure(message);
    } finally {
      if (keyPath) this.safeUnlink(keyPath);
      if (knownHostsPath) this.safeUnlink(knownHostsPath);
      if (bootstrapEnvPath) this.safeUnlink(bootstrapEnvPath);
      if (workDir) this.safeRmdir(workDir);
    }
  }

  /** 统一的 Bootstrap 状态写入：失败时只记日志，不抛错。 */
  private async recordBootstrapResult(
    projectId: string,
    environmentId: string,
    deploymentId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'RUNNING',
    lastError: string | null,
  ) {
    try {
      await this.prisma.projectBootstrapRun.upsert({
        where: { projectId_environmentId: { projectId, environmentId } },
        create: {
          projectId,
          environmentId,
          deploymentId,
          status,
          lastError: lastError ?? undefined,
          completedAt: status === 'SUCCEEDED' ? new Date() : undefined,
        },
        update: {
          deploymentId,
          status,
          lastError: lastError ?? undefined,
          completedAt: status === 'SUCCEEDED' ? new Date() : null,
        },
      });
    } catch {
      // 状态写入失败只记日志，不掩盖原始错误。
    }
  }

  private sshArgs(keyPath: string, knownHostsPath: string, port: number): string[] {
    return [
      '-i',
      keyPath,
      '-p',
      String(port),
      '-o',
      'BatchMode=yes',
      '-o',
      'PasswordAuthentication=no',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
    ];
  }

  private scpArgs(keyPath: string, knownHostsPath: string, port: number): string[] {
    return [
      '-i',
      keyPath,
      '-P',
      String(port),
      '-o',
      'BatchMode=yes',
      '-o',
      'PasswordAuthentication=no',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
    ];
  }

  private async getEnvironmentVariables(environmentId: string): Promise<Record<string, string>> {
    const vars = await this.prisma.environmentVariable.findMany({ where: { environmentId } });
    // KI-016: 数据库有 @@unique([environmentId, key]) 约束，但作为兜底，
    // runner 也必须拒绝重复 key（防止遗留数据）；不静默覆盖。
    const seen = new Set<string>();
    for (const v of vars) {
      if (seen.has(v.key)) {
        throw new Error(`重复的环境变量 key: ${v.key}（environmentId=${environmentId}）`);
      }
      seen.add(v.key);
    }
    return Object.fromEntries(vars.map((variable) => [variable.key, this.secrets.decrypt(variable.encryptedValue)]));
  }

  private generateEnvFile(values: Record<string, string>): string {
    return Object.entries(values)
      .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes('\u0000') || value.includes('\n')) {
          throw new Error(`非法环境变量: ${key}`);
        }
        return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      })
      .join('\n');
  }

  private generateComposeFile(
    imageName: string,
    externalPort: number,
    containerPort: number,
    envFilename: string,
    proxyAlias?: string,
  ): string {
    const proxyNetwork = proxyAlias
      ? `    networks:\n      ${PROXY_NETWORK}:\n        aliases:\n          - ${proxyAlias}\nnetworks:\n  ${PROXY_NETWORK}:\n    external: true\n`
      : '';
    return `services:\n  app:\n    image: ${imageName}\n    env_file:\n      - ./${envFilename}\n    ports:\n      - "${externalPort}:${containerPort}"\n    restart: unless-stopped\n${proxyNetwork}`;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  private generateNginxConfig(domain: string, upstream: string, port: number): string {
    return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n\n  location / {\n    proxy_pass http://${upstream}:${port};\n    proxy_http_version 1.1;\n    proxy_set_header Host \$host;\n    proxy_set_header X-Real-IP \$remote_addr;\n    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto \$scheme;\n    proxy_set_header Upgrade \$http_upgrade;\n    proxy_set_header Connection "upgrade";\n  }\n}\n`;
  }

  private proxyBootstrapCommand(targetRoot: string): string {
    const proxyRoot = `${targetRoot}/proxy`;
    return `set -eu; mkdir -p '${proxyRoot}/conf.d'; chmod 755 '${proxyRoot}' '${proxyRoot}/conf.d'; docker network inspect '${PROXY_NETWORK}' >/dev/null 2>&1 || docker network create '${PROXY_NETWORK}' >/dev/null; docker container inspect '${PROXY_CONTAINER}' >/dev/null 2>&1 || docker run -d --name '${PROXY_CONTAINER}' --restart unless-stopped --network '${PROXY_NETWORK}' -p 80:80 -v '${proxyRoot}/conf.d:/etc/nginx/conf.d:ro' nginx:1.27.5-alpine >/dev/null`;
  }

  private normalizeDomain(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const domain = value.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
      throw new Error('Invalid domain for Nginx route');
    return domain;
  }

  private targetRoot(value: unknown): string {
    const root =
      typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : DEFAULT_TARGET_WORK_ROOT;
    if (!SAFE_WORK_ROOT.test(root) || root === '/') throw new Error('Deploy target work root is invalid');
    return root;
  }

  private safeUnlink(file: string) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* 清理失败不抛错 */
    }
  }
  private safeRmdir(dir: string) {
    try {
      fs.rmdirSync(dir);
    } catch {
      /* 可能非空或已删除 */
    }
  }
  private failure(message: string): RunnerResult {
    return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message };
  }
  private resultFrom(
    result: { stdout: string; stderr: string; exitCode: number },
    message: string,
    sensitiveValues?: string[],
  ): RunnerResult {
    return { success: false, ...result, errorMessage: message, sensitiveValues };
  }
}
