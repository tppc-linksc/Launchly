import type { INestApplication } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

describe('AppModule production startup', () => {
  let app: INestApplication | undefined;
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void;
  let prismaMock: { $queryRawUnsafe: jest.Mock };
  let controllerNames: string[] = [];

  const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    processRole: process.env.LAUNCHLY_PROCESS_ROLE,
    jwtSecret: process.env.LAUNCHLY_JWT_SECRET,
    encryptionKey: process.env.LAUNCHLY_ENCRYPTION_KEY,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.LAUNCHLY_PROCESS_ROLE = 'api';
    process.env.LAUNCHLY_JWT_SECRET = 'startup-smoke-jwt-secret';
    process.env.LAUNCHLY_ENCRYPTION_KEY = 'startup-smoke-encryption-key';

    const [{ Test }, { ModulesContainer }, { AppModule }, { PrismaService }] = await Promise.all([
      import('@nestjs/testing'),
      import('@nestjs/core'),
      import('../src/app.module'),
      import('../src/common/prisma/prisma.service'),
    ]);

    prismaMock = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ result: 1 }]),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
    requestHandler = app.getHttpAdapter().getInstance();

    const modules = app.get(ModulesContainer);
    controllerNames = [...modules.values()]
      .flatMap((module) => [...module.controllers.keys()])
      .map((controller) => (typeof controller === 'function' ? controller.name : String(controller)))
      .sort();
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv('NODE_ENV', originalEnv.nodeEnv);
    restoreEnv('LAUNCHLY_PROCESS_ROLE', originalEnv.processRole);
    restoreEnv('LAUNCHLY_JWT_SECRET', originalEnv.jwtSecret);
    restoreEnv('LAUNCHLY_ENCRYPTION_KEY', originalEnv.encryptionKey);
  });

  it('creates every API controller without dependency-injection errors', () => {
    expect(app).toBeDefined();
    expect(controllerNames).toEqual([
      'AuditLogController',
      'AuthController',
      'ComponentController',
      'DeployTargetController',
      'DeploymentController',
      'EnvironmentController',
      'EnvironmentVariableController',
      'HealthController',
      'InvitationController',
      'IssueController',
      'MemberController',
      'NotificationController',
      'ProjectController',
      'ReleaseController',
      'SetupController',
      'SystemController',
      'TestCaseController',
      'TestRunController',
      'WebhookController',
      'WorkspaceController',
    ]);
  });

  it('serves the production health route with the database dependency isolated', async () => {
    const response = await request('GET', '/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      database: 'ok',
      timestamp: expect.any(String),
    });
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  async function request(
    method: string,
    url: string,
    options: { headers?: Record<string, string>; body?: unknown } = {},
  ) {
    const headers = { ...(options.headers ?? {}) };
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.httpVersion = '1.1';
    req.headers.host = '127.0.0.1';

    if (options.body !== undefined) {
      req.headers['content-type'] = 'application/json';
      const payload = JSON.stringify(options.body);
      req.headers['content-length'] = String(Buffer.byteLength(payload));
      req.push(payload);
    }
    req.push(null);

    const chunks: Buffer[] = [];
    const result = await new Promise<{ status: number; body: any; raw: string }>((resolve, reject) => {
      const res = new ServerResponse(req);
      const originalEnd = res.end.bind(res);

      res.on('error', reject);
      (res.end as (chunk?: any, encoding?: any, callback?: any) => void) = (
        chunk: any,
        encoding?: any,
        callback?: any,
      ) => {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(
            typeof chunk === 'string'
              ? Buffer.from(chunk, encoding)
              : Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk),
          );
        }

        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: string | object | undefined;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
        } catch {
          parsed = raw;
        }

        resolve({
          status: res.statusCode ?? 200,
          body: parsed,
          raw,
        });

        return originalEnd(chunk as string | Buffer, encoding as BufferEncoding, callback);
      };

      try {
        requestHandler(req, res);
      } catch (err) {
        reject(err);
      }
    });
    return result;
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
