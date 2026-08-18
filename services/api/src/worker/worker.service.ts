import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { PrismaService } from '../common/prisma/prisma.service';
import { RunnerFactory } from './runners/runner.factory';
import { CommandExecutor } from './runners/command.executor';
import { resolveBoundedInt } from '../common/config/env-integer';
import {
  ROLLBACK_STEP_ORDER,
  finalizeTimedOutTask,
  isDeploymentStagesComplete,
  mapTaskTypeToStage,
  rescheduleTimedOutTask,
} from './worker-state-machine';

/**
 * Worker 主服务（KI-025 / KI-026 / KI-027 / KI-028 / KI-029）。
 *
 * 负责：
 * - 心跳（15s 一次）。
 * - 任务轮询和租约领取。
 * - 超时任务回收（1 分钟一次）。
 * - 任务执行入口（交给 RunnerFactory）。
 *
 * 集中状态机规则放在 ./worker-state-machine.ts，本文件只保留编排逻辑。
 *
 * 关键约束：
 * - 未知任务类型 fail closed（KI-025）：不再静默 SUCCEEDED。
 * - 非对象 payload 拒绝执行（KI-025）。
 * - 部署完成必须经过严格 isDeploymentStagesComplete（KI-026）：空集合不能算成功。
 * - 阶段日志与 Runner 错误先经过 CommandExecutor.sanitize，再持久化（KI-028）。
 * - 自动回滚使用 ROLLBACK_STEP_ORDER=6 > HEALTH_CHECK 的 5（KI-029）。
 */

const DEFAULT_TASK_TIMEOUT_MINUTES = 30;
const MIN_TASK_TIMEOUT_MINUTES = 1;
const MAX_TASK_TIMEOUT_MINUTES = 24 * 60;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 60_000;

interface TaskRow {
  id: string;
  taskType: string;
  refId: string;
  payload: string | null;
  attempts: number;
  maxAttempts: number;
  started_at?: Date | null;
  status?: string;
}

