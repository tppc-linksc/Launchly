import { Injectable } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { SecretValueService } from '../../environment/secret-value.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

const BUILD_ROOT = '/tmp/launchly-builds';
const DEFAULT_TARGET_WORK_ROOT = '/var/lib/launchly';
const PROXY_NETWORK = 'launchly_proxy';
const PROXY_CONTAINER = 'launchly-proxy';
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_HOST = /^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])$/;
const SAFE_USER = /^[a-z_][a-z0-9_-]*$/i;
const SAFE_WORK_ROOT = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

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
    const { deployTargetId, environmentId, projectId, port = 3000, containerPort = port, externalPort = port } = ctx.payload;
    const domain = this.normalizeDomain(ctx.payload.domain);
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let composePath: string | undefined;
    let envPath: string | undefined;
    let nginxPath: string | undefined;

    try {
      if (!this.isSafeId(ctx.refId) || !this.isSafeId(projectId) || !this.isSafeId(environmentId) || ![containerPort, externalPort].every(value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535)) {
        return this.failure('Invalid deployment identifiers or port');
      }
      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } });
      if (!target) return this.failure('Deploy target not found');
      if (target.authMethod !== 'KEY') return this.failure('Only SSH key authentication is supported; register a deploy key instead of a password');
      if (!SAFE_HOST.test(target.host) || !SAFE_USER.test(target.username) || !target.hostKey) {
        return this.failure('Target host, username, or pinned host key is invalid');
      }
      const artifact = await this.prisma.artifact.findUnique({ where: { deploymentId: ctx.refId } });
      if (!artifact || !artifact.digest.startsWith('sha256:') || !/^[a-z0-9][a-z0-9./:_-]*$/i.test(artifact.imageRef)) return this.failure('Deployment does not have a verified OCI artifact');

      const credential = this.secrets.decrypt(target.encryptedCredential);
      keyPath = path.join(BUILD_ROOT, `key-${ctx.refId}`);
      knownHostsPath = path.join(BUILD_ROOT, `known-hosts-${ctx.refId}`);
      fs.mkdirSync(BUILD_ROOT, { recursive: true, mode: 0o700 });
      fs.writeFileSync(keyPath, credential, { mode: 0o600 });
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${target.hostKey.trim()}\n`, { mode: 0o600 });

      const remote = `${target.username}@${target.host}`;
      const targetRoot = this.targetRoot(target.workRoot);
      const remoteDir = `${targetRoot}/apps/${projectId}/${environmentId}/${ctx.refId}`;
      const proxyAlias = domain ? `app_${projectId}_${environmentId}`.replace(/-/g, '_') : undefined;
      const prepare = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, `set -eu; mkdir -p '${remoteDir}'; chmod 700 '${remoteDir}'`], { timeout: 60 });
      if (prepare.exitCode !== 0) return this.resultFrom(prepare, 'Unable to create isolated remote deployment directory');

      await ctx.stageLogCallback?.('RUNNING', 'Transferring deployment manifest for immutable registry artifact...');
      const envVars = await this.getEnvironmentVariables(environmentId);
      composePath = path.join(BUILD_ROOT, `${ctx.refId}.compose.yml`);
      envPath = path.join(BUILD_ROOT, `${ctx.refId}.env`);
      const immutableImage = `${artifact.imageRef}@${artifact.digest}`;
      fs.writeFileSync(composePath, this.generateComposeFile(immutableImage, Number(externalPort), Number(containerPort), path.basename(envPath), proxyAlias), { mode: 0o600 });
      fs.writeFileSync(envPath, this.generateEnvFile(envVars), { mode: 0o600 });
      if (domain && proxyAlias) {
        nginxPath = path.join(BUILD_ROOT, `${ctx.refId}.nginx.conf`);
        fs.writeFileSync(nginxPath, this.generateNginxConfig(domain, proxyAlias, Number(containerPort)), { mode: 0o600 });
      }
      for (const localFile of [composePath, envPath, ...(nginxPath ? [nginxPath] : [])]) {
        const copy = await this.executor.execFile('scp', [...this.scpArgs(keyPath, knownHostsPath, target.port), localFile, `${remote}:${remoteDir}/${path.basename(localFile)}`], { timeout: 120 });
        if (copy.exitCode !== 0) return this.resultFrom(copy, 'Deployment manifest transfer failed');
      }

      await ctx.stageLogCallback?.('RUNNING', 'Pulling immutable registry artifact and starting isolated Compose project...');
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      if (domain) {
        const proxy = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, this.proxyBootstrapCommand(targetRoot)], { timeout: 180 });
        if (proxy.exitCode !== 0) return this.resultFrom(proxy, 'Unable to start the shared Launchly Nginx proxy; ensure ports 80 and 443 are available to Docker');
      }
      const remoteDeploy = `set -eu; docker pull '${immutableImage}'; docker compose --project-name '${projectName}' --env-file '${remoteDir}/${path.basename(envPath)}' -f '${remoteDir}/${path.basename(composePath)}' up -d --no-build`;
      const deploy = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, remoteDeploy], { timeout: 600 });
      if (deploy.exitCode !== 0) return this.resultFrom(deploy, 'Remote deployment failed');

      if (domain && nginxPath) {
        const proxyConfig = `launchly-${projectId}-${environmentId}.conf`;
        const proxyRoot = `${targetRoot}/proxy`;
        const activate = `set -eu; cp '${remoteDir}/${path.basename(nginxPath)}' '${proxyRoot}/conf.d/${proxyConfig}'; chmod 644 '${proxyRoot}/conf.d/${proxyConfig}'; if ! docker exec '${PROXY_CONTAINER}' nginx -t; then rm -f '${proxyRoot}/conf.d/${proxyConfig}'; exit 1; fi; docker exec '${PROXY_CONTAINER}' nginx -s reload`;
        await ctx.stageLogCallback?.('RUNNING', `Activating Nginx route for ${domain}...`);
        const configured = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, activate], { timeout: 120 });
        if (configured.exitCode !== 0) return this.resultFrom(configured, 'Nginx route activation failed; deployment was not exposed at the configured domain');
      }

      return { success: true, stdout: `${deploy.stdout}${domain ? `\nNginx route active: http://${domain}` : ''}`, stderr: deploy.stderr, exitCode: 0, errorMessage: '' };
    } catch (error: any) {
      return this.failure(error?.message || 'SSH deployment failed');
    } finally {
      for (const file of [keyPath, knownHostsPath, composePath, envPath, nginxPath]) if (file) this.safeUnlink(file);
    }
  }

  private async executeRollback(ctx: RunnerContext): Promise<RunnerResult> {
    const { deployTargetId, projectId, environmentId, rollbackDeploymentId } = ctx.payload;
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    try {
      if (![ctx.refId, projectId, environmentId, rollbackDeploymentId].every(value => this.isSafeId(value))) return this.failure('Invalid rollback identifiers');
      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } });
      if (!target || target.authMethod !== 'KEY' || !target.hostKey || !SAFE_HOST.test(target.host) || !SAFE_USER.test(target.username)) return this.failure('Rollback target is not safely configured');
      fs.mkdirSync(BUILD_ROOT, { recursive: true, mode: 0o700 });
      keyPath = path.join(BUILD_ROOT, `rollback-key-${ctx.refId}`);
      knownHostsPath = path.join(BUILD_ROOT, `rollback-known-hosts-${ctx.refId}`);
      fs.writeFileSync(keyPath, this.secrets.decrypt(target.encryptedCredential), { mode: 0o600 });
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${target.hostKey.trim()}\n`, { mode: 0o600 });
      const remote = `${target.username}@${target.host}`;
      const previousDir = `${this.targetRoot(target.workRoot)}/apps/${projectId}/${environmentId}/${rollbackDeploymentId}`;
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      const remoteRollback = `set -eu; test -f '${previousDir}/${rollbackDeploymentId}.compose.yml'; test -f '${previousDir}/${rollbackDeploymentId}.env'; docker compose --project-name '${projectName}' --env-file '${previousDir}/${rollbackDeploymentId}.env' -f '${previousDir}/${rollbackDeploymentId}.compose.yml' up -d --no-build`;
      await ctx.stageLogCallback?.('RUNNING', `Restoring previous immutable deployment ${rollbackDeploymentId}...`);
      const result = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, remoteRollback], { timeout: 300 });
      return result.exitCode === 0
        ? { success: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0, errorMessage: '' }
        : this.resultFrom(result, 'Automatic rollback failed');
    } catch (error: any) {
      return this.failure(error?.message || 'Automatic rollback failed');
    } finally {
      if (keyPath) this.safeUnlink(keyPath);
      if (knownHostsPath) this.safeUnlink(knownHostsPath);
    }
  }

  /** Runs a project-declared, one-line bootstrap command inside the app container exactly once per environment. */
  private async executeBootstrap(ctx: RunnerContext): Promise<RunnerResult> {
    const { deployTargetId, projectId, environmentId, bootstrapAdminCommand, bootstrapAdminUsername, bootstrapAdminEmail } = ctx.payload;
    let keyPath: string | undefined;
    let knownHostsPath: string | undefined;
    let bootstrapEnvPath: string | undefined;
    try {
      if (![ctx.refId, projectId, environmentId, deployTargetId].every(value => this.isSafeId(value))) return this.failure('Invalid bootstrap deployment identifiers');
      if (typeof bootstrapAdminCommand !== 'string' || !bootstrapAdminCommand || /[\r\n\0]/.test(bootstrapAdminCommand)) return this.failure('Bootstrap command is not safely configured');
      const prior = await this.prisma.projectBootstrapRun.findUnique({ where: { projectId_environmentId: { projectId, environmentId } } });
      if (prior?.status === 'SUCCEEDED') {
        return { success: true, stdout: 'Bootstrap already completed for this environment; skipped', stderr: '', exitCode: 0, errorMessage: '' };
      }
      const [target, secret] = await Promise.all([
        this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } }),
        this.prisma.projectBootstrapSecret.findUnique({ where: { projectId } }),
      ]);
      if (!target || target.authMethod !== 'KEY' || !target.hostKey || !SAFE_HOST.test(target.host) || !SAFE_USER.test(target.username)) return this.failure('Bootstrap target is not safely configured');
      if (!secret) return this.failure('Bootstrap admin password is not configured for this project');

      fs.mkdirSync(BUILD_ROOT, { recursive: true, mode: 0o700 });
      keyPath = path.join(BUILD_ROOT, `bootstrap-key-${ctx.refId}`);
      knownHostsPath = path.join(BUILD_ROOT, `bootstrap-known-hosts-${ctx.refId}`);
      bootstrapEnvPath = path.join(BUILD_ROOT, `${ctx.refId}.bootstrap.env`);
      fs.writeFileSync(keyPath, this.secrets.decrypt(target.encryptedCredential), { mode: 0o600 });
      fs.writeFileSync(knownHostsPath, `[${target.host}]:${target.port} ${target.hostKey.trim()}\n`, { mode: 0o600 });
      fs.writeFileSync(bootstrapEnvPath, this.generateEnvFile({
        LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME: String(bootstrapAdminUsername || ''),
        LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL: String(bootstrapAdminEmail || ''),
        LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD: this.secrets.decrypt(secret.encryptedPassword),
      }), { mode: 0o600 });

      const remote = `${target.username}@${target.host}`;
      const remoteDir = `${this.targetRoot(target.workRoot)}/apps/${projectId}/${environmentId}/${ctx.refId}`;
      const copy = await this.executor.execFile('scp', [...this.scpArgs(keyPath, knownHostsPath, target.port), bootstrapEnvPath, `${remote}:${remoteDir}/${path.basename(bootstrapEnvPath)}`], { timeout: 120 });
      if (copy.exitCode !== 0) return this.resultFrom(copy, 'Bootstrap credential transfer failed');
      const projectName = `launchly_${projectId}_${environmentId}`.replace(/-/g, '_');
      const command = `set -eu; trap "rm -f '${remoteDir}/${path.basename(bootstrapEnvPath)}'" EXIT; set -a; . '${remoteDir}/${path.basename(bootstrapEnvPath)}'; set +a; docker compose --project-name '${projectName}' --env-file '${remoteDir}/${ctx.refId}.env' -f '${remoteDir}/${ctx.refId}.compose.yml' exec -T -e LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME -e LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL -e LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD app sh -lc ${this.shellQuote(bootstrapAdminCommand)}`;
      await ctx.stageLogCallback?.('RUNNING', 'Running the project-declared admin bootstrap command inside the application container...');
      const result = await this.executor.execFile('ssh', [...this.sshArgs(keyPath, knownHostsPath, target.port), remote, command], { timeout: 300 });
      if (result.exitCode !== 0) {
        await this.prisma.projectBootstrapRun.upsert({
          where: { projectId_environmentId: { projectId, environmentId } },
          create: { projectId, environmentId, deploymentId: ctx.refId, status: 'FAILED', lastError: 'Bootstrap command failed' },
          update: { deploymentId: ctx.refId, status: 'FAILED', lastError: 'Bootstrap command failed' },
        });
        return this.failure('Application admin bootstrap command failed');
      }
      await this.prisma.projectBootstrapRun.upsert({
        where: { projectId_environmentId: { projectId, environmentId } },
        create: { projectId, environmentId, deploymentId: ctx.refId, status: 'SUCCEEDED', completedAt: new Date() },
        update: { deploymentId: ctx.refId, status: 'SUCCEEDED', completedAt: new Date(), lastError: null },
      });
      return { success: true, stdout: 'Application admin bootstrap completed', stderr: '', exitCode: 0, errorMessage: '' };
    } catch (error: any) {
      return this.failure(error?.message || 'Application admin bootstrap failed');
    } finally {
      for (const file of [keyPath, knownHostsPath, bootstrapEnvPath]) if (file) this.safeUnlink(file);
    }
  }

  private sshArgs(keyPath: string, knownHostsPath: string, port: number): string[] {
    return ['-i', keyPath, '-p', String(port), '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsPath}`];
  }

  private scpArgs(keyPath: string, knownHostsPath: string, port: number): string[] {
    return ['-i', keyPath, '-P', String(port), '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsPath}`];
  }

  private async getEnvironmentVariables(environmentId: string): Promise<Record<string, string>> {
    const vars = await this.prisma.environmentVariable.findMany({ where: { environmentId } });
    return Object.fromEntries(vars.map(variable => [variable.key, this.secrets.decrypt(variable.encryptedValue)]));
  }

  private generateEnvFile(values: Record<string, string>): string {
    return Object.entries(values).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes('\u0000') || value.includes('\n')) throw new Error(`Invalid environment variable: ${key}`);
      return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }).join('\n');
  }

  private generateComposeFile(imageName: string, externalPort: number, containerPort: number, envFilename: string, proxyAlias?: string): string {
    const proxyNetwork = proxyAlias
      ? `    networks:\n      ${PROXY_NETWORK}:\n        aliases:\n          - ${proxyAlias}\nnetworks:\n  ${PROXY_NETWORK}:\n    external: true\n`
      : '';
    return `services:\n  app:\n    image: ${imageName}\n    env_file:\n      - ./${envFilename}\n    ports:\n      - "${externalPort}:${containerPort}"\n    restart: unless-stopped\n${proxyNetwork}`;
  }

  private shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

  private generateNginxConfig(domain: string, upstream: string, port: number): string {
    return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n\n  location / {\n    proxy_pass http://${upstream}:${port};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n  }\n}\n`;
  }

  private proxyBootstrapCommand(targetRoot: string): string {
    const proxyRoot = `${targetRoot}/proxy`;
    return `set -eu; mkdir -p '${proxyRoot}/conf.d'; chmod 755 '${proxyRoot}' '${proxyRoot}/conf.d'; docker network inspect '${PROXY_NETWORK}' >/dev/null 2>&1 || docker network create '${PROXY_NETWORK}' >/dev/null; docker container inspect '${PROXY_CONTAINER}' >/dev/null 2>&1 || docker run -d --name '${PROXY_CONTAINER}' --restart unless-stopped --network '${PROXY_NETWORK}' -p 80:80 -v '${proxyRoot}/conf.d:/etc/nginx/conf.d:ro' nginx:1.27.5-alpine >/dev/null`;
  }

  private normalizeDomain(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const domain = value.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Invalid domain for Nginx route');
    return domain;
  }

  private isSafeId(value: unknown): value is string { return typeof value === 'string' && SAFE_ID.test(value); }
  private targetRoot(value: unknown): string {
    const root = typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : DEFAULT_TARGET_WORK_ROOT;
    if (!SAFE_WORK_ROOT.test(root) || root === '/') throw new Error('Deploy target work root is invalid');
    return root;
  }
  private safeUnlink(file: string) { try { fs.unlinkSync(file); } catch { /* cleanup only */ } }
  private failure(message: string): RunnerResult { return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message }; }
  private resultFrom(result: { stdout: string; stderr: string; exitCode: number }, message: string): RunnerResult { return { success: false, ...result, errorMessage: message }; }
}
