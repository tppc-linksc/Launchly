import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './system.controller';

describe('HealthController worker readiness', () => {
  const prisma = {
    workerHeartbeat: { findFirst: jest.fn() },
  };
  const controller = new HealthController(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('reports the most recent ready worker', async () => {
    const updatedAt = new Date();
    prisma.workerHeartbeat.findFirst.mockResolvedValue({
      workerId: 'worker-1',
      status: 'READY',
      updatedAt,
    });

    await expect(controller.workerHealth()).resolves.toEqual({
      status: 'ok',
      worker: 'ready',
      workerId: 'worker-1',
      lastHeartbeatAt: updatedAt.toISOString(),
    });
  });

  it.each([
    ['missing', null],
    ['stale', { workerId: 'worker-1', status: 'READY', updatedAt: new Date(Date.now() - 46_000) }],
    ['not ready', { workerId: 'worker-1', status: 'FAILED', updatedAt: new Date() }],
  ])('fails closed when the worker heartbeat is %s', async (_name, heartbeat) => {
    prisma.workerHeartbeat.findFirst.mockResolvedValue(heartbeat);
    await expect(controller.workerHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
