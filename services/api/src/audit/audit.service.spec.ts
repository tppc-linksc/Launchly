import { AuditService } from './audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuditService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============================================================
  // A. record
  // ============================================================
  describe('A. record', () => {
    it('持久化 detail 为对象时调用 JSON.stringify 写入 detail 字段', async () => {
      const detail = { key: 'value', count: 3 };
      const created = {
        id: 'log-1',
        userId: 'u1',
        workspaceId: 'ws-1',
        action: 'CREATE_PROJECT',
        targetType: 'Project',
        targetId: 'proj-1',
        detail: JSON.stringify(detail),
        createdAt: new Date('2026-08-18T00:00:00.000Z'),
      };
      prisma.auditLog.create.mockResolvedValue(created);

      const result = await service.record('u1', 'ws-1', 'CREATE_PROJECT', 'Project', 'proj-1', detail);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          workspaceId: 'ws-1',
          action: 'CREATE_PROJECT',
          targetType: 'Project',
          targetId: 'proj-1',
          detail: JSON.stringify(detail),
        },
      });
      expect(result).toBe(created);
    });

    it('未提供 detail 时 detail 字段写为 null', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1', detail: null });

      await service.record('u1', 'ws-1', 'DELETE_TARGET', 'DeployTarget', 'tgt-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          detail: null,
          action: 'DELETE_TARGET',
          targetType: 'DeployTarget',
          targetId: 'tgt-1',
        }),
      });
      const call = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.detail).toBeNull();
    });

    it('detail 显式传 undefined 时 detail 字段写为 null', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1', detail: null });

      await service.record('u1', 'ws-1', 'ACTION', 'Type', 'id', undefined);

      const call = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.detail).toBeNull();
    });

    it('复杂 detail 对象会被序列化为合法 JSON 并保留原结构', async () => {
      const detail = { items: [1, 2, 3], nested: { ok: true, msg: 'hello' } };
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1', detail: JSON.stringify(detail) });

      await service.record('u1', 'ws-1', 'X', 'Type', 'id', detail);

      const stored = (prisma.auditLog.create as jest.Mock).mock.calls[0][0].data.detail;
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored as string)).toEqual(detail);
    });

    it('detail 为空对象 {} 时走 truthy 分支序列化为 "{}"', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.record('u1', 'ws-1', 'X', 'Type', 'id', {});

      const stored = (prisma.auditLog.create as jest.Mock).mock.calls[0][0].data.detail;
      // 非空对象走 JSON 分支：truthy 路径
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored as string)).toEqual({});
    });

    it('userId/workspaceId 允许传 null 写入系统事件', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.record(null, null, 'SYSTEM_CRON', 'CronJob', 'job-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          workspaceId: null,
          action: 'SYSTEM_CRON',
          targetType: 'CronJob',
          targetId: 'job-1',
          detail: null,
        }),
      });
    });

    it('Prisma 写入错误原样向上抛出', async () => {
      const dbError = new Error('write error');
      prisma.auditLog.create.mockRejectedValue(dbError);

      await expect(service.record('u1', 'ws-1', 'X', 'Y', 'z')).rejects.toBe(dbError);
    });
  });

  // ============================================================
  // B. list
  // ============================================================
  describe('B. list', () => {
    it('按 workspaceId 过滤、createdAt desc、应用 take/skip 三个参数', async () => {
      const rows = [{ id: 'log-1' }, { id: 'log-2' }];
      prisma.auditLog.findMany.mockResolvedValue(rows);

      const result = await service.list('ws-1', 25, 10);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { createdAt: 'desc' },
        take: 25,
        skip: 10,
      });
      expect(result).toBe(rows);
    });

    it('未传 limit/offset 时使用默认 limit=50 offset=0', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.list('ws-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('显式传 limit=0 / offset=0 不会修正为默认值', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.list('ws-1', 0, 0);

      const args = (prisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
      expect(args.take).toBe(0);
      expect(args.skip).toBe(0);
    });

    it('工作空间无任何日志时返回空数组', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.list('ws-empty');

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // C. listForExport
  // ============================================================
  describe('C. listForExport', () => {
    it('对导出设置硬上限和一个截断哨兵行，按 createdAt desc 排序', async () => {
      const rows = [
        { id: 'log-1', createdAt: new Date('2026-08-18T00:00:00.000Z') },
        { id: 'log-2', createdAt: new Date('2026-08-17T00:00:00.000Z') },
      ];
      prisma.auditLog.findMany.mockResolvedValue(rows);

      const result = await service.listForExport('ws-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { createdAt: 'desc' },
        take: 10001,
      });
      const args = (prisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
      expect(args.take).toBe(10001);
      expect(args.skip).toBeUndefined();
      expect(result).toBe(rows);
    });

    it('无日志时返回空数组', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.listForExport('ws-empty');

      expect(result).toEqual([]);
    });
  });
});
