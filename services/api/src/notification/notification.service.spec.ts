import { NotificationService } from './notification.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: MockPrismaService;

  const userId = 'user-1';
  const otherUserId = 'user-OTHER';

  beforeEach(() => {
    prisma = createPrismaMock();
    // The shared prisma-mock factory does not register updateMany; attach it
    // manually so markAllRead can be exercised.
    (prisma.notification as any).updateMany = jest.fn();
    service = new NotificationService(prisma as any);
  });

  describe('list', () => {
    it('queries with where={userId} and orderBy={createdAt:"desc"}', async () => {
      const rows = [{ id: 'n1' }, { id: 'n2' }];
      prisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.list(userId);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(rows);
    });

    it('does not bleed another userId into the where clause', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(userId);
      await service.list(otherUserId);

      const calls = (prisma.notification.findMany as jest.Mock).mock.calls;
      expect(calls[0][0]).toEqual({ where: { userId }, orderBy: { createdAt: 'desc' } });
      expect(calls[1][0]).toEqual({ where: { userId: otherUserId }, orderBy: { createdAt: 'desc' } });
    });
  });

  describe('markAllRead', () => {
    it('uses where={userId, read:false} and data={read:true}', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead(userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        data: { read: true },
      });
      expect(result).toEqual({ success: true });
    });

    it('scopes the update to the caller user only (different calls use different userId)', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await service.markAllRead(userId);
      await service.markAllRead(otherUserId);

      const calls = (prisma.notification.updateMany as jest.Mock).mock.calls;
      expect(calls[0][0]).toEqual({ where: { userId, read: false }, data: { read: true } });
      expect(calls[1][0]).toEqual({ where: { userId: otherUserId, read: false }, data: { read: true } });
    });

    it('propagates the underlying Prisma error and does not return success early', async () => {
      const dbError = new Error('database unavailable');
      prisma.notification.updateMany.mockRejectedValue(dbError);

      await expect(service.markAllRead(userId)).rejects.toBe(dbError);
    });
  });

  describe('create', () => {
    it.each([
      { label: 'content + refId',       content: 'hello',  refId: 'ref-1',  expectedContent: 'hello',  expectedRefId: 'ref-1'  },
      { label: 'content only',           content: 'hello',  refId: undefined, expectedContent: 'hello',  expectedRefId: undefined },
      { label: 'refId only',             content: undefined, refId: 'ref-2', expectedContent: undefined, expectedRefId: 'ref-2' },
      { label: 'both undefined',         content: undefined, refId: undefined, expectedContent: undefined, expectedRefId: undefined },
      { label: 'empty string content',   content: '',       refId: '',      expectedContent: '',       expectedRefId: ''      },
    ])('$label: forwards values verbatim and returns the created notification', async ({ content, refId, expectedContent, expectedRefId }) => {
      prisma.notification.create.mockResolvedValue({
        id: 'n-new', userId, type: 'INFO', title: 'hello', content, refId,
      });

      const result = await service.create(userId, 'INFO', 'hello', content, refId);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId, type: 'INFO', title: 'hello', content, refId },
      });
      expect(result).toEqual({
        id: 'n-new', userId, type: 'INFO', title: 'hello', content: expectedContent, refId: expectedRefId,
      });
    });
  });
});
