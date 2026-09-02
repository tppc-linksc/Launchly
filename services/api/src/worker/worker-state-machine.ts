import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Worker 状态机辅助模块（KI-025 / KI-026 / KI-027）。
 *
 * 集中处理以下事项，避免 WorkerService 单文件膨胀：
 * - 部署是否"所有 StageLog 都成功"的判定：必须非空且全部 SUCCEEDED/SKIPPED，
 *   防止空集合被 every() 当作 true 错误标记 SUCCEEDED。
 * - 超时任务的 PENDING/FAILED 原子化转换；attempts 与 lease 一致重置。
 * - 自动回滚阶段的 stepOrder 与正常 HEALTH_CHECK 错开（KI-029）。
 */

/** 阶段状态机收敛集合：SUCCEEDED 或 SKIPPED 视为阶段完成。 */
const STAGE_TERMINAL_STATUSES = new Set(['SUCCEEDED', 'SKIPPED']);

/** 自动回滚的阶段顺序：6 > HEALTH_CHECK 的 5，确保 UI 时间线顺序稳定（KI-029）。 */
export const ROLLBACK_STEP_ORDER = 6;

export interface StageLog {
  status: string | null;
}

/**
 * 判定一个部署是否可以视为成功（KI-026 修复）：
 * - 必须有阶段日志；空集合视为未完成。
 * - 全部状态属于 STAGE_TERMINAL_STATUSES。
 * - 不存在任何 RUNNING 或 PENDING 的阶段。
 */
export function isDeploymentStagesComplete(logs: StageLog[]): boolean {
  if (!logs || logs.length === 0) return false;
  return logs.every((l) => l.status !== null && STAGE_TERMINAL_STATUSES.has(l.status));
}

/** 根据 TaskType 映射到对应 Stage 名。未知返回 null。 */
export function mapTaskTypeToStage(taskType: string): string | null {
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

/**
 * 把已超时但仍有重试预算的任务原子地回到 PENDING 状态。
 * 关键点：清空 lease、重置运行时间；attempts 在下次原子认领时增加。
 */
export async function rescheduleTimedOutTask(
  prisma: PrismaService,
  taskId: string,
  errorMessage: string,
  leaseOwner?: string | null,
) {
  return prisma.task.update({
    where: { id: taskId, status: 'RUNNING', leaseOwner: leaseOwner ?? null, leaseExpiresAt: { lt: new Date() } },
    data: {
      status: 'PENDING',
      errorMessage,
      startedAt: null,
      finishedAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
}

/** 把已超时且无重试预算的任务标记 FAILED。 */
export async function finalizeTimedOutTask(
  prisma: PrismaService,
  taskId: string,
  errorMessage: string,
  leaseOwner?: string | null,
) {
  return prisma.task.update({
    where: { id: taskId, status: 'RUNNING', leaseOwner: leaseOwner ?? null, leaseExpiresAt: { lt: new Date() } },
    data: {
      status: 'FAILED',
      errorMessage,
      finishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
}
