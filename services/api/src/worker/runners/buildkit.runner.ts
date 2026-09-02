import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CommandExecutor } from './command.executor';
import { RunnerContext, RunnerResult } from './runner.factory';
import { BUILD_ROOT, buildContextDir } from './build-context';

/** Builds only through a remote BuildKit daemon and records the registry digest. */
@Injectable()
export class BuildkitRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: CommandExecutor,
  ) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    let workDir: string;
    try {
      workDir = buildContextDir(ctx.refId);
    } catch (error: any) {
      return this.failure(error?.message || 'Invalid refId');
    }
    let completed = false;
    let registryAuthDir: string | null = null;
    try {
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: ctx.refId },
        include: { project: true },
      });
      if (!deployment) return this.failure('Deployment not found');
      const repository = deployment.project.registryRepository || process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY;
      const address = process.env.LAUNCHLY_BUILDKIT_ADDR;
      if (!repository || !address) return this.failure('BuildKit address and project registry repository are required');
      if (!/^[a-z0-9][a-z0-9./:_-]*$/i.test(repository))
        return this.failure('Registry repository contains unsupported characters');
      if (!fs.existsSync(workDir)) return this.failure('Build context is missing');
      const dockerfile = fs.existsSync(path.join(workDir, 'Dockerfile')) ? 'Dockerfile' : 'Dockerfile.launchly';
      if (!fs.existsSync(path.join(workDir, dockerfile)))
        fs.writeFileSync(path.join(workDir, dockerfile), this.implicitDockerfile(ctx.payload), { mode: 0o600 });
      try {
        registryAuthDir = this.prepareRegistryAuth(ctx.refId);
      } catch (error: any) {
        return this.failure(error?.message || 'Invalid registry authentication configuration');
      }
      const tag = `${this.safeTag(deployment.commitSha)}-${ctx.refId}`;
      const imageRef = `${repository}:${tag}`;
      const metadataPath = path.join(workDir, 'build-metadata.json');
      await ctx.stageLogCallback?.('RUNNING', `Building and pushing immutable image ${repository}:<redacted-tag>...`);
      const result = await this.executor.execFile(
        'buildctl',
        [
          '--addr',
          address,
          'build',
          '--frontend',
          'dockerfile.v0',
          '--local',
          `context=${workDir}`,
          '--local',
          `dockerfile=${workDir}`,
          '--opt',
          `filename=${dockerfile}`,
          '--output',
          `type=image,name=${imageRef},push=true`,
          '--metadata-file',
          metadataPath,
        ],
        {
          timeout: 1800,
          ...(registryAuthDir ? { env: { DOCKER_CONFIG: registryAuthDir } } : {}),
        },
      );
      if (result.exitCode !== 0)
        return {
          success: false,
          stdout: CommandExecutor.sanitize(result.stdout),
          stderr: CommandExecutor.sanitize(result.stderr),
          exitCode: result.exitCode,
          errorMessage: 'BuildKit build or registry push failed',
        };
      const digest = this.readDigest(metadataPath);
      if (!digest) return this.failure('BuildKit did not return an OCI image digest');
      const artifact = await this.prisma.artifact.upsert({
        where: { projectId_digest: { projectId: deployment.projectId, digest } },
        create: {
          deploymentId: deployment.id,
          projectId: deployment.projectId,
          imageRef: repository,
          digest,
          commitSha: deployment.commitSha,
          sbomStatus: 'PENDING',
        },
        update: { imageRef: repository, digest, commitSha: deployment.commitSha },
      });
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: { artifactId: artifact.id, artifactDigest: digest },
      });
      completed = true;
      return {
        success: true,
        stdout: CommandExecutor.sanitize(`${result.stdout}\nOCI digest: ${digest}`),
        stderr: CommandExecutor.sanitize(result.stderr),
        exitCode: 0,
        errorMessage: '',
      };
    } finally {
      // Docker credentials live outside the source context and are removed after every
      // attempt, including failed builds. They must never be retained for task retries.
      if (registryAuthDir) {
        try {
          fs.rmSync(registryAuthDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
      // 失败时保留上下文供同一 PROJECT_BUILD 任务重试；完整成功后删除源码。
      if (completed) {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* 清理失败交给定时清理服务 */
        }
      }
    }
  }

  private readDigest(file: string): string | null {
    try {
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      const digest = metadata['containerimage.digest'] || metadata['containerimage.config.digest'];
      return typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null;
    } catch {
      return null;
    }
  }

  private prepareRegistryAuth(refId: string): string | null {
    const raw = process.env.LAUNCHLY_REGISTRY_AUTH_JSON;
    if (!raw) return null;
    if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) {
      throw new Error('Registry authentication configuration is too large');
    }
    let config: unknown;
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error('Registry authentication configuration is not valid JSON');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Registry authentication configuration must be a JSON object');
    }
    const authDir = path.join(BUILD_ROOT, `.registry-auth-${refId}`);
    fs.rmSync(authDir, { recursive: true, force: true });
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(authDir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
    return authDir;
  }
  private safeTag(value?: string | null): string {
    return /^[a-f0-9]{7,64}$/i.test(value || '') ? value!.slice(0, 12).toLowerCase() : 'unknown';
  }
  private implicitDockerfile(payload: Record<string, any>): string {
    const requestedPort = Number(payload.containerPort || payload.port || 3000);
    const port = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535 ? requestedPort : 3000;
    return `FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN ${payload.installCommand || 'npm ci'}\nCOPY . .\nRUN ${payload.buildCommand || 'npm run build'}\nEXPOSE ${port}\nCMD ${payload.startCommand || 'npm start'}\n`;
  }
  private failure(message: string): RunnerResult {
    return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message };
  }
}
