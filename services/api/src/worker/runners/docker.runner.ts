import { Injectable, Logger } from '@nestjs/common';
import { RunnerContext, RunnerResult } from './runner.factory';
import { CommandExecutor } from './command.executor';
import { SecretValueService } from '../../environment/secret-value.service';
import * as path from 'path';
import * as fs from 'fs';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class DockerRunner {
  private readonly logger = new Logger(DockerRunner.name);

  constructor(
    private readonly executor: CommandExecutor,
    private readonly secrets: SecretValueService,
  ) {}

  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    const workDir = path.join(BUILD_ROOT, ctx.refId);
    const { projectId, environmentId, port = 3000, healthCheckPath } = ctx.payload;

    try {
      // Get environment variables
      const envVars = await this.getEnvironmentVariables(environmentId);

      // Generate .env file
      const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n');
      fs.writeFileSync(path.join(workDir, '.env.project'), envContent);

      // Generate docker-compose.yml if not exists
      const composePath = path.join(workDir, 'docker-compose.yml');
      if (!fs.existsSync(composePath)) {
        const composeContent = this.generateComposeFile(projectId, port, envVars);
        fs.writeFileSync(composePath, composeContent);
      }

      // Generate Dockerfile if not exists
      const dockerfilePath = path.join(workDir, 'Dockerfile');
      if (!fs.existsSync(dockerfilePath)) {
        const dockerfile = this.generateImplicitDockerfile(ctx.payload);
        fs.writeFileSync(path.join(workDir, 'Dockerfile.launchly'), dockerfile);
      }

      // Deploy with docker compose
      await ctx.stageLogCallback?.('RUNNING', 'Starting docker compose...');
      const result = await this.executor.exec(
        'docker compose -f docker-compose.yml --env-file .env.project up -d --build',
        { cwd: workDir, timeout: 300 },
      );

      if (result.exitCode !== 0) {
        // Cleanup on failure
        await this.executor.exec('docker compose down', { cwd: workDir, timeout: 60 });
        return { success: false, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, errorMessage: 'Docker compose up failed' };
      }

      return { success: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0, errorMessage: '' };
    } catch (e: any) {
      return { success: false, stdout: '', stderr: e.message, exitCode: -1, errorMessage: e.message };
    }
  }

  private async getEnvironmentVariables(environmentId: string): Promise<Record<string, string>> {
    try {
      // This would query the database for environment variables
      return {};
    } catch {
      return {};
    }
  }

  private generateComposeFile(projectId: string, port: number, envVars: Record<string, string>): string {
    return `version: '3.8'
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.launchly
    ports:
      - "${port}:${port}"
    env_file:
      - .env.project
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/"]
      interval: 30s
      timeout: 10s
      retries: 3
`;
  }

  private generateImplicitDockerfile(payload: any): string {
    const { installCommand = 'npm install', buildCommand = 'npm run build', startCommand = 'npm start', port = 3000 } = payload;
    return `FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN ${installCommand}
COPY . .
RUN ${buildCommand}
EXPOSE ${port}
CMD ${startCommand}
`;
  }
}
