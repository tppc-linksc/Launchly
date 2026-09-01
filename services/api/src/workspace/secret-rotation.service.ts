import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from '../environment/secret-value.service';

@Injectable()
export class SecretRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
  ) {}

  /** Re-encrypt every workspace-owned secret with the currently active key. */
  async rotate(workspaceId: string) {
    return this.prisma.$transaction(async tx => {
      const [variables, repositoryCredentials, deployTargets, bootstrapSecrets] = await Promise.all([
        tx.environmentVariable.findMany({
          where: { environment: { project: { workspaceId } } },
          select: { id: true, encryptedValue: true },
        }),
        tx.repositoryCredential.findMany({
          where: { project: { workspaceId } },
          select: { id: true, encryptedValue: true },
        }),
        tx.deployTarget.findMany({
          where: { project: { workspaceId } },
          select: { id: true, encryptedCredential: true },
        }),
        tx.projectBootstrapSecret.findMany({
          where: { project: { workspaceId } },
          select: { projectId: true, encryptedPassword: true },
        }),
      ]);

      for (const row of variables) {
        await tx.environmentVariable.update({
          where: { id: row.id },
          data: { encryptedValue: this.secrets.reencrypt(row.encryptedValue) },
        });
      }
      for (const row of repositoryCredentials) {
        await tx.repositoryCredential.update({
          where: { id: row.id },
          data: { encryptedValue: this.secrets.reencrypt(row.encryptedValue) },
        });
      }
      for (const row of deployTargets) {
        await tx.deployTarget.update({
          where: { id: row.id },
          data: { encryptedCredential: this.secrets.reencrypt(row.encryptedCredential) },
        });
      }
      for (const row of bootstrapSecrets) {
        await tx.projectBootstrapSecret.update({
          where: { projectId: row.projectId },
          data: { encryptedPassword: this.secrets.reencrypt(row.encryptedPassword) },
        });
      }

      return {
        success: true,
        rotated: variables.length + repositoryCredentials.length + deployTargets.length + bootstrapSecrets.length,
      };
    });
  }
}