@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerService.name);
  private readonly taskTimeoutMinutes = resolveBoundedInt(
    process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES,
    DEFAULT_TASK_TIMEOUT_MINUTES,
    MIN_TASK_TIMEOUT_MINUTES,
    MAX_TASK_TIMEOUT_MINUTES,
    'LAUNCHLY_WORKER_TIMEOUT_MINUTES',
  );
  private readonly workerId = process.env.LAUNCHLY_WORKER_ID || `${hostname()}:${process.pid}`;
  private static readonly POLL_INTERVAL_MS = resolveBoundedInt(
    process.env.LAUNCHLY_WORKER_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
    'LAUNCHLY_WORKER_POLL_INTERVAL_MS',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly runnerFactory: RunnerFactory,
  ) {}

  async onModuleInit() {
    await this.heartbeat();
  }

  /** 写入心跳：用于控制面识别活跃 Worker。 */
  @Interval(15000)
  async heartbeat() {
    await this.prisma.workerHeartbeat.upsert({
      where: { workerId: this.workerId },
      create: { workerId: this.workerId, status: 'READY', details: JSON.stringify({ pid: process.pid }) },
      update: { status: 'READY', details: JSON.stringify({ pid: process.pid }) },
    });
  }

  /** 主轮询：认领下一个可执行任务并执行。 */
  @Interval(WorkerService.POLL_INTERVAL_MS)
  async poll() {
    const task = await this.claimNextTask();
    if (!task) return;
    this.logger.log(`Worker claimed task ${task.id} type=${task.taskType} refId=${task.refId}`);
    try {
      await this.executeTask(task);
    } catch (e: any) {
      this.logger.error(`Task ${task.id} execution failed: ${e?.message}`, e?.stack);
      await this.handleTaskFailure(task, e?.message || '执行失败');
    }
  }

  /** 超时回收：把超时但未完成的任务按重试预算处理。 */
  @Interval(60000)
  async timeoutStuckTasks() {
    const cutoff = new Date(Date.now() - this.taskTimeoutMinutes * 60 * 1000);
    const stuckTasks = await this.prisma.task.findMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    });

    // 关键：每个任务独立 try/catch，单条失败不影响其余。
    for (const task of stuckTasks) {
      try {
        await this.recoverTimedOutTask(task);
      } catch (e: any) {
        this.logger.error(`Failed to recover timed-out task ${task.id}: ${e?.message}`);
      }
    }
  }

  /** 把单个超时任务按 attempts 决定回到 PENDING 还是标记 FAILED。 */
  private async recoverTimedOutTask(task: { id: string; attempts: number; maxAttempts: number; refId: string; taskType: string }) {
    this.logger.warn(`Task ${task.id} timed out after ${this.taskTimeoutMinutes} minutes`);
    const errorMessage = `任务超时：已运行超过 ${this.taskTimeoutMinutes} 分钟`;
    const stage = mapTaskTypeToStage(task.taskType);

    if (task.attempts < task.maxAttempts) {
      this.logger.log(`Retrying task ${task.id} (attempt ${task.attempts + 1}/${task.maxAttempts})`);
      await rescheduleTimedOutTask(this.prisma, task.id, errorMessage);
      if (stage) {
        await this.writeStageLog(task.refId, stage, 'RUNNING', `Retry attempt ${task.attempts}/${task.maxAttempts}: ${errorMessage}`);
      }
    } else {
      await finalizeTimedOutTask(this.prisma, task.id, errorMessage);
      await this.failDeployment(task.refId, '任务超时失败，已无重试次数');
    }
  }

  /** 原子领取下一个可执行任务：使用 SKIP LOCKED 防止并发冲突。 */
  private async claimNextTask() {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await tx.$queryRaw<TaskRow[]>`
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

  /** 任务执行入口：解析 payload → 写 RUNNING stageLog → 调用 Runner → 写终态。 */
  private async executeTask(task: { id: string; taskType: string; refId: string; payload: string | null; attempts: number; maxAttempts: number }) {
    const deploymentId = task.refId;
    const stage = mapTaskTypeToStage(task.taskType);
    if (!stage) {
      // KI-025: 未知任务类型 fail closed，避免静默 SUCCEEDED。
      await this.handleTaskFatalFailure(task, `未知的任务类型: ${task.taskType}`);
      return;
    }

    // KI-025: payload 必须存在且为对象（数组/字符串/数字/null 全部拒绝）。
    const payload = this.parseStrictObjectPayload(task.payload, task);
    if (!payload) return;

    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (deployment && deployment.status === 'PENDING') {
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
    }

    await this.writeStageLog(deploymentId, stage, 'RUNNING', `Starting ${task.taskType}...`);

    const result = await this.runnerFactory.execute(task.taskType, {
      taskType: task.taskType,
      refId: deploymentId,
      payload,
      stageLogCallback: async (status: string, logText: string) => {
        await this.writeStageLog(deploymentId, stage, status, logText);
      },
    });

    // KI-028: 终态日志统一走脱敏。
    const stageStatus = result.success ? 'SUCCEEDED' : 'FAILED';
    const sanitizedLog = CommandExecutor.sanitize(result.success ? result.stdout : `${result.errorMessage}\n${result.stdout}`);
    await this.writeStageLogFinal(deploymentId, stage, stageStatus, sanitizedLog);

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

  /** 严格解析 payload：空/null/非对象/数组 全部拒绝（KI-025）。返回 null 表示已记错误。 */
  private parseStrictObjectPayload(payload: string | null, task: { id: string; refId: string; taskType: string }): Record<string, any> | null {
    if (typeof payload !== 'string' || payload.trim() === '') {
      // 兼容历史空 payload：当作空对象，但要求是 JSON 字符串或为空。
      // 为 fail closed，这里统一视为非法。
      void this.handleTaskFatalFailure(task, '任务负载为空');
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (e: any) {
      void this.handleTaskFatalFailure(task, `任务负载解析失败: ${e?.message}`);
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      void this.handleTaskFatalFailure(task, '任务负载必须是 JSON 对象');
      return null;
    }
    return parsed as Record<string, any>;
  }

  /** KI-025: 立即把任务标记 FAILED 并清除租约（不再回到 PENDING 等待重试）。 */
  private async handleTaskFatalFailure(task: { id: string; refId: string }, errorMessage: string) {
    this.logger.error(`Task ${task.id} fatal failure: ${errorMessage}`);
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        errorMessage,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    await this.failDeployment(task.refId, errorMessage);
  }

  /** 普通失败：按 attempts 决定重试还是终态。 */
  private async handleTaskFailure(task: { id: string; refId: string; taskType: string; attempts: number; maxAttempts: number }, errorMessage: string) {
    if (task.attempts < task.maxAttempts) {
      this.logger.log(`Task ${task.id} failed, retrying (attempt ${task.attempts}/${task.maxAttempts}): ${errorMessage}`);
      const stage = mapTaskTypeToStage(task.taskType);
      if (stage) {
        await this.writeStageLog(task.refId, stage, 'RUNNING', `Retry attempt ${task.attempts}/${task.maxAttempts}: ${errorMessage}`);
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

  /** 根据已完成的任务类型，决定下一阶段任务类型。 */
  private async enqueueNextStage(completedTask: { taskType: string; refId: string; payload: string | null }) {
    const payload = this.parsePayload(completedTask.payload);
    const nextTypeMap: Record<string, string> = {
      REPO_CLONE: 'PROJECT_BUILD',
      PROJECT_IMAGE_PREPARE: 'PROJECT_DEPLOY',
      TEMPLATE_SOURCE: 'PROJECT_BUILD',
      PROJECT_BUILD: 'PROJECT_DEPLOY',
      PROJECT_DEPLOY: payload.bootstrapAdminEnabled ? 'PROJECT_BOOTSTRAP' : 'HEALTH_CHECK',
      PROJECT_BOOTSTRAP: 'HEALTH_CHECK',
    };
    const next = nextTypeMap[completedTask.taskType];
    if (!next) return;

    await this.prisma.task.create({
      data: {
        taskType: next,
        refId: completedTask.refId,
        payload: completedTask.payload || '{}',
        idempotencyKey: `${next}:${completedTask.refId}`,
      },
    });
  }

  private async writeStageLog(deploymentId: string, stage: string, status: string, logText: string) {
    const existing = await this.prisma.deploymentStageLog.findFirst({ where: { deploymentId, stage } });
    if (!existing) return;
    // KI-028: 即使中间日志也走脱敏，避免 RUNNING 重试日志泄露秘密。
    const sanitized = CommandExecutor.sanitize(logText);
    const newLog = existing.log ? `${existing.log}\n${sanitized}` : sanitized;
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
    const existing = await this.prisma.deploymentStageLog.findFirst({ where: { deploymentId, stage } });
    if (!existing) return;
    await this.prisma.deploymentStageLog.update({
      where: { id: existing.id },
      data: { status, log: logText, finishedAt: new Date() },
    });
  }

  /** KI-026: 用严格状态机判定部署是否全部阶段完成。 */
  private async checkAndUpdateDeployment(deploymentId: string) {
    const logs = await this.prisma.deploymentStageLog.findMany({ where: { deploymentId } });
    if (!isDeploymentStagesComplete(logs)) return;

    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) return;

    const accessUrl = await this.computeAccessUrl(deployment);
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), accessUrl },
    });
    await this.prisma.environment.update({
      where: { id: deployment.environmentId },
      data: { status: 'active', currentDeploymentId: deploymentId },
    });
  }

  private async computeAccessUrl(deployment: { id: string; accessUrl: string | null; environmentId: string; deployTargetId: string | null }): Promise<string> {
    if (deployment.accessUrl) return deployment.accessUrl;
    const env = await this.prisma.environment.findUnique({ where: { id: deployment.environmentId } });
    const port = env?.externalPort || 3000;
    let host = 'localhost';
    if (deployment.deployTargetId) {
      const target = await this.prisma.deployTarget.findUnique({ where: { id: deployment.deployTargetId } });
      if (target) host = target.host;
    }
    return `http://${host}:${port}`;
  }

  private async failDeployment(deploymentId: string, errorMessage: string) {
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', errorMessage: errorMessage, finishedAt: new Date() },
    });
    await this.scheduleAutomaticRollback(deploymentId, errorMessage);
  }

  /**
   * 自动回滚：上一成功部署 + 同一 DeployTarget + 未发起过回滚时，
   * 创建 ROLLBACK 阶段日志和回滚任务。KI-029：使用独立 stepOrder=6。
   */
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
        data: {
          deploymentId,
          stage: 'ROLLBACK',
          stepOrder: ROLLBACK_STEP_ORDER,
          status: 'PENDING',
          log: `Automatic rollback scheduled after: ${errorMessage}`,
        },
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

  private parsePayload(payload: string | null): Record<string, any> {
    if (!payload) return {};
    try { return JSON.parse(payload); } catch { return {}; }
  }
}
