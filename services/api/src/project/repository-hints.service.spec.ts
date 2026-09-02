import { RepositoryHintsService } from './repository-hints.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

const ORIGINAL_FETCH: typeof fetch | undefined = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function notFoundResponse(): Response {
  return { ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve('') } as unknown as Response;
}

function headResponse(ok: boolean, status: number): Response {
  return { ok, status, statusText: '', text: () => Promise.resolve('') } as unknown as Response;
}

function emptyGetResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve('') } as unknown as Response;
}

/**
 * fetch call ordering for `infer(repo, 'main')` on GitHub HTTPS with no `packageManager` field:
 *  1. package.json GET
 *  2. pnpm-lock.yaml HEAD
 *  3. (if HEAD 404/405) pnpm-lock.yaml GET fallback
 *  4. yarn.lock HEAD
 *  5. (if HEAD 404/405) yarn.lock GET fallback
 *  6. README GET
 */

describe('RepositoryHintsService', () => {
  let service: RepositoryHintsService;
  // PrismaService is injected but not exercised by infer() / fillBlanksFromRepository().
  let prisma: MockPrismaService;
  const fetchMock: jest.Mock = jest.fn();
  let unexpectedFetches: string[];

  beforeEach(() => {
    unexpectedFetches = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      unexpectedFetches.push(String(input));
      return Promise.reject(new Error(`Unexpected unconfigured fetch: ${String(input)}`));
    });
    prisma = createPrismaMock();
    service = new RepositoryHintsService(prisma as any);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH as typeof fetch;
    jest.restoreAllMocks();
    expect(unexpectedFetches).toEqual([]);
  });

  describe('A. repository URL → raw URL building', () => {
    it('GitHub HTTPS URL → raw.githubusercontent.com/.../package.json', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // pnpm HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // pnpm GET fallback (empty)
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // yarn HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // yarn GET fallback (empty)
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(result).not.toBeNull();
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/app/main/package.json');
      expect(urls).toContain('https://raw.githubusercontent.com/acme/app/main/README.md');
    });

    it('GitHub SSH URL → raw.githubusercontent.com/.../package.json (documents a real regex quirk with ".git" suffix)', async () => {
      // GITHUB_SSH = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?/i
      // Because m[2] is non-greedy and the trailing (?:\.git)? is optional, with input
      // "git@github.com:acme/app.git" the regex matches m[1]="acme", m[2]="a", leaving
      // "pp.git" unmatched. This is a candidate production defect — documenting the
      // CURRENT behaviour, not endorsing it.
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('git@github.com:acme/app.git', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(result).not.toBeNull();
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/a/main/package.json');
      expect(urls).toContain('https://raw.githubusercontent.com/acme/a/main/README.md');
    });

    it('GitHub SSH URL without ".git" suffix: same regex quirk still produces a 1-char repo segment', async () => {
      // Same bug as the .git-suffix case: GITHUB_SSH's non-greedy m[2] + optional
      // (?:\.git)? means the regex always stops after the first character of the
      // repo segment, leaving the rest of the input unmatched. The current code can
      // therefore never resolve a GitHub SSH URL to the correct raw path.
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('git@github.com:acme/app', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(result).not.toBeNull();
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/a/main/package.json');
      expect(urls).toContain('https://raw.githubusercontent.com/acme/a/main/README.md');
    });

    it('GitLab HTTPS URL → gitlab.com/<path>/-/raw/<ref>/package.json', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://gitlab.com/acme/app.git', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(result).not.toBeNull();
      expect(urls[0]).toBe('https://gitlab.com/acme/app/-/raw/main/package.json');
      expect(urls).toContain('https://gitlab.com/acme/app/-/raw/main/README.md');
    });

    it('Gitee HTTPS URL → gitee.com/<path>/raw/<ref>/package.json', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://gitee.com/acme/app.git', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(result).not.toBeNull();
      expect(urls[0]).toBe('https://gitee.com/acme/app/raw/main/package.json');
      expect(urls).toContain('https://gitee.com/acme/app/raw/main/README.md');
    });

    it('branch containing "/" is percent-encoded as %2F', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      await service.infer('https://github.com/acme/app.git', 'feature/foo');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/app/feature%2Ffoo/package.json');
    });

    it('returns null and never calls fetch for an invalid repository URL', async () => {
      const result = await service.infer('https://example.com/foo/bar', 'main');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null for an empty repositoryUrl', async () => {
      const result = await service.infer('', 'main');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null for an empty branch', async () => {
      const result = await service.infer('https://github.com/acme/app.git', '');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('B. package manager detection', () => {
    it('uses packageManager field "pnpm@..." to pick PNPM', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          packageManager: 'pnpm@8.0.0',
          scripts: { build: 'vite build', start: 'vite preview', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
      expect(result!.buildCommand).toBe('pnpm run build');
      expect(result!.startCommand).toBe('pnpm start');
      expect(result!.testCommand).toBe('pnpm run test');
    });

    it('uses packageManager field "yarn@..." to pick YARN', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          packageManager: 'yarn@4.0.0',
          scripts: { build: 'vite build', start: 'vite preview', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && yarn install --immutable');
      expect(result!.buildCommand).toBe('yarn build');
      expect(result!.startCommand).toBe('yarn start');
      expect(result!.testCommand).toBe('yarn test');
    });

    it('falls back to NPM when neither packageManager nor lockfiles are found', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // pnpm HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // pnpm GET fallback (empty)
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // yarn HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // yarn GET fallback (empty)
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
      expect(result!.startCommand).toBe('npm start');
    });

    it('uses pnpm-lock.yaml HEAD success to pick PNPM (no fallback GET, no yarn HEAD)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(true, 200)); // pnpm HEAD 200
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith('yarn.lock'))).toBe(false);
    });

    it('uses yarn.lock HEAD success to pick YARN when pnpm-lock.yaml is missing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // pnpm HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // pnpm GET fallback (empty)
      fetchMock.mockResolvedValueOnce(headResponse(true, 200)); // yarn HEAD 200
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && yarn install --immutable');
    });

    it('prefers PNPM over YARN', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(true, 200)); // pnpm HEAD 200
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      await service.infer('https://github.com/acme/app.git', 'main');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith('yarn.lock'))).toBe(false);
    });

    it('falls back to GET when HEAD returns 405', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 405)); // pnpm HEAD 405
      fetchMock.mockResolvedValueOnce(jsonResponse('lockfile-content')); // pnpm GET fallback
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
    });

    it('falls back to GET when HEAD returns 404', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // pnpm HEAD 404
      fetchMock.mockResolvedValueOnce(jsonResponse('lockfile-content')); // pnpm GET fallback
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
    });

    it('falls back to GET when HEAD itself throws (timeout / network error)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockRejectedValueOnce(new Error('aborted')); // pnpm HEAD throws
      fetchMock.mockResolvedValueOnce(jsonResponse('lockfile-content')); // pnpm GET fallback
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
    });

    it('empty / whitespace fallback body is treated as resource-missing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 405)); // pnpm HEAD
      fetchMock.mockResolvedValueOnce(jsonResponse('   ')); // pnpm GET fallback (whitespace)
      fetchMock.mockResolvedValueOnce(headResponse(false, 404)); // yarn HEAD
      fetchMock.mockResolvedValueOnce(emptyGetResponse()); // yarn GET fallback (empty)
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
    });

    it('does not mistake other non-2xx HEAD statuses (e.g. 500) for existing (no fallback GET for 500)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' })); // package.json
      fetchMock.mockResolvedValueOnce(headResponse(false, 500)); // pnpm HEAD 500
      fetchMock.mockResolvedValueOnce(headResponse(false, 500)); // yarn HEAD 500
      fetchMock.mockResolvedValueOnce(notFoundResponse()); // README

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      // No fallback GET for 500 — only the two HEADs and the README
      expect(urls.filter((u) => u.includes('pnpm-lock') || u.includes('yarn.lock'))).toHaveLength(2);
    });
  });

  describe('C. scripts and ports', () => {
    it('returns build/test commands when scripts are present', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          scripts: { build: 'vite build', start: 'vite preview --port 4173', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.buildCommand).toBe('npm run build');
      expect(result!.testCommand).toBe('npm run test');
    });

    it('buildCommand is null when build script is absent', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: { start: 'node server.js' } }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.buildCommand).toBeNull();
    });

    it('testCommand is null when test script is absent', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: { start: 'node server.js' } }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.testCommand).toBeNull();
    });

    it('start script missing: startCommand and defaultPort keep the current defaults (candidate defect)', async () => {
      // Current production behaviour: when `scripts.start` is absent, the service still
      // returns the package-manager's placeholder start command ("npm start") and a port
      // of 3000. The helper startCommand() / parsePortFromStart() / default-port logic
      // do not consider whether `scripts.start` actually exists in package.json.
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: {} }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.startCommand).toBe('npm start');
      expect(result!.defaultPort).toBe(3000);
    });

    it.each([
      ['--port 4173', 4173],
      ['-p 8080', 8080],
      ['PORT=5000', 5000],
      ['PORT = 5000', 5000],
    ])('parses port from start script: %s', async (startScript, expectedPort) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: { start: `node server.js ${startScript}` } }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.defaultPort).toBe(expectedPort);
    });

    it('defaults port to 3000 when no port marker is present', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: { start: 'node server.js' } }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.defaultPort).toBe(3000);
    });

    it('handles missing or empty scripts object gracefully', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: {} }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
      expect(result!.startCommand).toBe('npm start');
      expect(result!.buildCommand).toBeNull();
      expect(result!.testCommand).toBeNull();
      expect(result!.defaultPort).toBe(3000);
    });

    it('source is "package.json" by default', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scripts: {} }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.source).toBe('package.json');
    });
  });

  describe('D. README install-line override (NPM only)', () => {
    it('NPM: README pnpm line overrides installCommand; source becomes package.json+readme', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(jsonResponse('# App\n\npnpm install\n'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('pnpm install');
      expect(result!.source).toBe('package.json+readme');
    });

    it('NPM: README yarn line overrides installCommand; source becomes package.json+readme', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(jsonResponse('# App\n\nyarn add\n'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('yarn add');
      expect(result!.source).toBe('package.json+readme');
    });

    it('NPM: README plain npm line does not trigger override (source remains package.json)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(jsonResponse('# App\n\nnpm install\n'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
      expect(result!.source).toBe('package.json');
    });

    it('PNPM already detected: README must NOT override installCommand', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ packageManager: 'pnpm@8.0.0' }));
      fetchMock.mockResolvedValueOnce(jsonResponse('# App\n\nyarn add\n'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
      expect(result!.source).toBe('package.json');
    });

    it('YARN already detected: README must NOT override installCommand', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ packageManager: 'yarn@4.0.0' }));
      fetchMock.mockResolvedValueOnce(jsonResponse('# App\n\npnpm install\n'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && yarn install --immutable');
      expect(result!.source).toBe('package.json');
    });

    it.each([
      ['non-2xx response', notFoundResponse()],
      ['empty response', emptyGetResponse()],
      ['content without an install command', jsonResponse('# App\n\nInstall dependencies before building.\n')],
    ])('README %s falls through to package.json-only', async (_label, readmeResponse) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(readmeResponse);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.source).toBe('package.json');
      expect(result!.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
    });
  });

  describe('E. network and content failures', () => {
    it('package.json GET returning non-2xx → null', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: () => Promise.resolve(''),
      } as any);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).toBeNull();
    });

    it('package.json fetch rejection (timeout / network error) → null', async () => {
      fetchMock.mockRejectedValueOnce(new Error('aborted'));

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).toBeNull();
    });

    it('package.json body is invalid JSON → null', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('not valid json{') } as any);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).toBeNull();
    });

    it('package.json body over 2,000,000 characters → null', async () => {
      const tooBig = 'a'.repeat(2_000_001);
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(tooBig) } as any);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).toBeNull();
    });

    it('empty package.json body → null', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('') } as any);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).toBeNull();
    });

    it('README non-2xx is treated as no-readme; result still succeeds with package.json-only', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: () => Promise.resolve(''),
      } as any);

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result).not.toBeNull();
      expect(result!.source).toBe('package.json');
    });

    it('lockfile HEAD 405 then 200 fallback body is treated as existing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 405));
      fetchMock.mockResolvedValueOnce(jsonResponse('lock'));
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const result = await service.infer('https://github.com/acme/app.git', 'main');

      expect(result!.installCommand).toBe('corepack enable && pnpm install --frozen-lockfile');
    });
  });

  describe('F. fillBlanksFromRepository', () => {
    it('returns immediately without network calls when repositoryUrl is missing', async () => {
      const proj: { defaultBranch: string; installCommand?: string | null } = { defaultBranch: 'main' };

      await service.fillBlanksFromRepository(proj as any);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(proj.installCommand).toBeUndefined();
    });

    it('does not change project when infer returns null', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') } as any);

      const proj: any = {
        repositoryUrl: 'https://github.com/acme/app.git',
        defaultBranch: 'main',
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        testCommand: null,
        defaultPort: null,
        healthCheckPath: null,
      };

      await service.fillBlanksFromRepository(proj);

      expect(proj.installCommand).toBeNull();
      expect(proj.buildCommand).toBeNull();
      expect(proj.startCommand).toBeNull();
      expect(proj.testCommand).toBeNull();
      expect(proj.defaultPort).toBeNull();
      expect(proj.healthCheckPath).toBeNull();
    });

    it('keeps already-set (non-null, non-undefined, non-empty) fields untouched', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          scripts: { build: 'vite build', start: 'node server.js --port 4173', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const proj: any = {
        repositoryUrl: 'https://github.com/acme/app.git',
        defaultBranch: 'main',
        installCommand: 'EXISTING-INSTALL',
        buildCommand: 'EXISTING-BUILD',
        startCommand: 'EXISTING-START',
        testCommand: 'EXISTING-TEST',
        defaultPort: 9000,
        healthCheckPath: '/existing',
      };

      await service.fillBlanksFromRepository(proj);

      expect(proj.installCommand).toBe('EXISTING-INSTALL');
      expect(proj.buildCommand).toBe('EXISTING-BUILD');
      expect(proj.startCommand).toBe('EXISTING-START');
      expect(proj.testCommand).toBe('EXISTING-TEST');
      expect(proj.defaultPort).toBe(9000);
      expect(proj.healthCheckPath).toBe('/existing');
    });

    it('fills null / undefined / empty fields with inferred values', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          scripts: { build: 'vite build', start: 'node server.js --port 4173', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const proj: any = {
        repositoryUrl: 'https://github.com/acme/app.git',
        defaultBranch: 'main',
        installCommand: null,
        buildCommand: undefined,
        startCommand: '',
        testCommand: null,
        defaultPort: null,
        healthCheckPath: '',
      };

      await service.fillBlanksFromRepository(proj);

      expect(proj.installCommand).toBe('npm ci --omit=dev || npm install --omit=dev');
      expect(proj.buildCommand).toBe('npm run build');
      expect(proj.testCommand).toBe('npm run test');
      // startCommand is filled by the startCommand() helper, ignoring the empty-string sentinel
      expect(proj.startCommand).toBe('npm start');
      expect(proj.defaultPort).toBe(4173);
    });

    it('uses "main" as the default branch when defaultBranch is missing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      await service.fillBlanksFromRepository({ repositoryUrl: 'https://github.com/acme/app.git' } as any);

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/app/main/package.json');
    });

    it('trims the repositoryUrl before building the package.json URL', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'app' }));
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      await service.fillBlanksFromRepository({
        repositoryUrl: '  https://github.com/acme/app.git  ',
        defaultBranch: 'main',
      } as any);

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toBe('https://raw.githubusercontent.com/acme/app/main/package.json');
    });

    it('final project object after fillBlanksFromRepository has the inferred values', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          scripts: { build: 'vite build', start: 'node server.js --port 4173', test: 'vitest run' },
        }),
      );
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(headResponse(false, 404));
      fetchMock.mockResolvedValueOnce(emptyGetResponse());
      fetchMock.mockResolvedValueOnce(notFoundResponse());

      const proj: any = {
        repositoryUrl: 'https://github.com/acme/app.git',
        defaultBranch: 'main',
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        testCommand: null,
        defaultPort: null,
        healthCheckPath: null,
      };

      await service.fillBlanksFromRepository(proj);

      // Final object assertion: not just "infer was called".
      // Note: healthCheckPath is never filled by current production code because
      // infer() always returns healthCheckPath=null, and the guard
      // `!project.healthCheckPath && hints.healthCheckPath` evaluates to false.
      expect(proj).toEqual({
        repositoryUrl: 'https://github.com/acme/app.git',
        defaultBranch: 'main',
        installCommand: 'npm ci --omit=dev || npm install --omit=dev',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        testCommand: 'npm run test',
        defaultPort: 4173,
        healthCheckPath: null,
      });
    });
  });
});
