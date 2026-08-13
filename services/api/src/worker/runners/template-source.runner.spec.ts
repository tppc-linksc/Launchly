/* eslint-disable @typescript-eslint/no-explicit-any */
import { TemplateSourceRunner } from './template-source.runner';
import { RunnerContext } from './runner.factory';

// ─── fs mock (per-method, default safe values; test installs stricter impls) ─

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  const safe = () => jest.fn();
  const overrides: any = {
    rmSync: safe(),
    mkdirSync: safe(),
    writeFileSync: safe(),
  };
  (real as any).__launchlyFsOverrides = overrides;
  return new Proxy(real, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop as string];
      return (target as any)[prop];
    },
  });
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
const fsMock = (fs as any).__launchlyFsOverrides as {
  rmSync: jest.Mock;
  mkdirSync: jest.Mock;
  writeFileSync: jest.Mock;
};

const unexpectedSync = (name: string) => (...args: unknown[]) => {
  throw new Error(`Unexpected unconfigured fs.${name} call: ${JSON.stringify(args)}`);
};

beforeEach(() => {
  for (const fn of Object.values(fsMock)) {
    fn.mockReset();
  }
  fsMock.rmSync.mockImplementation(unexpectedSync('rmSync'));
  fsMock.mkdirSync.mockImplementation(unexpectedSync('mkdirSync'));
  fsMock.writeFileSync.mockImplementation(unexpectedSync('writeFileSync'));
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

const EXPECTED_DOCKERFILE = 'FROM nginx:1.27-alpine\nCOPY index.html /usr/share/nginx/html/index.html\nEXPOSE 80\n';

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'TEMPLATE_SOURCE',
    refId: 'deploy-1',
    payload: { templateId: 'static-blog' },
    stageLogCallback: jest.fn(async () => undefined),
    ...over,
  };
}

function makeRunner() {
  return new TemplateSourceRunner();
}

// ─── A. Unsupported template ──────────────────────────────────────────────

describe('TemplateSourceRunner.execute - unsupported template', () => {
  it('rejects non-static-blog templateId without touching fs or callback', async () => {
    const runner = makeRunner();
    const result = await runner.execute(makeContext({ payload: { templateId: 'fancy-template' } }));
    expect(result).toEqual({ success: false, stdout: '', stderr: 'Template is not supported by the deployment executor', exitCode: -1, errorMessage: 'Template is not supported by the deployment executor' });
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects when templateId is missing entirely', async () => {
    const runner = makeRunner();
    const result = await runner.execute(makeContext({ payload: {} }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Template is not supported by the deployment executor');
    expect(fsMock.rmSync).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('rejects with TypeError before filesystem access when payload is %s (current behavior)', async (_label, payload) => {
    const runner = makeRunner();

    await expect(runner.execute(makeContext({ payload: payload as any }))).rejects.toBeInstanceOf(TypeError);

    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });
});

// ─── B. Default title ──────────────────────────────────────────────────────

describe('TemplateSourceRunner.execute - default title', () => {
  it('uses "Launchly Blog" when templateTitle is missing', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const result = await runner.execute(makeContext({ payload: { templateId: 'static-blog' } }));
    expect(result.success).toBe(true);
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain('<title>Launchly Blog</title>');
    expect(indexHtml).toContain('<h1>Launchly Blog</h1>');
  });

  it('uses "Launchly Blog" when templateTitle is null (current behavior)', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const result = await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: null } }));
    expect(result.success).toBe(true);
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1];
    expect(indexHtml).toContain('<title>Launchly Blog</title>');
  });
});

// ─── C. Custom title and HTML escape ──────────────────────────────────────

