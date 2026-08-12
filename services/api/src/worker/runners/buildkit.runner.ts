import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CommandExecutor } from './command.executor';
import { RunnerContext, RunnerResult } from './runner.factory';

const BUILD_ROOT = '/tmp/launchly-builds';

/** Builds only through a remote BuildKit daemon and records the registry digest. */
@Injectable()
export class BuildkitRunner {
  constructor(private readonly prisma: PrismaService, private readonly executor: CommandExecutor) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: ctx.refId }, include: { project: true } });
    if (!deployment) return this.failure('Deployment not found');
    const repository = deployment.project.registryRepository || process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY;
    const address = process.env.LAUNCHLY_BUILDKIT_ADDR;
    if (!repository || !address) return this.failure('BuildKit address and project registry repository are required');
    if (!/^[a-z0-9][a-z0-9./:_-]*$/i.test(repository)) return this.failure('Registry repository contains unsupported characters');
    const workDir = path.join(BUILD_ROOT, ctx.refId);
    if (!fs.existsSync(workDir)) return this.failure('Build context is missing');
    const dockerfile = fs.existsSync(path.join(workDir, 'Dockerfile')) ? 'Dockerfile' : 'Dockerfile.launchly';
    if (!fs.existsSync(path.join(workDir, dockerfile))) fs.writeFileSync(path.join(workDir, dockerfile), this.implicitDockerfile(ctx.payload), { mode: 0o600 });
    const tag = `${this.safeTag(deployment.commitSha)}-${ctx.refId}`;
    const imageRef = `${repository}:${tag}`;
    const metadataPath = path.join(workDir, 'build-metadata.json');
    await ctx.stageLogCallback?.('RUNNING', `Building and pushing immutable image ${repository}:<redacted-tag>...`);
    const result = await this.executor.execFile('buildctl', [
      '--addr', address, 'build', '--frontend', 'dockerfile.v0',
      '--local', `context=${workDir}`, '--local', `dockerfile=${workDir}`, '--opt', `filename=${dockerfile}`,
      '--output', `type=image,name=${imageRef},push=true`, '--metadata-file', metadataPath,
    ], { timeout: 1800 });
    if (result.exitCode !== 0) return { success: false, ...result, errorMessage: 'BuildKit build or registry push failed' };
    const digest = this.readDigest(metadataPath);
    if (!digest) return this.failure('BuildKit did not return an OCI image digest');
    await this.prisma.artifact.upsert({
      where: { deploymentId: deployment.id },
      create: { deploymentId: deployment.id, projectId: deployment.projectId, imageRef: repository, digest, commitSha: deployment.commitSha, sbomStatus: 'PENDING' },
      update: { imageRef: repository, digest, commitSha: deployment.commitSha },
    });
    await this.prisma.deployment.update({ where: { id: deployment.id }, data: { artifactDigest: digest } });
    return { success: true, stdout: `${result.stdout}\nOCI digest: ${digest}`, stderr: result.stderr, exitCode: 0, errorMessage: '' };
  }

  private readDigest(file: string): string | null {
    try {
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      const digest = metadata['containerimage.digest'] || metadata['containerimage.config.digest'];
      return typeof digest === 'string' && digest.startsWith('sha256:') ? digest : null;
    } catch { return null; }
  }
  private safeTag(value?: string | null): string { return /^[a-f0-9]{7,64}$/i.test(value || '') ? value!.slice(0, 12).toLowerCase() : 'unknown'; }
  private implicitDockerfile(payload: Record<string, any>): string {
    const port = Number(payload.containerPort || payload.port || 3000);
    return `FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN ${payload.installCommand || 'npm ci'}\nCOPY . .\nRUN ${payload.buildCommand || 'npm run build'}\nEXPOSE ${port}\nCMD ${payload.startCommand || 'npm start'}\n`;
  }
  private failure(message: string): RunnerResult { return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message }; }
}
