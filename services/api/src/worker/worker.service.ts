import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { PrismaService } from '../common/prisma/prisma.service';
import { RunnerFactory } from './runners/runner.factory';
import { CommandExecutor } from './runners/command.executor';

@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerService.name);
  private readonly taskTimeoutMinutes = parseInt(process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES || '30');
  private readonly workerId = process.env.LAUNCHLY_WORKER_ID || `${hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runnerFactory: RunnerFactory,
  ) {}

  async onModuleInit() {
    await this.heartbeat();
  }

  @Interval(15000)
  async heartbeat() {
    await this.prisma.workerHeartbeat.upsert({
      where: { workerId: this.workerId },
      create: { workerId: this.workerId, status: 'READY', details: JSON.stringify({ pid: process.pid }) },
      update: { status: 'READY', details: JSON.stringify({ pid: process.pid }) },
    });
  }

  @Interval(parseInt(process.env.LAUNCHLY_WORKER_POLL_INTERVAL_MS || '3000'))
  async poll() {
    const task = await this.claimNextTask();
    if (!task) return;

    this.logger.log(`Worker claimed task ${task.id} type=${task.taskType} refId=${task.refId}`);

    try {
      await this.executeTask(task);
    } catch (e: any) {
      this.logger.error(`Task ${task.id} execution failed: ${e.message}`, e.stack);
      await this.handleTaskFailure(task, e.message);
    }
  }

  @Interval(60000)
  async timeoutStuckTasks() {
    const cutoff = new Date(Date.now() - this.taskTimeoutMinutes * 60 * 1000);

    const stuckTasks = await this.prisma.task.findMany({
      where: {
        status: 'RUNNING',
        startedAt: { lt: cutoff },
      },
    });

    for (const task of stuckTasks) {
      this.logger.warn(`Task ${task.id} timed out after ${this.taskTimeoutMinutes} minutes`);

      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          errorMessage: `任务超时：已运行超过 ${this.taskTimeoutMinutes} 分钟`,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      if (task.attempts < task.maxAttempts) {
        this.logger.log(`Retrying task ${task.id} (attempt ${task.attempts + 1}/${task.maxAttempts})`);
        await this.retryTask(task.id);
      } else {
        await this.failDeployment(task.refId, '任务超时失败，已无重试次数');
      }
    }
  }

  private async claimNextTask() {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await tx.$queryRaw<any[]>`
        SELECT *
        FROM tasks
        WHERE (status = 'PENDING' OR (status = 'RUNNING' AND lease_expires_at < NOW()))
          AND attempts < max_attempts
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;

      if (!tasks.length) return null;

      const task = tasks[0];
      return tx.task.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
          startedAt: task.started_at || new Date(),
          ...(task.status === 'PENDING' ? { attempts: { increment: 1 } } : {}),
          leaseOwner: this.workerId,
          leaseExpiresAt: new Date(Date.now() + this.taskTimeoutMinutes * 60 * 1000),
        },
      });
    });
  }

  private async executeTask(task: any) {
    const payload = this.parsePayload(task.payload);
    const deploymentId = task.refId;

    const stage = this.mapTaskTypeToStage(task.taskType);
    if (!stage) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      return;
    }

    // Update deployment status to RUNNING
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (deployment && deployment.status === 'PENDING') {
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
    }

    // Write stage log RUNNING
    await this.writeStageLog(deploymentId, stage, 'RUNNING', `Starting ${task.taskType}...`);

    // Dispatch to runner
    const result = await this.runnerFactory.execute(task.taskType, {
      taskType: task.taskType,
      refId: deploymentId,
      payload,
      stageLogCallback: async (status: string, logText: string) => {
        await this.writeStageLog(deploymentId, stage, status, logText);
      },
    });

    // Write stage log result
    const stageStatus = result.success ? 'SUCCEEDED' : 'FAILED';
    const stageLog = result.success ? result.stdout : `${result.errorMessage}\n${result.stdout}`;
    await this.writeStageLogFinal(deploymentId, stage, stageStatus, stageLog);

    // Update task status
    if (result.success) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      await this.enqueueNextStage(task);
      if (task.taskType === 'ROLLBACK_DEPLOY') {
        await this.prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'ROLLED_BACK', finishedAt: new Date() } });
      } else {
        await this.checkAndUpdateDeployment(deploymentId);
      }
    } else {
      await this.handleTaskFailure(task, result.errorMessage);
    }
  }

  private async handleTaskFailure(task: any, errorMessage: string) {
    if (task.attempts < task.maxAttempts) {
      this.logger.log(`Task ${task.id} failed, retrying (attempt ${task.attempts}/${task.maxAttempts}): ${errorMessage}`);

      const stage = this.mapTaskTypeToStage(task.taskType);
      if (stage) {
        await this.writeStageLog(task.refId, stage, 'RUNNING',
          `Retry attempt ${task.attempts}/${task.maxAttempts}: ${errorMessage}`);
      }

      await this.retryTask(task.id);
    } else {
      this.logger.error(`Task ${task.id} failed permanently after ${task.attempts} attempts: ${errorMessage}`);

      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'FAILED', errorMessage, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });

      await this.failDeployment(task.refId, errorMessage);
    }
  }

  private async retryTask(taskId: string) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'PENDING',
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async enqueueNextStage(completedTask: any) {
    const nextType: Record<string, string> = {
      REPO_CLONE: 'PROJECT_BUILD',
      PROJECT_IMAGE_PREPARE: 'PROJECT_DEPLOY',
      TEMPLATE_SOURCE: 'PROJECT_BUILD',
      PROJECT_BUILD: 'PROJECT_DEPLOY',
      PROJECT_DEPLOY: this.parsePayload(completedTask.payload).bootstrapAdminEnabled ? 'PROJECT_BOOTSTRAP' : 'HEALTH_CHECK',
      PROJECT_BOOTSTRAP: 'HEALTH_CHECK',
    };
    const next = nextType[completedTask.taskType];
    if (!next) return;

    await this.prisma.task.create({
      data: {
        taskType: next,
        refId: completedTask.refId,
        payload: completedTask.payload,
        idempotencyKey: `${next}:${completedTask.refId}`,
      },
    });
  }

  private async writeStageLog(deploymentId: string, stage: string, status: string, logText: string) {
    const existing = await this.prisma.deploymentStageLog.findFirst({
      where: { deploymentId, stage },
    });
    if (!existing) return;

    const newLog = existing.log ? `${existing.log}\n${logText}` : logText;
    await this.prisma.deploymentStageLog.update({
      where: { id: existing.id },
      data: {
        status,
        log: newLog,
        ...(status === 'RUNNING' && !existing.startedAt ? { startedAt: new Date() } : {}),
      },
    });
  }

  private async writeStageLogFinal(deploymentId: string, stage: string, status: string, logText: string) {
    const existing = await this.prisma.deploymentStageLog.findFirst({
      where: { deploymentId, stage },
    });
    if (!existing) return;

    await this.prisma.deploymentStageLog.update({
      where: { id: existing.id },
      data: {
        status,
        log: CommandExecutor.sanitize(logText),
        finishedAt: new Date(),
      },
    });
  }

  private async checkAndUpdateDeployment(deploymentId: string) {
    const logs = await this.prisma.deploymentStageLog.findMany({
      where: { deploymentId },
    });
    const allSucceeded = logs.every(l => l.status === 'SUCCEEDED' || l.status === 'SKIPPED');

    if (allSucceeded) {
      const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
      if (!deployment) return;

      // Compute access URL
      let accessUrl = deployment.accessUrl;
      if (!accessUrl) {
        const env = await this.prisma.environment.findUnique({ where: { id: deployment.environmentId } });
        const port = env?.externalPort || 3000;
        let host = 'localhost';
        if (deployment.deployTargetId) {
          const target = await this.prisma.deployTarget.findUnique({ where: { id: deployment.deployTargetId } });
          if (target) host = target.host;
        }
        accessUrl = `http://${host}:${port}`;
      }

      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), accessUrl },
      });

      // Update environment
      await this.prisma.environment.update({
        where: { id: deployment.environmentId },
        data: { status: 'active', currentDeploymentId: deploymentId },
      });
    }
  }

  private async failDeployment(deploymentId: string, errorMessage: string) {
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', errorMessage, finishedAt: new Date() },
    });
    await this.scheduleAutomaticRollback(deploymentId, errorMessage);
  }

  private async scheduleAutomaticRollback(deploymentId: string, errorMessage: string) {
    const failed = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!failed?.deployTargetId) return;
    const environment = await this.prisma.environment.findUnique({ where: { id: failed.environmentId } });
    const previousId = environment?.currentDeploymentId;
    if (!previousId || previousId === deploymentId) return;
    const previous = await this.prisma.deployment.findUnique({ where: { id: previousId } });
    if (!previous || previous.status !== 'SUCCEEDED' || previous.deployTargetId !== failed.deployTargetId) return;
    const exists = await this.prisma.task.findFirst({ where: { taskType: 'ROLLBACK_DEPLOY', refId: deploymentId } });
    if (exists) return;
    await this.prisma.$transaction(async tx => {
      await tx.deploymentStageLog.create({
        data: { deploymentId, stage: 'ROLLBACK', stepOrder: 5, status: 'PENDING', log: `Automatic rollback scheduled after: ${errorMessage}` },
      });
      await tx.task.create({
        data: {
          taskType: 'ROLLBACK_DEPLOY',
          refId: deploymentId,
          idempotencyKey: `rollback:${deploymentId}`,
          payload: JSON.stringify({
            projectId: failed.projectId,
            environmentId: failed.environmentId,
            deployTargetId: failed.deployTargetId,
            rollbackDeploymentId: previousId,
          }),
        },
      });
    });
  }

  private mapTaskTypeToStage(taskType: string): string | null {
    const map: Record<string, string> = {
      REPO_CLONE: 'CLONE',
      PROJECT_IMAGE_PREPARE: 'BUILD',
      TEMPLATE_SOURCE: 'CLONE',
      PROJECT_BUILD: 'BUILD',
      PROJECT_DEPLOY: 'DEPLOY',
      PROJECT_BOOTSTRAP: 'BOOTSTRAP',
      HEALTH_CHECK: 'HEALTH_CHECK',
      ROLLBACK_DEPLOY: 'ROLLBACK',
    };
    return map[taskType] || null;
  }

  private parsePayload(payload: string | null): Record<string, any> {
    if (!payload) return {};
    try { return JSON.parse(payload); } catch { return {}; }
  }
}
