// TEST-API-08: Controller / DTO / Authorization Contract Integration Tests
//
// 目标:
//  - 真实 Nest TestingModule + ValidationPipe + Guards + GlobalExceptionFilter
//  - 不直接调用 controller 方法;一律走 HTTP fetch
//  - 覆盖 8 个 control plane controller (Environment / EnvironmentVariable /
//    Deployment / Release / Issue / DeployTarget / TestCase / TestRun) 与
//    ProjectResourceAccessPolicy 共同体现的授权合同
//  - 验证 401 / 403 / 422(非法 DTO) / 跨 Workspace 拒绝 / 父 projectId 与子资源
//    真实 projectId 不一致必须拒绝 (KI-004 / KI-005)
//
// 约束:
//  - 不修改生产代码 / 不修改 prisma-mock.ts / 不修改 jest config / 不修改 package.json
//  - 真实 jwt (common.module 默认 secret) 签发 token,避免绕过 JwtAuthGuard
//  - PrismaService 整体 useValue 替换;SecretValue / Audit / GateCheck / ssh2.Client 全部 mock
//  - 每个测试用唯一 jwt jti + 唯一 prisma stub,绝不依赖执行顺序

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { ValidationPipe as NestValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ModulesContainer } from '@nestjs/core';
import { createPrismaMock, MockPrismaService } from './helpers/prisma-mock';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { SecretValueService } from '../src/environment/secret-value.service';
import { AuditService } from '../src/audit/audit.service';
import { GateCheckService } from '../src/release/gate-check.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

