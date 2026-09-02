import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { InvitationService } from './invitation.service';

jest.mock('bcryptjs');

describe('InvitationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores only a hash while returning the one-time raw invitation token', async () => {
    const prisma: any = {
      invitation: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'invitation-1',
          ...data,
          usedCount: 0,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
    };
    const service = new InvitationService(prisma);

    const result = await service.create('workspace-a', { role: 'DEVELOPER' });
    const persistedToken = prisma.invitation.create.mock.calls[0][0].data.token;

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(persistedToken).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedToken).not.toBe(result.token);
    expect(result.maxUses).toBe(1);
  });

  it('atomically claims an invitation, creates the member, and records an audit event', async () => {
    const invitation = {
      id: 'invitation-1',
      workspaceId: 'workspace-a',
      role: 'TESTER',
      token: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      maxUses: 1,
      usedCount: 0,
      status: 'ACTIVE',
    };
    const tx: any = {
      invitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
      user: { create: jest.fn().mockResolvedValue({ id: 'user-2', account: 'tester' }) },
      workspaceMember: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = {
      invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    const service = new InvitationService(prisma);

    await expect(service.accept('raw-token', { account: 'tester', password: 'password123' })).resolves.toEqual({
      success: true,
      account: 'tester',
    });
    expect(tx.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: 'workspace-a', userId: 'user-2', role: 'TESTER' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-2', workspaceId: 'workspace-a', action: 'INVITATION_ACCEPTED' }),
    });
    expect(tx.invitation.update).toHaveBeenCalledWith({
      where: { id: 'invitation-1' },
      data: { status: 'CONSUMED' },
    });
  });

  it('rejects expired invitations before hashing a password or starting a transaction', async () => {
    const prisma: any = {
      invitation: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date(0), usedCount: 0, maxUses: 1 }),
      },
      $transaction: jest.fn(),
    };
    const service = new InvitationService(prisma);

    await expect(service.accept('raw-token', { account: 'tester', password: 'password123' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