describe('TemplateSourceRunner.execute - custom title HTML escape (hard-coded expected strings)', () => {
  it('passes through a normal title unchanged', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: 'My Blog Post' } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain('<title>My Blog Post</title>');
    expect(indexHtml).toContain('<h1>My Blog Post</h1>');
  });

  it('escapes & as &amp; in title', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: 'Tom & Jerry' } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain('<title>Tom &amp; Jerry</title>');
    expect(indexHtml).toContain('<h1>Tom &amp; Jerry</h1>');
    expect(indexHtml).not.toContain('Tom & Jerry<'); // raw & not before any tag
  });

  it('escapes < and > as &lt; and &gt;', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: '<script>alert(1)</script>' } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>');
    expect(indexHtml).toContain('<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>');
  });

  it('escapes " as &quot;', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: 'He said "hi"' } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain('<title>He said &quot;hi&quot;</title>');
  });

  it(`escapes ' as &#39;`, async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: "Don't panic" } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain("<title>Don&#39;t panic</title>");
  });

  it('escapes all five special chars in one title (order: & first)', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: `& <tag> "x" 'y'` } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    // & is escaped first so it does not double-encode
    expect(indexHtml).toContain('<title>&amp; &lt;tag&gt; &quot;x&quot; &#39;y&#39;</title>');
  });
});

// ─── D. 120-char truncation ────────────────────────────────────────────────

describe('TemplateSourceRunner.execute - title truncation boundary', () => {
  it('accepts exactly 120 chars without truncation (no suffix/ellipsis added)', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const title = 'a'.repeat(120);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: title } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(indexHtml).toContain(`<title>${title}</title>`);
    expect(indexHtml).toContain(`<h1>${title}</h1>`);
  });

  it('truncates 121-char title to the first 120 chars (hard-coded expected)', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const title = 'a'.repeat(121);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: title } }));
    const indexHtml = fsMock.writeFileSync.mock.calls[1][1] as string;
    const expectedTruncated = 'a'.repeat(120);
    expect(indexHtml).toContain(`<title>${expectedTruncated}</title>`);
    // The 121st char must NOT appear in the title element.
    const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1]).toBe(expectedTruncated);
    expect(titleMatch![1].length).toBe(120);
  });
});

// ─── E. File operations and ordering ───────────────────────────────────────

describe('TemplateSourceRunner.execute - file operations', () => {
  it('writes Dockerfile then index.html with mode 0600 in a workDir joined with BUILD_ROOT', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const result = await runner.execute(makeContext({ payload: { templateId: 'static-blog' } }));
    expect(result.success).toBe(true);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, mode: 0o700 });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2);
    expect(fsMock.writeFileSync.mock.calls[0][0]).toBe('/tmp/launchly-builds/deploy-1/Dockerfile');
    expect(fsMock.writeFileSync.mock.calls[0][1]).toBe(EXPECTED_DOCKERFILE);
    expect(fsMock.writeFileSync.mock.calls[0][2]).toEqual({ mode: 0o600 });
    expect(fsMock.writeFileSync.mock.calls[1][0]).toBe('/tmp/launchly-builds/deploy-1/index.html');
    expect(fsMock.writeFileSync.mock.calls[1][2]).toEqual({ mode: 0o600 });
  });

  it('Dockerfile content is exactly the documented nginx:1.27-alpine manifest', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog' } }));
    expect(fsMock.writeFileSync.mock.calls[0][1]).toBe(EXPECTED_DOCKERFILE);
  });

  it('index.html contains the doctype, language, viewport meta, and the title element (structure check)', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    await runner.execute(makeContext({ payload: { templateId: 'static-blog', templateTitle: 'My Site' } }));
    const html = fsMock.writeFileSync.mock.calls[1][1] as string;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('viewport" content="width=device-width,initial-scale=1"');
    expect(html).toContain('<title>My Site</title>');
    expect(html).toContain('<h1>My Site</h1>');
  });
});

// ─── F. Callback timing and content ────────────────────────────────────────