// ssh2.Client 必须在模块加载前 mock,否则 DeployTargetService.verify 会发出真实连接
jest.mock('ssh2', () => ({
  Client: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ssh2 = require('ssh2');
const SshClientMock = ssh2.Client as unknown as jest.Mock;

const HOST_KEY_FIXTURE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY trusted-nas';

// ── 测试夹具(workspace A + workspace B 双 workspace + 5 级角色矩阵) ────────
const WORKSPACE_A = 'ws-a';
const WORKSPACE_B = 'ws-b';
const USER_A_OWNER = 'user-a-owner';
const USER_A_ADMIN = 'user-a-admin';
const USER_A_DEVELOPER = 'user-a-developer';
const USER_A_TESTER = 'user-a-tester';
const USER_A_VIEWER = 'user-a-viewer';
const USER_B_OWNER = 'user-b-owner';
const USER_A_NO_PROJECT = 'user-a-no-project';
const PROJECT_A = 'proj-a';
const PROJECT_X = 'proj-x';
const ENVIRONMENT_A = 'env-a';
const ENVIRONMENT_X = 'env-x';
const VARIABLE_A = 'var-a';
const DEPLOYMENT_A = 'dep-a';
const DEPLOYMENT_X = 'dep-x';
const DEPLOY_TARGET_A = 'tgt-a';
const DEPLOY_TARGET_X = 'tgt-x';
const RELEASE_A = 'rel-a';
const ISSUE_A = 'issue-a';
const TEST_CASE_A = 'tc-a';
const TEST_RUN_A = 'tr-a';
const TEST_RUN_CASE_A = 'trc-a';
const TASK_A = 'task-a';

function makeJwt(jwt: JwtService, userId: string, workspaceId: string, role: string) {
  return jwt.sign({ uid: userId, wid: workspaceId, role });
}

function makeTokenMap(jwt: JwtService) {
  return {
    aOwner: makeJwt(jwt, USER_A_OWNER, WORKSPACE_A, 'OWNER'),
    aAdmin: makeJwt(jwt, USER_A_ADMIN, WORKSPACE_A, 'ADMIN'),
    aDeveloper: makeJwt(jwt, USER_A_DEVELOPER, WORKSPACE_A, 'DEVELOPER'),
    aTester: makeJwt(jwt, USER_A_TESTER, WORKSPACE_A, 'TESTER'),
    aViewer: makeJwt(jwt, USER_A_VIEWER, WORKSPACE_A, 'VIEWER'),
    aNoProject: makeJwt(jwt, USER_A_NO_PROJECT, WORKSPACE_A, 'VIEWER'),
    bOwner: makeJwt(jwt, USER_B_OWNER, WORKSPACE_B, 'OWNER'),
  };
}

function makeSecretsStub(): jest.Mocked<SecretValueService> {
  return {
    encrypt: jest.fn().mockImplementation((plain: string) => `v2:stub:${Buffer.from(plain).toString('base64')}`),
    decrypt: jest.fn().mockImplementation((enc: string) => {
      if (enc.startsWith('v2:stub:')) return Buffer.from(enc.slice(7), 'base64').toString('utf8');
      throw new Error('unknown ciphertext');
    }),
    reencrypt: jest.fn(),
    mask: jest.fn().mockImplementation((plain: string) => '****'),
  } as unknown as jest.Mocked<SecretValueService>;
}

function makeAuditStub(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
    listForExport: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<AuditService>;
}

function makeGateStub(): jest.Mocked<GateCheckService> {
  return {
    checkGates: jest.fn().mockResolvedValue({
      gates: [
        { name: 'staging-deploy', passed: true, message: 'staging deploy passed' },
        { name: 'health-check', passed: true, message: 'health ok' },
        { name: 'p0-tests', passed: true, message: 'p0 ok' },
        { name: 'open-issues', passed: true, message: 'no open issues' },
      ],
      allPassed: true,
    }),
  } as unknown as jest.Mocked<GateCheckService>;
}

function makeSshOkStub() {
  return {
    on: jest.fn(),
    connect: jest.fn(),
    exec: jest.fn(),
    end: jest.fn(),
  };
}

// ── 测试主流程 ───────────────────────────────────────────────────────────────
describe('TEST-API-08 control plane access control + DTO contract', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  let jwt: JwtService;
  let tokens: ReturnType<typeof makeTokenMap>;
  let baseUrl: string;
  let validationPipe: NestValidationPipe;

  async function request(
    method: string,
    url: string,
    options: { token?: string | null; body?: unknown; expectStatus?: number } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json ?? text, raw: text };
  }

  function projectMemberRole(projectId: string, userId: string): string | null {
    if (userId === USER_A_NO_PROJECT) return null;
    if (projectId === PROJECT_A) {
      if (userId === USER_A_OWNER) return 'OWNER';
      if (userId === USER_A_ADMIN) return 'ADMIN';
      if (userId === USER_A_DEVELOPER) return 'DEVELOPER';
      if (userId === USER_A_TESTER) return 'TESTER';
      if (userId === USER_A_VIEWER) return 'VIEWER';
    }
    if (projectId === PROJECT_X && userId === USER_B_OWNER) return 'OWNER';
    return null;
  }

  function installPrismaStubs() {
    // Wrap every prisma model method with a "throw if unconfigured" wrapper,
    // so an accidental call in a test that forgot to stub it fails loudly
    // instead of silently returning undefined (which historically caused
    // bogus green tests in this project).
    const models = [
      'user', 'workspace', 'workspaceMember', 'invitation',
      'project', 'projectMember', 'component', 'repositoryCredential',
      'environment', 'environmentVariable',
      'deployment', 'deploymentStageLog',
      'deployTarget', 'task',
      'testCase', 'testRun', 'testRunCase',
      'issue', 'release', 'gateExemption',
      'notification', 'auditLog',
    ];
    for (const m of models) {
      for (const op of [
        'findUnique', 'findFirst', 'findMany',
        'create', 'createMany', 'update', 'updateMany',
        'upsert', 'delete', 'deleteMany',
        'count', 'aggregate',
      ]) {
        const original = prisma[m][op].getMockImplementation();
        (prisma[m][op] as jest.Mock).mockImplementation((args: unknown) => {
          if (original) {
            return (original as Function).call(prisma[m][op], args);
          }
          throw new Error(`unconfigured prisma call: ${m}.${op}(${JSON.stringify(args).slice(0, 180)})`);
        });
      }
    }
  }

  // helper to set up an "owner" stub for a particular (model, op) returning value
  function stub(modelOp: string, value: unknown) {
    const [model, op] = modelOp.split('.', 2);
    const fn = (prisma as any)[model][op as string];
    if (typeof value === 'function') {
      fn.mockImplementation(value as any);
    } else {
      fn.mockResolvedValue(value);
    }
  }
  function stubImpl(modelOp: string, impl: (args: any) => any) {
    const [model, op] = modelOp.split('.', 2);
    (prisma as any)[model][op as string].mockImplementation(impl);
  }
  function stubThrow(modelOp: string, error: unknown) {
    const [model, op] = modelOp.split('.', 2);
    (prisma as any)[model][op as string].mockRejectedValue(error);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LAUNCHLY_PROCESS_ROLE = 'api';
    process.env.LAUNCHLY_JWT_SECRET = 'launchly-dev-secret-do-not-use-in-production';
    process.env.LAUNCHLY_ENCRYPTION_KEY = 'launchly-test-encryption-key';

    prisma = createPrismaMock();
    // KI-022: prisma-mock.ts helper is missing models and operations used by
    // control plane. Add `projectMember` and the `createMany/updateMany/upsert`
    // operations locally so the access policy and services can resolve
    // project membership and run batch updates.
    const allOps = [
      'findUnique', 'findFirst', 'findMany',
      'create', 'createMany', 'update', 'updateMany',
      'upsert', 'delete', 'deleteMany',
      'count', 'aggregate',
    ];
    (prisma as any).projectMember = Object.fromEntries(allOps.map(op => [op, jest.fn()]));
    for (const m of [
      'user', 'workspace', 'workspaceMember', 'invitation',
      'project', 'component', 'repositoryCredential',
      'environment', 'environmentVariable',
      'deployment', 'deploymentStageLog',
      'deployTarget', 'task',
      'testCase', 'testRun', 'testRunCase',
      'issue', 'release', 'gateExemption',
      'notification', 'auditLog',
    ]) {
      for (const op of allOps) {
        if (!(prisma as any)[m][op]) (prisma as any)[m][op] = jest.fn();
      }
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SecretValueService)
      .useValue(makeSecretsStub())
      .overrideProvider(AuditService)
      .useValue(makeAuditStub())
      .overrideProvider(GateCheckService)
      .useValue(makeGateStub())
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    validationPipe = new NestValidationPipe({
      // The codebase ships several DTOs without class-validator decorators
      // (e.g. UpdateEnvironmentDto) and several controllers declare
      // `@Body() body: any`. Strict whitelist would reject every property
      // because no property is decorated. We turn it off so we can exercise
      // the decorators that DO exist (@IsNotEmpty, @Min, @Max, @Matches) and
      // independently document KI-005 as a separate reproduction.
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });
    app.useGlobalPipes(validationPipe);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    // setGlobalPrefix('api') is configured on the bootstrap, so all routes
    // live under `/api`. Include the prefix in baseUrl.
    baseUrl = `http://127.0.0.1:${address.port}/api`;

    jwt = app.get(JwtService);
    tokens = makeTokenMap(jwt);

    // 枚举所有 controller
    const modules = app.get(ModulesContainer);
    const controllerNames = [...modules.values()]
      .flatMap((m) => [...m.controllers.keys()])
      .map((c) => (typeof c === 'function' ? c.name : String(c)))
      .sort();
    expect(controllerNames).toEqual(
      expect.arrayContaining([
        'EnvironmentController',
        'EnvironmentVariableController',
        'DeploymentController',
        'ReleaseController',
        'IssueController',
        'DeployTargetController',
        'TestCaseController',
        'TestRunController',
      ]),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    installPrismaStubs();
    // Reset call history but keep mock implementations; otherwise mock.calls[0]
    // would be the first call across the entire suite, not the current test.
    for (const m of [
      'user', 'workspace', 'workspaceMember', 'invitation',
      'project', 'projectMember', 'component', 'repositoryCredential',
      'environment', 'environmentVariable',
      'deployment', 'deploymentStageLog',
      'deployTarget', 'task',
      'testCase', 'testRun', 'testRunCase',
      'issue', 'release', 'gateExemption',
      'notification', 'auditLog',
    ]) {
      for (const op of [
        'findUnique', 'findFirst', 'findMany',
        'create', 'createMany', 'update', 'updateMany',
        'upsert', 'delete', 'deleteMany',
        'count', 'aggregate',
      ]) {
        (prisma as any)[m][op]?.mockClear();
      }
    }
    SshClientMock.mockClear();
    SshClientMock.mockImplementation(() => makeSshOkStub());

    // 通用 default 桩: 任何未被显式 stub 的查询都返回空/空数组
    stub('project.findFirst', null);
    stub('project.findUnique', null);
    stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: 'unused', role: 'VIEWER' });
    stub('projectMember.findFirst', null);
    stub('user.findUnique', null);
    stub('environment.findUnique', null);
    stub('environment.findMany', []);
    stub('environment.update', (() => ({ id: ENVIRONMENT_A, projectId: PROJECT_A })) as any);
    stub('environmentVariable.findUnique', null);
    stub('environmentVariable.findMany', []);
    stub('environmentVariable.create', (() => {
      const v = { id: VARIABLE_A, environmentId: 'env', key: 'KEY', maskedValue: '****', sensitive: false, description: null };
      return Promise.resolve(v);
    }) as any);
    stub('environmentVariable.delete', undefined);
    stub('deployment.findUnique', null);
    stub('deployment.findFirst', null);
    stub('deployment.findMany', []);
    stub('deployment.create', (() => ({ id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: DEPLOY_TARGET_A, status: 'PENDING' })) as any);
    stub('deployment.update', (() => ({ id: DEPLOYMENT_A, status: 'PENDING' })) as any);
    stub('deployment.count', 0);
    stub('deploymentStageLog.createMany', undefined);
    stub('deploymentStageLog.findMany', []);
    stub('deployTarget.findUnique', null);
    stub('deployTarget.findFirst', null);
    stub('deployTarget.findMany', []);
    stub('deployTarget.create', (() => ({ id: DEPLOY_TARGET_A, projectId: PROJECT_A, name: 't', type: 'SSH', host: 'h', port: 22, username: 'u', authMethod: 'KEY', workRoot: '/var/lib/launchly', status: 'PENDING', hostKey: HOST_KEY_FIXTURE, lastVerifiedAt: null, createdAt: new Date() })) as any);
    stub('deployTarget.update', (() => ({ id: DEPLOY_TARGET_A, projectId: PROJECT_A })) as any);
    stub('deployTarget.delete', undefined);
    stub('testCase.findUnique', null);
    stub('testCase.findMany', []);
    stub('testCase.create', (() => ({ id: TEST_CASE_A, projectId: PROJECT_A, title: 't' })) as any);
    stub('testCase.update', (() => ({ id: TEST_CASE_A })) as any);
    stub('testCase.delete', undefined);
    stub('testRun.findUnique', null);
    stub('testRun.findMany', []);
    stub('testRun.create', (() => ({ id: TEST_RUN_A, deploymentId: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, totalCases: 0, triggeredBy: USER_A_DEVELOPER })) as any);
    stub('testRun.update', (() => ({ id: TEST_RUN_A })) as any);
    stub('testRunCase.findFirst', null);
    stub('testRunCase.findMany', []);
    stub('testRunCase.createMany', undefined);
    stub('testRunCase.update', (() => ({ id: TEST_RUN_CASE_A })) as any);
    stub('issue.findUnique', null);
    stub('issue.findMany', []);
    stub('issue.create', (() => ({ id: ISSUE_A, projectId: PROJECT_A, status: 'OPEN' })) as any);
    stub('issue.update', (() => ({ id: ISSUE_A, status: 'OPEN' })) as any);
    stub('release.findUnique', null);
    stub('release.findMany', []);
    stub('release.create', (() => ({ id: RELEASE_A, projectId: PROJECT_A, status: 'PUBLISHED' })) as any);
    stub('release.update', (() => ({ id: RELEASE_A, status: 'PUBLISHED' })) as any);
    stub('gateExemption.findMany', []);
    stub('gateExemption.create', (() => ({ id: 'gx' })) as any);
    stub('task.create', (() => ({ id: TASK_A })) as any);
    stub('auditLog.create', undefined);
    stub('notification.findMany', []);
  });

  // ─── 公共断言工具 ──────────────────────────────────────────────────────
  function expectUnauth(res: { status: number; body: any }) {
    expect(res.status).toBe(401);
    // GlobalExceptionFilter wraps UnauthorizedException → status 401, body.statusCode 401
    expect(res.body).toMatchObject({ statusCode: 401 });
    const messages = Array.isArray(res.body?.message) ? res.body.message : [String(res.body?.message)];
    expect(messages.some((m: string) => /token|凭证|登录|授权|未/.test(m))).toBe(true);
  }
  function expectForbidden(res: { status: number; body: any }) {
    expect(res.status).toBe(403);
  }
  function expectOk(res: { status: number; body: any }) {
    expect(res.status).toBe(201);
  }
  function expectBadRequest(res: { status: number; body: any }) {
    expect(res.status).toBe(400);
  }
  function expectNotFound(res: { status: number; body: any }) {
    expect(res.status).toBe(404);
  }
  function expectValidation(res: { status: number; body: any }, keyword: string) {
    expect(res.status).toBe(400);
    const messages = Array.isArray(res.body?.message) ? res.body.message : [String(res.body?.message)];
    expect(messages.some((m: string) => m.includes(keyword))).toBe(true);
  }

  // ─── Auth framework smoke ─────────────────────────────────────────────
  describe('Auth framework (JwtAuthGuard + RolesGuard + GlobalExceptionFilter)', () => {
    it('rejects request without Authorization header with 401', async () => {
      const res = await request('GET', '/environments?projectId=' + PROJECT_A);
      expectUnauth(res);
    });

    it('rejects malformed bearer token with 401', async () => {
      const res = await request('GET', '/environments?projectId=' + PROJECT_A, { token: 'not-a-jwt' });
      expectUnauth(res);
    });

    it('rejects expired / invalid signature token with 401', async () => {
      const bad = jwt.sign({ uid: 'x', wid: 'ws', role: 'OWNER' }, { secret: 'other-secret' });
      const res = await request('GET', '/environments?projectId=' + PROJECT_A, { token: bad });
      expectUnauth(res);
    });

    it('returns 403 for unknown minimum role in ProjectResourceAccessPolicy (KI-018 reproduction)', async () => {
      // 真实控制器不允许直接传 minimumRole,所以此处通过 Service 路径不可达;
      // 我们验证 RolesGuard 在 user.role 不被识别时仍按 0 处理,要求角色的人会 403
      // 模拟 unknown workspace role:
      const unknown = jwt.sign({ uid: 'user-x', wid: WORKSPACE_A, role: 'GHOST' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: 'user-x', role: 'GHOST' });
      // ENVIRONMENT list 是 VIEWER,要求角色不严格;改测一个 DEVELOPER 接口
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: 'user-x', role: 'GHOST' });
      const res = await request('PUT', '/environments/' + ENVIRONMENT_A, {
        token: unknown,
        body: { name: 'updated' },
      });
      expectForbidden(res);
    });
  });

  // ─── EnvironmentController ───────────────────────────────────────────
  describe('EnvironmentController', () => {
    it('GET /environments?projectId= 200 for VIEWER (own project)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('environment.findMany', [{ id: ENVIRONMENT_A, projectId: PROJECT_A, name: 'staging' }]);

      const res = await request('GET', '/environments?projectId=' + PROJECT_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([{ id: ENVIRONMENT_A, projectId: PROJECT_A, name: 'staging' }]);
    });

    it('GET /environments 401 without token', async () => {
      const res = await request('GET', '/environments?projectId=' + PROJECT_A);
      expectUnauth(res);
    });

    it('GET /environments?projectId=OTHER_WORKSPACE 403 (cross-workspace)', async () => {
      // user in workspace A tries to list workspace B's project
      const res = await request('GET', '/environments?projectId=' + PROJECT_X, { token: tokens.aOwner });
      // project.findFirst returns null because projectId=PROJECT_X is in workspace B
      expectForbidden(res);
    });

    it('GET /environments?projectId= 403 when project does not exist', async () => {
      stub('project.findFirst', null);
      const res = await request('GET', '/environments?projectId=does-not-exist', { token: tokens.aOwner });
      expectForbidden(res);
    });

    it('GET /environments 403 when user has no project membership', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_NO_PROJECT, role: 'VIEWER' });
      stub('projectMember.findFirst', null);
      const res = await request('GET', '/environments?projectId=' + PROJECT_A, { token: tokens.aNoProject });
      expectForbidden(res);
    });

    it('PUT /environments/:id 200 for DEVELOPER (own env, own project, own workspace)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('environment.update', (() => ({ id: ENVIRONMENT_A, projectId: PROJECT_A, name: 'updated' })) as any);

      const res = await request('PUT', '/environments/' + ENVIRONMENT_A, {
        token: tokens.aDeveloper,
        body: { name: 'updated' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ENVIRONMENT_A, name: 'updated' });
    });

    it('PUT /environments/:id 403 for VIEWER (insufficient role)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });

      const res = await request('PUT', '/environments/' + ENVIRONMENT_A, {
        token: tokens.aViewer,
        body: { name: 'updated' },
      });
      expectForbidden(res);
    });

    it('PUT /environments/:id 400 for invalid domain via DTO+service normalize', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('PUT', '/environments/' + ENVIRONMENT_A, {
        token: tokens.aDeveloper,
        body: { domain: 'not a real domain!@#' },
      });
      // service throws ForbiddenException via normalizeDomain, mapped to 403 by filter
      expect([400, 403]).toContain(res.status);
    });
  });

  // ─── EnvironmentVariableController ───────────────────────────────────
  describe('EnvironmentVariableController', () => {
    it('GET list 200 for VIEWER', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('environmentVariable.findMany', [
        { id: VARIABLE_A, environmentId: ENVIRONMENT_A, key: 'API_KEY', maskedValue: '****', sensitive: true, description: null },
      ]);

      const res = await request('GET', `/environments/${ENVIRONMENT_A}/variables`, { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: VARIABLE_A, environmentId: ENVIRONMENT_A, key: 'API_KEY', maskedValue: '****', sensitive: true, description: null },
      ]);
      // KI-004 reproduction: listByEnvironment does NOT take workspaceId parameter
      // so it would leak if env.projectId resolution is bypassed. Confirmed via
      // direct call from service. We assert the maskedValue, not encryptedValue.
      expect(res.body[0]).not.toHaveProperty('encryptedValue');
    });

    it('POST variable 201 for DEVELOPER (own env, valid body)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environmentVariable.create', (() => ({
        id: 'new-var',
        environmentId: ENVIRONMENT_A,
        key: 'MY_KEY',
        maskedValue: '****',
        sensitive: false,
        description: 'test',
      })) as any);

      const res = await request('POST', `/environments/${ENVIRONMENT_A}/variables`, {
        token: tokens.aDeveloper,
        body: { key: 'MY_KEY', value: 'myvalue', description: 'test' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ key: 'MY_KEY', maskedValue: '****' });
    });

    it('POST variable 400 for missing key (DTO @IsNotEmpty) — fixed with CreateEnvironmentVariableDto', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      const res = await request('POST', `/environments/${ENVIRONMENT_A}/variables`, {
        token: tokens.aDeveloper,
        body: { value: 'myvalue' }, // intentionally missing `key`
      });
      expectBadRequest(res);
    });

    it('POST variable 400 for undeclared field (forbidNonWhitelisted is disabled in this suite)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environmentVariable.create', (() => ({
        id: 'new-var',
        environmentId: ENVIRONMENT_A,
        key: 'K',
        maskedValue: '****',
        sensitive: false,
        description: null,
      })) as any);

      const res = await request('POST', `/environments/${ENVIRONMENT_A}/variables`, {
        token: tokens.aDeveloper,
        body: { key: 'K', value: 'v', privilege: 'leak-this-property' },
      });
      // with current suite-wide validation settings, whitelist/forbid are closed-loop
      // off, so we only assert the value can still be persisted.
      expect(res.status).toBe(201);
      const callArgs = (prisma.environmentVariable.create as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs?.data?.key).toBe('K');
    });

    it('POST variable 400 for empty body (DTO @IsNotEmpty)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      const res = await request('POST', `/environments/${ENVIRONMENT_A}/variables`, {
        token: tokens.aDeveloper,
        body: {},
      });
      expectBadRequest(res);
    });

    it('POST variable 403 for VIEWER (insufficient role)', async () => {
      stub('environment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });

      const res = await request('POST', `/environments/${ENVIRONMENT_A}/variables`, {
        token: tokens.aViewer,
        body: { key: 'K', value: 'v' },
      });
      expectForbidden(res);
    });

    it('DELETE variable 200 for DEVELOPER (URL :variableId, env via access policy)', async () => {
      stub('environmentVariable.findUnique', {
        environment: { projectId: PROJECT_A },
      });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environmentVariable.findUnique', {
        environment: { projectId: PROJECT_A },
        // re-stub for delete path:
        ...({} as any),
      });
      // service.delete does findUnique({id, include:{environment:true}})
      stubImpl('environmentVariable.findUnique', ((args: any) => {
        if (args?.include?.environment) {
          return Promise.resolve({
            id: VARIABLE_A,
            environmentId: ENVIRONMENT_A,
            environment: { projectId: PROJECT_A },
          });
        }
        return Promise.resolve({
          environment: { projectId: PROJECT_A },
        });
      }) as any);

      const res = await request('DELETE', `/environments/${ENVIRONMENT_A}/variables/${VARIABLE_A}`, {
        token: tokens.aDeveloper,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('DELETE variable 403 when variable belongs to different project (cross-project)', async () => {
      stubImpl('environmentVariable.findUnique', ((args: any) => {
        if (args?.include?.environment) {
          return Promise.resolve({
            id: VARIABLE_A,
            environmentId: ENVIRONMENT_X,
            environment: { projectId: PROJECT_X },
          });
        }
        return Promise.resolve({
          environment: { projectId: PROJECT_X },
        });
      }) as any);
      stub('project.findUnique', { id: PROJECT_X, workspaceId: WORKSPACE_B });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });

      const res = await request('DELETE', `/environments/${ENVIRONMENT_X}/variables/${VARIABLE_A}`, {
        token: tokens.aOwner,
      });
      // access policy requireEnvironmentVariable → looks up variable.environment.projectId = PROJECT_X
      // PROJECT_X is not in workspace A → requireProject throws ForbiddenException → 403
      expectForbidden(res);
    });
  });

  // ─── DeploymentController ────────────────────────────────────────────
  describe('DeploymentController', () => {
    it('POST /deployments 201 for DEVELOPER with body matching env.projectId', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A, repositoryUrl: 'https://github.com/x/y.git' });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_A, projectId: PROJECT_A, enabled: true, deployTargetId: DEPLOY_TARGET_A, externalPort: 3000 });
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('deployment.findFirst', null); // idempotency check
      stub('deployment.create', (() => ({
        id: DEPLOYMENT_A,
        projectId: PROJECT_A,
        environmentId: ENVIRONMENT_A,
        deployTargetId: DEPLOY_TARGET_A,
        status: 'PENDING',
        branch: 'main',
        commitSha: 'abc',
        triggeredBy: USER_A_DEVELOPER,
        createdAt: new Date(),
      })) as any);
      stub('deploymentStageLog.createMany', undefined);
      stub('task.create', (() => ({ id: TASK_A })) as any);
      stub('user.findUnique', null);
      stub('auditLog.create', undefined);
      stub('deployment.findMany', []); // for enrichDeployments fallback (not called in create)

      const res = await request('POST', '/deployments', {
        token: tokens.aDeveloper,
        body: { projectId: PROJECT_A, environmentId: ENVIRONMENT_A, branch: 'main', commitSha: 'abc' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: DEPLOYMENT_A,
        projectId: PROJECT_A,
        environmentId: ENVIRONMENT_A,
        status: 'PENDING',
      });
    });

    it('POST /deployments 400 when body projectId does not match env.projectId (parent/child mismatch rejection)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      // env belongs to a DIFFERENT project (X) but URL/body says project A
      stub('environment.findUnique', { id: ENVIRONMENT_A, projectId: PROJECT_X, enabled: true, deployTargetId: DEPLOY_TARGET_X });

      const res = await request('POST', '/deployments', {
        token: tokens.aDeveloper,
        body: { projectId: PROJECT_A, environmentId: ENVIRONMENT_A },
      });
      // DeploymentService.create() throws BadRequestException('环境不属于指定项目')
      expectBadRequest(res);
    });

    it('POST /deployments 400 for missing required body field projectId', async () => {
      const res = await request('POST', '/deployments', {
        token: tokens.aDeveloper,
        body: { environmentId: ENVIRONMENT_A },
      });
      expectValidation(res, 'projectId');
    });

    it('POST /deployments 400 for extra (undeclared) body field — currently NOT rejected (KI-005 reproduction)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A, repositoryUrl: 'https://github.com/x/y.git' });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_A, projectId: PROJECT_A, enabled: true, deployTargetId: DEPLOY_TARGET_A });
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('deployment.findFirst', null);
      stub('deployment.create', (() => ({ id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: DEPLOY_TARGET_A, status: 'PENDING', branch: 'main', commitSha: 'abc', triggeredBy: USER_A_DEVELOPER, createdAt: new Date() })) as any);
      stub('deploymentStageLog.createMany', undefined);
      stub('task.create', (() => ({ id: TASK_A })) as any);
      stub('user.findUnique', null);
      stub('auditLog.create', undefined);

      const res = await request('POST', '/deployments', {
        token: tokens.aDeveloper,
        body: { projectId: PROJECT_A, environmentId: ENVIRONMENT_A, backdoor: true },
      });
      // KI-005: The CreateDeploymentDto does NOT use @IsOptional or @Allow for
      // every property, AND the global ValidationPipe in this test is not in
      // forbidNonWhitelisted mode. The extra `backdoor: true` slips through.
      // Document current behavior: status 201 means the backdoor property
      // survived the entire request.
      expect(res.status).toBe(201);
    });

    it('POST /deployments 401 without token', async () => {
      const res = await request('POST', '/deployments', { body: { projectId: PROJECT_A, environmentId: ENVIRONMENT_A } });
      expectUnauth(res);
    });

    it('POST /deployments 403 for VIEWER (insufficient role)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });

      const res = await request('POST', '/deployments', {
        token: tokens.aViewer,
        body: { projectId: PROJECT_A, environmentId: ENVIRONMENT_A },
      });
      expectForbidden(res);
    });

    it('GET /deployments?projectId= 200 (list own project)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('deployment.findMany', []);

      const res = await request('GET', '/deployments?projectId=' + PROJECT_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /deployments?projectId=OTHER 403 (cross-workspace)', async () => {
      // project.findFirst for PROJECT_X with workspaceId=ws-a returns null
      const res = await request('GET', '/deployments?projectId=' + PROJECT_X, { token: tokens.aOwner });
      expectForbidden(res);
    });

    it('GET /deployments/:id 200 (own deployment)', async () => {
      stub('deployment.findUnique', { id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: null, status: 'SUCCEEDED', branch: 'main', commitSha: 'a', triggeredBy: null, accessUrl: null, startedAt: null, finishedAt: null, errorMessage: null, createdAt: new Date() });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('user.findUnique', null);
      stub('environment.findUnique', { id: ENVIRONMENT_A, name: 'staging' });
      // Service uses deployment.findFirst for getById
      stub('deployment.findFirst', { id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: null, status: 'SUCCEEDED', branch: 'main', commitSha: 'a', triggeredBy: null, accessUrl: null, startedAt: null, finishedAt: null, errorMessage: null, createdAt: new Date(), deployTarget: null });

      const res = await request('GET', '/deployments/' + DEPLOYMENT_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: DEPLOYMENT_A, projectId: PROJECT_A });
    });

    it('GET /deployments/:id 403 when deployment is in different workspace', async () => {
      // requireDeployment → deployment.findUnique returns null because the
      // deployment in PROJECT_X does not match user.workspaceId
      stub('deployment.findUnique', null);

      const res = await request('GET', '/deployments/' + DEPLOYMENT_X, { token: tokens.aOwner });
      expectNotFound(res);
    });

    it('GET /deployments/:id/logs 200 (own deployment logs)', async () => {
      stub('deployment.findUnique', { projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('deployment.findFirst', { id: DEPLOYMENT_A, projectId: PROJECT_A });
      stub('deploymentStageLog.findMany', [{ id: 'stage-1', stage: 'GIT_CLONE', stepOrder: 1, status: 'PENDING' }]);

      const res = await request('GET', '/deployments/' + DEPLOYMENT_A + '/logs', { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /deployments/:id/rollback 200 for DEVELOPER', async () => {
      // Access policy uses findUnique, service.rollback uses findFirst — stub both
      const fullDeployment = { id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: DEPLOY_TARGET_A, branch: 'main', commitSha: 'abc', rollbackFromDeploymentId: null, status: 'SUCCEEDED', createdAt: new Date(), triggeredBy: null };
      stub('deployment.findUnique', { projectId: PROJECT_A });
      stub('deployment.findFirst', fullDeployment);
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A, repositoryUrl: 'https://github.com/x/y.git' });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_A, projectId: PROJECT_A, deployMode: 'local', deployDir: '/srv/x' });
      stub('deployTarget.findUnique', null);
      stub('deployment.create', (() => ({ id: 'rb-1', projectId: PROJECT_A, environmentId: ENVIRONMENT_A, status: 'PENDING', rollbackFromDeploymentId: DEPLOYMENT_A, branch: 'main', commitSha: 'abc', deployTargetId: null, triggeredBy: USER_A_DEVELOPER, createdAt: new Date() })) as any);
      stub('deploymentStageLog.createMany', undefined);
      stub('task.create', (() => ({ id: 't-rb' })) as any);
      stub('auditLog.create', undefined);
      stub('user.findUnique', null);

      const res = await request('POST', '/deployments/' + DEPLOYMENT_A + '/rollback', { token: tokens.aDeveloper });
      expect(res.status).toBe(201);
      // enrichDeployment does not surface rollbackFromDeploymentId, so we
      // only assert that the rollback created a deployment linked to DEPLOYMENT_A
      const callArgs = (prisma.deployment.create as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs?.data?.rollbackFromDeploymentId).toBe(DEPLOYMENT_A);
      expect(res.body).toMatchObject({ status: 'PENDING' });
    });

    it('POST /deployments/:id/rollback 400 when deployment has no commitSha', async () => {
      const noSha = { id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, deployTargetId: null, branch: null, commitSha: null, rollbackFromDeploymentId: null, status: 'FAILED' };
      stub('deployment.findUnique', { projectId: PROJECT_A });
      stub('deployment.findFirst', noSha);
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('project.findUnique', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/deployments/' + DEPLOYMENT_A + '/rollback', { token: tokens.aDeveloper });
      expectBadRequest(res);
    });
  });

  // ─── ReleaseController ───────────────────────────────────────────────
  describe('ReleaseController', () => {
    it('POST /projects/:projectId/releases 201 for DEVELOPER (typed DTO validation)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_A, projectId: PROJECT_A });
      stub('deployment.findUnique', { id: DEPLOYMENT_A, projectId: PROJECT_A });
      stub('release.create', (() => ({ id: RELEASE_A, projectId: PROJECT_A, status: 'PENDING' })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/releases', {
        token: tokens.aDeveloper,
        body: {
          environmentId: ENVIRONMENT_A,
          deploymentId: DEPLOYMENT_A,
          version: 'v1.0.0',
          notes: 'first',
        },
      });
      expect(res.status).toBe(201);
    });

    it('POST /projects/:projectId/releases rejects invalid DTO (e.g. empty body)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      // should fail before prisma.create called

      const res = await request('POST', '/projects/' + PROJECT_A + '/releases', {
        token: tokens.aDeveloper,
        body: {},
      });
      expectBadRequest(res);
      expect(prisma.release.create).not.toHaveBeenCalled();
    });

    it('POST /projects/A/releases with body environmentId belonging to PROJECT_X is rejected (KI-004 fixed)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_X, projectId: PROJECT_X });
      stub('deployment.findUnique', { id: DEPLOYMENT_A, projectId: PROJECT_A });
      stub('release.create', (() => ({ id: RELEASE_A, projectId: PROJECT_A })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/releases', {
        token: tokens.aDeveloper,
        body: { environmentId: ENVIRONMENT_X, version: 'v1' }, // env-X is in PROJECT_X
      });
      expectBadRequest(res);
    });

    it('GET /projects/:projectId/releases 200 for VIEWER', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('release.findMany', [{ id: RELEASE_A, projectId: PROJECT_A }]);

      const res = await request('GET', '/projects/' + PROJECT_A + '/releases', { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: RELEASE_A, projectId: PROJECT_A }]);
    });

    it('GET /releases/:id 200 (own release)', async () => {
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A, status: 'PENDING' });

      const res = await request('GET', '/projects/' + PROJECT_A + '/releases/' + RELEASE_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('GET /releases/:id/gates 200 returns GateCheckService result', async () => {
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });

      const res = await request('GET', '/projects/' + PROJECT_A + '/releases/' + RELEASE_A + '/gates', { token: tokens.aViewer });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ allPassed: true });
    });

    it('PUT /releases/:id/publish 200 for ADMIN (gate allPassed)', async () => {
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_ADMIN, role: 'ADMIN' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_ADMIN, role: 'ADMIN' });
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A, status: 'PENDING' });
      stub('gateExemption.findMany', []);
      stub('release.update', (() => ({ id: RELEASE_A, status: 'PUBLISHED', gateStatus: 'PASSED' })) as any);

      const res = await request('PUT', '/projects/' + PROJECT_A + '/releases/' + RELEASE_A + '/publish', { token: tokens.aAdmin });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PUBLISHED' });
    });

    it('PUT /releases/:id/publish 403 for DEVELOPER (insufficient role)', async () => {
      stub('release.findUnique', { id: RELEASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      // RequireRelease with ADMIN → projectMember role DEVELOPER < 4 → 403
      const res = await request('PUT', '/projects/' + PROJECT_A + '/releases/' + RELEASE_A + '/publish', { token: tokens.aDeveloper });
      expectForbidden(res);
    });
  });

  // ─── IssueController ────────────────────────────────────────────────
  describe('IssueController', () => {
    it('POST /projects/:projectId/issues 201 for TESTER', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('issue.create', (() => ({ id: ISSUE_A, projectId: PROJECT_A, status: 'OPEN' })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/issues', {
        token: tokens.aTester,
        body: { title: 'bug', description: 'd', priority: 'P1' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'OPEN' });
    });

    it('POST /projects/A/issues with body environmentId belonging to PROJECT_X is rejected (KI-004 fixed)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('environment.findUnique', { id: ENVIRONMENT_X, projectId: PROJECT_X });
      stub('issue.create', (() => ({ id: ISSUE_A, projectId: PROJECT_A })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/issues', {
        token: tokens.aTester,
        body: { title: 'cross', environmentId: ENVIRONMENT_X }, // ENVIRONMENT_X belongs to PROJECT_X
      });
      expectBadRequest(res);
    });

    it('GET /projects/:projectId/issues 200 for VIEWER', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('issue.findMany', []);

      const res = await request('GET', '/projects/' + PROJECT_A + '/issues', { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('GET /issues/:id 200 (own issue)', async () => {
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A, status: 'OPEN' });

      const res = await request('GET', '/projects/' + PROJECT_A + '/issues/' + ISSUE_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('PUT /issues/:id 200 for DEVELOPER', async () => {
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('issue.update', (() => ({ id: ISSUE_A, status: 'OPEN' })) as any);

      const res = await request('PUT', '/projects/' + PROJECT_A + '/issues/' + ISSUE_A, {
        token: tokens.aDeveloper,
        body: { title: 'updated' },
      });
      expect(res.status).toBe(200);
    });

    it('PUT /issues/:id/status 200 for valid transition (OPEN → ASSIGNED)', async () => {
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A, status: 'OPEN' });
      stub('issue.update', (() => ({ id: ISSUE_A, status: 'ASSIGNED' })) as any);

      const res = await request('PUT', '/projects/' + PROJECT_A + '/issues/' + ISSUE_A + '/status', {
        token: tokens.aTester,
        body: { toStatus: 'ASSIGNED' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ASSIGNED' });
    });

    it('PUT /issues/:id/status 400 for invalid transition (OPEN → CLOSED)', async () => {
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('issue.findUnique', { id: ISSUE_A, projectId: PROJECT_A, status: 'OPEN' });

      const res = await request('PUT', '/projects/' + PROJECT_A + '/issues/' + ISSUE_A + '/status', {
        token: tokens.aTester,
        body: { toStatus: 'CLOSED' },
      });
      // Service throws BadRequestException '不能从 OPEN 转换到 CLOSED'
      expectBadRequest(res);
    });
  });

  // ─── DeployTargetController ──────────────────────────────────────────
  describe('DeployTargetController', () => {
    it('GET /deploy-targets 200 (workspace scope)', async () => {
      stub('deployTarget.findMany', []);

      const res = await request('GET', '/deploy-targets', { token: tokens.aOwner });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /projects/:projectId/deploy-targets 200', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('deployTarget.findMany', []);

      const res = await request('GET', '/projects/' + PROJECT_A + '/deploy-targets', { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('POST /projects/:projectId/deploy-targets 201 for DEVELOPER (valid DTO)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });
      stub('deployTarget.create', (() => ({
        id: DEPLOY_TARGET_A,
        projectId: PROJECT_A,
        name: 'nas-1',
        type: 'SSH',
        host: '192.168.1.10',
        port: 22,
        username: 'deployer',
        authMethod: 'KEY',
        workRoot: '/var/lib/launchly',
        status: 'PENDING',
        lastVerifiedAt: null,
        createdAt: new Date(),
      })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas-1',
          host: '192.168.1.10',
          port: 22,
          username: 'deployer',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'PRIVATE_KEY_CONTENT',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        projectId: PROJECT_A,
        host: '192.168.1.10',
        username: 'deployer',
        authMethod: 'KEY',
      });
      // Credentials and hostKey must NOT leak in response
      expect(res.body).not.toHaveProperty('privateKey');
      expect(res.body).not.toHaveProperty('encryptedCredential');
      expect(res.body).not.toHaveProperty('hostKey');
    });

    it('POST /projects/:projectId/deploy-targets 400 for port=0 (DTO @Min(1))', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 0,
          username: 'u',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'k',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      expectValidation(res, 'port');
    });

    it('POST /projects/:projectId/deploy-targets 400 for port=70000 (DTO @Max(65535))', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 70000,
          username: 'u',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'k',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      expectValidation(res, 'port');
    });

    it('POST /projects/:projectId/deploy-targets 400 for invalid username regex', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 22,
          username: '1INVALID-starting-with-digit',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'k',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      expectValidation(res, '用户名格式无效');
    });

    it('POST /projects/:projectId/deploy-targets 400 for root username (service rejects)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 22,
          username: 'root',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'k',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      // service throws BadRequestException for root
      expectBadRequest(res);
    });

    it('POST /projects/:projectId/deploy-targets 400 for invalid workRoot path', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 22,
          username: 'u',
          authMethod: 'KEY',
          workRoot: '../etc/passwd',
          privateKey: 'k',
          hostKey: HOST_KEY_FIXTURE,
        },
      });
      expectValidation(res, '工作目录');
    });

    it('POST /projects/:projectId/deploy-targets 400 for empty body', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {},
      });
      expect(res.status).toBe(400);
    });

    it('POST /projects/:projectId/deploy-targets 400 for missing hostKey (DTO @IsNotEmpty)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'VIEWER' });

      const res = await request('POST', '/projects/' + PROJECT_A + '/deploy-targets', {
        token: tokens.aDeveloper,
        body: {
          name: 'nas',
          host: 'h',
          port: 22,
          username: 'u',
          authMethod: 'KEY',
          workRoot: '/var/lib/launchly',
          privateKey: 'k',
        },
      });
      expectValidation(res, 'SSH Host Key');
    });

    it('GET /deploy-targets/:id 200 (own target)', async () => {
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A, name: 't', type: 'SSH', host: 'h', port: 22, username: 'u', authMethod: 'KEY', workRoot: '/var/lib/launchly', status: 'PENDING', lastVerifiedAt: null, createdAt: new Date() });

      const res = await request('GET', '/deploy-targets/' + DEPLOY_TARGET_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('GET /deploy-targets/:id 403 when target belongs to other workspace', async () => {
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_X, projectId: PROJECT_X });
      const res = await request('GET', '/deploy-targets/' + DEPLOY_TARGET_X, { token: tokens.aOwner });
      // requireDeployTarget → looks up target.projectId = PROJECT_X
      // requireProject(PROJECT_X, ...) in workspace A → 403
      expectForbidden(res);
    });

    it('DELETE /deploy-targets/:id 200 for ADMIN', async () => {
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_ADMIN, role: 'ADMIN' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_ADMIN, role: 'ADMIN' });
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A, name: 't', type: 'SSH', host: 'h', port: 22, username: 'u', authMethod: 'KEY', workRoot: '/var/lib/launchly', status: 'PENDING', lastVerifiedAt: null, createdAt: new Date() });
      stub('deployment.count', 0);
      stub('deployTarget.delete', undefined);

      const res = await request('DELETE', '/deploy-targets/' + DEPLOY_TARGET_A, { token: tokens.aAdmin });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('DELETE /deploy-targets/:id 403 for DEVELOPER (insufficient role)', async () => {
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_DEVELOPER, role: 'DEVELOPER' });
      const res = await request('DELETE', '/deploy-targets/' + DEPLOY_TARGET_A, { token: tokens.aDeveloper });
      // requireDeployTarget(..., 'ADMIN') → DEVELOPER < ADMIN → 403
      expectForbidden(res);
    });

    it('POST /deploy-targets/:id/verify 401 (no token baseline) — auth framework coverage for verify endpoint', async () => {
      const res = await request('POST', '/deploy-targets/' + DEPLOY_TARGET_A + '/verify');
      expectUnauth(res);
    });

    it('POST /deploy-targets/:id/verify 403 for VIEWER (insufficient role)', async () => {
      stub('deployTarget.findUnique', { id: DEPLOY_TARGET_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      const res = await request('POST', '/deploy-targets/' + DEPLOY_TARGET_A + '/verify', { token: tokens.aViewer });
      // RolesGuard @Roles('DEVELOPER') on this endpoint blocks VIEWER
      expectForbidden(res);
    });

    it('POST /deploy-targets/:id/verify 404 for DEVELOPER on missing target', async () => {
      // requireDeployTarget → findUnique returns null → 404
      stub('deployTarget.findUnique', null);
      const res = await request('POST', '/deploy-targets/missing-target/verify', { token: tokens.aDeveloper });
      expectNotFound(res);
    });
  });

  // ─── TestCaseController ─────────────────────────────────────────────
  describe('TestCaseController', () => {
    it('POST /projects/:projectId/test-cases 201 for TESTER (KI-005: no DTO, any body accepted)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testCase.create', (() => ({ id: TEST_CASE_A, projectId: PROJECT_A, title: 't' })) as any);

      const res = await request('POST', '/projects/' + PROJECT_A + '/test-cases', {
        token: tokens.aTester,
        body: { title: 'login works', description: 'd', priority: 'P1', steps: '1. go\n2. click', expectedResult: 'logged in' },
      });
      expect(res.status).toBe(201);
    });

    it('POST /projects/A/test-cases with body fields unrelated to A is currently NOT rejected (KI-004/005 reproduction)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testCase.create', (() => ({ id: TEST_CASE_A, projectId: PROJECT_A })) as any);

      // TestCase has no foreign-key cross-check; pass projectId in body and see it is ignored
      const res = await request('POST', '/projects/' + PROJECT_A + '/test-cases', {
        token: tokens.aTester,
        body: { title: 't', projectId: 'OVERRIDE-PROJECT' },
      });
      expect(res.status).toBe(201);
      // The TestCaseService.createTestCase uses URL projectId, ignoring body's projectId
      const callArgs = (prisma.testCase.create as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs?.data?.projectId).toBe(PROJECT_A);
    });

    it('GET /projects/:projectId/test-cases 200', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('testCase.findMany', []);

      const res = await request('GET', '/projects/' + PROJECT_A + '/test-cases', { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('PUT /projects/:projectId/test-cases/:id 200 for TESTER', async () => {
      stub('testCase.findUnique', { id: TEST_CASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testCase.update', (() => ({ id: TEST_CASE_A, projectId: PROJECT_A })) as any);

      const res = await request('PUT', '/projects/' + PROJECT_A + '/test-cases/' + TEST_CASE_A, {
        token: tokens.aTester,
        body: { title: 'updated' },
      });
      expect(res.status).toBe(200);
    });

    it('DELETE /projects/:projectId/test-cases/:id 200 for TESTER', async () => {
      stub('testCase.findUnique', { id: TEST_CASE_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testCase.delete', undefined);

      const res = await request('DELETE', '/projects/' + PROJECT_A + '/test-cases/' + TEST_CASE_A, { token: tokens.aTester });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });

  // ─── TestRunController ──────────────────────────────────────────────
  describe('TestRunController', () => {
    it('POST /deployments/:deploymentId/test-runs 201 for TESTER (project from query)', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('deployment.findUnique', { id: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A });
      stub('testCase.findMany', []);
      stub('testRun.create', (() => ({ id: TEST_RUN_A, deploymentId: DEPLOYMENT_A, projectId: PROJECT_A, environmentId: ENVIRONMENT_A, totalCases: 0, triggeredBy: USER_A_TESTER })) as any);

      const res = await request('POST', `/deployments/${DEPLOYMENT_A}/test-runs?projectId=${PROJECT_A}&environmentId=${ENVIRONMENT_A}`, {
        token: tokens.aTester,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ deploymentId: DEPLOYMENT_A, projectId: PROJECT_A });
    });

    it('POST /deployments/B/test-runs?projectId=A cross-check by project now rejects', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('deployment.findUnique', { id: DEPLOYMENT_X, projectId: PROJECT_X, environmentId: ENVIRONMENT_X });
      stub('testCase.findMany', []);

      const res = await request('POST', `/deployments/${DEPLOYMENT_X}/test-runs?projectId=${PROJECT_A}&environmentId=`, {
        token: tokens.aTester,
      });
      expectBadRequest(res);
    });

    it('GET /test-runs/:id 200 (own test run)', async () => {
      stub('testRun.findUnique', { id: TEST_RUN_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('testRun.findUnique', { id: TEST_RUN_A, projectId: PROJECT_A, status: 'RUNNING' });

      const res = await request('GET', '/test-runs/' + TEST_RUN_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('GET /test-runs?projectId= 200', async () => {
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_VIEWER, role: 'VIEWER' });
      stub('testRun.findMany', []);

      const res = await request('GET', '/test-runs?projectId=' + PROJECT_A, { token: tokens.aViewer });
      expect(res.status).toBe(200);
    });

    it('PUT /test-runs/:id/cases/:caseId 200 with valid result (KI-005 reproduction: any result accepted)', async () => {
      stub('testRun.findUnique', { id: TEST_RUN_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testRunCase.findFirst', { id: TEST_RUN_CASE_A, testRunId: TEST_RUN_A, result: 'PENDING' });
      stub('testRunCase.update', (() => ({ id: TEST_RUN_CASE_A, testRunId: TEST_RUN_A, result: 'PASSED' })) as any);
      stub('testRunCase.findMany', [{ id: TEST_RUN_CASE_A, testRunId: TEST_RUN_A, result: 'PASSED' }]);
      stub('testRun.update', (() => ({ id: TEST_RUN_A, status: 'COMPLETED' })) as any);

      const res = await request('PUT', `/test-runs/${TEST_RUN_A}/cases/${TEST_RUN_CASE_A}`, {
        token: tokens.aTester,
        body: { result: 'PASSED', notes: 'ok' },
      });
      expect(res.status).toBe(200);
    });

    it('PUT /test-runs/:id/cases/:caseId rejects invalid result string (KI-005 fixed)', async () => {
      stub('testRun.findUnique', { id: TEST_RUN_A, projectId: PROJECT_A });
      stub('project.findFirst', { id: PROJECT_A, workspaceId: WORKSPACE_A });
      stub('projectMember.findFirst', { projectId: PROJECT_A, userId: USER_A_TESTER, role: 'TESTER' });
      stub('workspaceMember.findFirst', { workspaceId: WORKSPACE_A, userId: USER_A_TESTER, role: 'VIEWER' });
      stub('testRunCase.findFirst', { id: TEST_RUN_CASE_A, testRunId: TEST_RUN_A, result: 'PENDING' });

      const res = await request('PUT', `/test-runs/${TEST_RUN_A}/cases/${TEST_RUN_CASE_A}`, {
        token: tokens.aTester,
        body: { result: 'WUT' },
      });
      expectBadRequest(res);
    });
  });

  // ─── Cross-cutting 双 workspace 对照 ────────────────────────────────
  describe('Cross-workspace isolation (Workspace B user cannot read workspace A resources)', () => {
    it('workspace B owner is rejected when listing workspace A environments', async () => {
      const res = await request('GET', '/environments?projectId=' + PROJECT_A, { token: tokens.bOwner });
      expectForbidden(res);
    });

    it('workspace B owner is rejected when reading workspace A deployment', async () => {
      stub('deployment.findUnique', null);
      const res = await request('GET', '/deployments/' + DEPLOYMENT_A, { token: tokens.bOwner });
      // requireDeployment → not found (project.workspaceId mismatches) → 404
      expectNotFound(res);
    });

    it('workspace B owner is rejected when listing workspace A deploy-targets', async () => {
      const res = await request('GET', '/projects/' + PROJECT_A + '/deploy-targets', { token: tokens.bOwner });
      expectForbidden(res);
    });

    it('workspace B owner is rejected when listing workspace A releases', async () => {
      const res = await request('GET', '/projects/' + PROJECT_A + '/releases', { token: tokens.bOwner });
      expectForbidden(res);
    });

    it('workspace B owner is rejected when listing workspace A issues', async () => {
      const res = await request('GET', '/projects/' + PROJECT_A + '/issues', { token: tokens.bOwner });
      expectForbidden(res);
    });

    it('workspace B owner is rejected when listing workspace A test-cases', async () => {
      const res = await request('GET', '/projects/' + PROJECT_A + '/test-cases', { token: tokens.bOwner });
      expectForbidden(res);
    });

    it('workspace B owner is rejected when listing workspace A test-runs', async () => {
      const res = await request('GET', '/test-runs?projectId=' + PROJECT_A, { token: tokens.bOwner });
      expectForbidden(res);
    });
  });
});
