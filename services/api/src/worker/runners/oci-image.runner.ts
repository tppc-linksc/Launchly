import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RunnerContext, RunnerResult } from './runner.factory';

/** Records an externally-built image as the deployment artifact; pulling happens on the target. */
@Injectable()
export class OciImageRunner {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: ctx.refId }, include: { project: true } });
    if (!deployment?.project.imageReference) return this.failure('OCI image reference is missing');
    const parsed = this.parseImmutableReference(deployment.project.imageReference);
    if (!parsed) return this.failure('OCI image must use a complete sha256 digest reference');
    await this.prisma.artifact.upsert({
      where: { deploymentId: deployment.id },
      create: { deploymentId: deployment.id, projectId: deployment.projectId, imageRef: parsed.imageRef, digest: parsed.digest, commitSha: deployment.commitSha, sbomStatus: 'EXTERNAL' },
      update: { imageRef: parsed.imageRef, digest: parsed.digest, commitSha: deployment.commitSha },
    });
    await this.prisma.deployment.update({ where: { id: deployment.id }, data: { artifactDigest: parsed.digest } });
    return { success: true, stdout: `Using immutable OCI image ${parsed.imageRef}@${parsed.digest}`, stderr: '', exitCode: 0, errorMessage: '' };
  }

  private parseImmutableReference(value: string): { imageRef: string; digest: string } | null {
    const match = value.match(/^([a-z0-9][a-z0-9./:_-]*)@(sha256:[a-f0-9]{64})$/i);
    return match ? { imageRef: match[1], digest: match[2] } : null;
  }
  private failure(message: string): RunnerResult { return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message }; }
}