describe('TemplateSourceRunner.execute - stageLogCallback', () => {
  it('invokes callback exactly once with RUNNING + "Created reviewed static-blog template source" after both writes', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    await runner.execute(ctx);
    expect(ctx.stageLogCallback).toHaveBeenCalledTimes(1);
    expect(ctx.stageLogCallback).toHaveBeenCalledWith('RUNNING', 'Created reviewed static-blog template source');
  });

  it('callback is invoked AFTER both writeFileSync calls (rm, mkdir, write-dockerfile, write-indexhtml, callback)', async () => {
    const runner = makeRunner();
    const callOrder: string[] = [];
    fsMock.rmSync.mockImplementation((..._a: any[]) => { callOrder.push('rm'); return undefined; });
    fsMock.mkdirSync.mockImplementation((..._a: any[]) => { callOrder.push('mkdir'); return undefined; });
    fsMock.writeFileSync.mockImplementation((p: any) => {
      callOrder.push(p && typeof p === 'string' && p.endsWith('Dockerfile') ? 'write-dockerfile' : 'write-indexhtml');
      return undefined;
    });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    (ctx.stageLogCallback as jest.Mock).mockImplementation(async () => { callOrder.push('cb'); });
    await runner.execute(ctx);
    expect(callOrder).toEqual(['rm', 'mkdir', 'write-dockerfile', 'write-indexhtml', 'cb']);
  });
});

// ─── G. Side-effect error propagation ─────────────────────────────────────

describe('TemplateSourceRunner.execute - side-effect error propagation', () => {
  it('rmSync throws: failure with that message; no mkdir, no writes, no callback', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockImplementationOnce(() => { throw new Error('EACCES on rm'); });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES on rm');
    expect(result.stderr).toBe('EACCES on rm');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(ctx.stageLogCallback).not.toHaveBeenCalled();
  });

  it('mkdirSync throws: failure with that message; no writes, no callback', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockImplementationOnce(() => { throw new Error('EACCES on mkdir'); });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES on mkdir');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(ctx.stageLogCallback).not.toHaveBeenCalled();
  });

  it('Dockerfile writeFileSync throws: failure, no index.html write, no callback', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC on dockerfile'); });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ENOSPC on dockerfile');
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(ctx.stageLogCallback).not.toHaveBeenCalled();
  });

  it('index.html writeFileSync throws: failure, callback not invoked', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockImplementationOnce(() => { throw new Error('ENOSPC on index'); });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ENOSPC on index');
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2);
    expect(ctx.stageLogCallback).not.toHaveBeenCalled();
  });

  it('stageLogCallback throws: failure with that message', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });
    (ctx.stageLogCallback as jest.Mock).mockRejectedValueOnce(new Error('callback rejected'));
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('callback rejected');
  });

  it('an error without a message uses the generic template failure', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockImplementationOnce(() => { throw {}; });
    const ctx = makeContext({ payload: { templateId: 'static-blog' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Unable to create template source',
      exitCode: -1,
      errorMessage: 'Unable to create template source',
    });
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(ctx.stageLogCallback).not.toHaveBeenCalled();
  });
});

// ─── H. Path traversal boundary ───────────────────────────────────────────

describe('TemplateSourceRunner.execute - refId path boundary (current behavior is a candidate defect)', () => {
  it('workDir is path.join(BUILD_ROOT, unvalidated refId) which normalizes ../ to escape BUILD_ROOT', async () => {
    const runner = makeRunner();
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    const result = await runner.execute(makeContext({ refId: '../escape-1', payload: { templateId: 'static-blog' } }));
    expect(result.success).toBe(true);
    // path.join normalizes, so the workDir escapes BUILD_ROOT.
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/escape-1', { recursive: true, mode: 0o700 });
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/escape-1', { recursive: true, force: true });
    expect(fsMock.writeFileSync.mock.calls[0][0]).toBe('/tmp/escape-1/Dockerfile');
    expect(fsMock.writeFileSync.mock.calls[1][0]).toBe('/tmp/escape-1/index.html');
  });
});
