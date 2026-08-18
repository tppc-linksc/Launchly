import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogController } from './audit.controller';
import { AuditService } from './audit.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

/**
 * AuditLogController 单元测试。
 *
 * 控制器只做两件事：
 * - list()：把 query 参数转换为 number，向 auditService.list 传入；
 * - export()：取到数据后拼成 CSV，附带 BOM 与下载头。
 *
 * 由于 CurrentUser 是 createParamDecorator，单元测试里直接调用方法
 * 传入 user 参数，绕开 Nest 反射机制。
 */
describe('AuditLogController', () => {
  let controller: AuditLogController;
  let auditService: { list: jest.Mock; listForExport: jest.Mock };

  beforeEach(async () => {
    auditService = {
      list: jest.fn(),
      listForExport: jest.fn(),
    };
    // 即便 controller 实际只用到 service，这里也保留 prisma mock 以便将来扩展。
    const _prisma: MockPrismaService = createPrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============================================================
  // A. list
  // ============================================================
  describe('A. list', () => {
    it('未传 limit/offset 时使用默认 50 / 0，并把当前工作空间透传', async () => {
      const rows = [{ id: 'log-1' }, { id: 'log-2' }];
      auditService.list.mockResolvedValue(rows);

      const result = await controller.list(
        { userId: 'u1', workspaceId: 'ws-1' },
        undefined,
        undefined,
      );

      expect(auditService.list).toHaveBeenCalledWith('ws-1', 50, 0);
      expect(result).toBe(rows);
    });

    it('limit/offset 为合法数字字符串时按 parseInt 结果传递', async () => {
      auditService.list.mockResolvedValue([]);

      await controller.list(
        { userId: 'u1', workspaceId: 'ws-9' },
        '25',
        '100',
      );

      expect(auditService.list).toHaveBeenCalledWith('ws-9', 25, 100);
    });

    it('limit/offset 为空字符串时按未传处理（默认值生效）', async () => {
      auditService.list.mockResolvedValue([]);

      await controller.list(
        { userId: 'u1', workspaceId: 'ws-1' },
        '',
        '',
      );

      expect(auditService.list).toHaveBeenCalledWith('ws-1', 50, 0);
    });

    it('limit/offset 为非数字字符串时 parseInt 返回 NaN，按当前实现语义原样下传', async () => {
      auditService.list.mockResolvedValue([]);

      await controller.list(
        { userId: 'u1', workspaceId: 'ws-1' },
        'abc',
        'xyz',
      );

      // parseInt('abc') === NaN；当前控制器不做兜底，把 NaN 透传给 service。
      expect(auditService.list).toHaveBeenCalledWith('ws-1', NaN, NaN);
    });

    it('user.workspaceId 为空字符串时也会透传（不抛错）', async () => {
      auditService.list.mockResolvedValue([]);

      await controller.list({ userId: 'u1', workspaceId: '' }, '10', '0');

      expect(auditService.list).toHaveBeenCalledWith('', 10, 0);
    });
  });

  // ============================================================
  // B. export
  // ============================================================
  describe('B. export', () => {
    it('设置正确的 Content-Type / Content-Disposition 响应头', async () => {
      auditService.listForExport.mockResolvedValue([]);

      const res: any = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.export({ userId: 'u1', workspaceId: 'ws-1' }, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename=audit-logs.csv',
      );
    });

    it('调用 auditService.listForExport 并把 workspaceId 透传', async () => {
      auditService.listForExport.mockResolvedValue([]);

      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      await controller.export({ userId: 'u1', workspaceId: 'ws-export' }, res);

      expect(auditService.listForExport).toHaveBeenCalledWith('ws-export');
      expect(auditService.listForExport).toHaveBeenCalledTimes(1);
    });

    it('在 CSV 头部写入 BOM（\\uFEFF）以兼容 Excel 中文环境', async () => {
      auditService.listForExport.mockResolvedValue([]);

      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      await controller.export({ userId: 'u1', workspaceId: 'ws-1' }, res);

      const body = res.send.mock.calls[0][0] as string;
      // UTF-8 BOM 占三个字节：\xEF\xBB\xBF；JS 字符串里写作 \uFEFF。
      expect(body.charCodeAt(0)).toBe(0xfeff);
      // 紧接着是表头
      expect(body.slice(1)).toMatch(/^时间,用户ID,操作,目标类型,目标ID,详情\n/);
    });

    it('把日志行按 createdAt.toISOString() 形式拼接并以换行连接', async () => {
      auditService.listForExport.mockResolvedValue([
        {
          createdAt: new Date('2026-08-18T01:02:03.000Z'),
          userId: 'u1',
          action: 'CREATE_PROJECT',
          targetType: 'Project',
          targetId: 'proj-1',
          detail: '{"k":"v"}',
        },
        {
          createdAt: new Date('2026-08-17T01:02:03.000Z'),
          userId: null,
          action: 'DELETE',
          targetType: null,
          targetId: null,
          detail: null,
        },
      ]);

      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      await controller.export({ userId: 'u1', workspaceId: 'ws-1' }, res);

      const body = res.send.mock.calls[0][0] as string;
      const lines = body.replace(/^\uFEFF/, '').split('\n');
      // 第 0 行是表头，第 1、2 行是数据
      expect(lines[0]).toBe('时间,用户ID,操作,目标类型,目标ID,详情');
      expect(lines[1]).toBe('2026-08-18T01:02:03.000Z,u1,CREATE_PROJECT,Project,proj-1,{"k":"v"}');
      expect(lines[2]).toBe('2026-08-17T01:02:03.000Z,,DELETE,,,');
    });

    it('将 detail 字段里的英文逗号替换为分号，避免破坏 CSV 列结构', async () => {
      auditService.listForExport.mockResolvedValue([
        {
          createdAt: new Date('2026-08-18T00:00:00.000Z'),
          userId: 'u1',
          action: 'X',
          targetType: 'T',
          targetId: 'id',
          detail: '{"a":"x,y,z","b":"ok"}',
        },
      ]);

      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      await controller.export({ userId: 'u1', workspaceId: 'ws-1' }, res);

      const body = res.send.mock.calls[0][0] as string;
      // 整个 CSV 不能再出现 x,y 或 y,z 这种裸逗号（detail 内部逗号已转分号）
      expect(body).not.toContain('"a":"x,y');
      expect(body).toContain('{"a":"x;y;z";"b":"ok"}');
    });

    it('无日志时只输出表头（不含数据行）', async () => {
      auditService.listForExport.mockResolvedValue([]);

      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      await controller.export({ userId: 'u1', workspaceId: 'ws-1' }, res);

      const body = res.send.mock.calls[0][0] as string;
      // 表头 + 末尾一个 \n
      expect(body).toBe('\uFEFF时间,用户ID,操作,目标类型,目标ID,详情\n');
    });
  });
});
