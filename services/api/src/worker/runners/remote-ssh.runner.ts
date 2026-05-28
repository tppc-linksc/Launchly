import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { SecretValueService } from '../../environment/secret-value.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class RemoteSshRunner {
  private readonly logger = new Logger(RemoteSshRunner.name);

  constructor(
    private readonly executor: CommandExecutor,
    private readonly secrets: SecretValueService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const workDir = path.join(BUILD_ROOT, ctx.refId);
    const { deployTargetId, environmentId, port = 3000 } = ctx.payload;

    try {
      // Get deploy target
      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployTargetId } });
      if (!target) {
        return { success: false, stdout: '', stderr: '', exitCode: -1, errorMessage: 'Deploy target not found' };
      }

      // Get environment variables
      const envVars = await this.getEnvironmentVariables(environmentId);

      // Step 1: Build Docker image locally
      await ctx.stageLogCallback?.('RUNNING', 'Building Docker image locally...');
      const imageName = `launchly-${ctx.refId}:latest`;

      const buildResult = await this.executor.exec(
        `docker build -t ${imageName} -f Dockerfile.launchly .`,
        { cwd: workDir, timeout: 600 },
      );
      if (buildResult.exitCode !== 0) {
        return { success: false, stdout: buildResult.stdout, stderr: buildResult.stderr, exitCode: buildResult.exitCode, errorMessage: 'Docker build failed' };
      }

      // Step 2: Export image as tar
      await ctx.stageLogCallback?.('RUNNING', 'Exporting Docker image...');
      const tarPath = path.join(BUILD_ROOT, `${ctx.refId}.tar`);
      await this.executor.exec(`docker save ${imageName} -o ${tarPath}`, { timeout: 120 });

      // Step 3: SCP transfer to remote
      await ctx.stageLogCallback?.('RUNNING', `Transferring image to ${target.host}...`);
      const credential = this.secrets.decrypt(target.encryptedCredential);
      const sshArgs = this.buildSshArgs(target, credential);
      await this.executor.exec(`scp ${sshArgs} ${tarPath} ${target.username}@${target.host}:/tmp/launchly-image.tar`, { timeout: 600 });

      // Step 4: Load image on remote
      await ctx.stageLogCallback?.('RUNNING', 'Loading image on remote...');
      await this.executor.exec(`ssh ${sshArgs} ${target.username}@${target.host} "docker load -i /tmp/launchly-image.tar"`, { timeout: 120 });

      // Step 5: Generate and upload compose file
      const composeContent = this.generateComposeFile(ctx.refId, port, envVars);
      const composePath = path.join(BUILD_ROOT, `${ctx.refId}-docker-compose.yml`);
      fs.writeFileSync(composePath, composeContent);
      await this.executor.exec(`scp ${sshArgs} ${composePath} ${target.username}@${target.host}:/tmp/docker-compose.yml`, { timeout: 60 });

      // Step 6: Deploy on remote
      await ctx.stageLogCallback?.('RUNNING', 'Deploying on remote...');
      const deployResult = await this.executor.exec(
        `ssh ${sshArgs} ${target.username}@${target.host} "cd /tmp && docker compose -f docker-compose.yml up -d --build"`,
        { timeout: 300 },
      );

      if (deployResult.exitCode !== 0) {
        return { success: false, stdout: deployResult.stdout, stderr: deployResult.stderr, exitCode: deployResult.exitCode, errorMessage: 'Remote deploy failed' };
      }

      // Cleanup
      fs.unlinkSync(tarPath);
      fs.unlinkSync(composePath);

      return { success: true, stdout: deployResult.stdout, stderr: deployResult.stderr, exitCode: 0, errorMessage: '' };
    } catch (e: any) {
      return { success: false, stdout: '', stderr: e.message, exitCode: -1, errorMessage: e.message };
    }
  }

  private buildSshArgs(target: any, credential: string): string {
    if (target.authMethod === 'KEY') {
      const keyPath = `/tmp/launchly-key-${target.id}`;
      fs.writeFileSync(keyPath, credential, { mode: 0o600 });
      return `-i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${target.port}`;
    }
    return `-o StrictHostKeyChecking=accept-new -p ${target.port}`;
  }

  private async getEnvironmentVariables(environmentId: string): Promise<Record<string, string>> {
    try {
      const vars = await this.prisma.environmentVariable.findMany({
        where: { environmentId },
      });
      const result: Record<string, string> = {};
      for (const v of vars) {
        try {
          result[v.key] = this.secrets.decrypt(v.encryptedValue);
        } catch {
          result[v.key] = v.encryptedValue;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private generateComposeFile(projectId: string, port: number, envVars: Record<string, string>): string {
    return `version: '3.8'
services:
  app:
    image: launchly-${projectId}:latest
    ports:
      - "${port}:${port}"
    environment:
${Object.entries(envVars).map(([k, v]) => `      - ${k}=${v}`).join('\n')}
    restart: unless-stopped
`;
  }
}
