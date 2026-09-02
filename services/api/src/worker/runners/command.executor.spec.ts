/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import { CommandExecutor } from './command.executor';

// ─── child_process.spawn mock ──────────────────────────────────────────────

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

interface SpawnCall {
  command: string;
  args: string[];
  options: any;
}

let lastSpawn: SpawnCall | null = null;
let lastProcess: MockProcess | null = null;
let allowedSpawnCalls = 0;

class MockProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

vi.mock('child_process', async () => {
  const real = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...real,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      if (allowedSpawnCalls <= 0) {
        throw new Error(`Unexpected unconfigured spawn call: ${command}`);
      }
      allowedSpawnCalls--;
      const proc = new MockProc();
      lastSpawn = { command, args, options };
      lastProcess = proc;
      return proc;
    }),
  };
});

const spawnMock = cp.spawn as unknown as vi.Mock;

function makeExecutor() {
  allowedSpawnCalls++;
  return new CommandExecutor();
}

function nextProc(): MockProc {
  if (!lastProcess) throw new Error('spawn was not called yet');
  return lastProcess;
}

function emitClose(code: number | null) {
  nextProc().emit('close', code);
}

function emitStdout(chunk: string | Buffer) {
  nextProc().stdout.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

function emitStderr(chunk: string | Buffer) {
  nextProc().stderr.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

function emitError(err: Error) {
  nextProc().emit('error', err);
}

beforeEach(() => {
  spawnMock.mockClear();
  lastSpawn = null;
  lastProcess = null;
  allowedSpawnCalls = 0;
});

// ─── exec() ────────────────────────────────────────────────────────────────

describe('CommandExecutor.exec - spawn wiring', () => {
  it('spawns bash with the exact command via ["-c", command]', async () => {
    const exec = makeExecutor().exec('echo hello');
    await Promise.resolve();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(lastSpawn!.command).toBe('bash');
    expect(lastSpawn!.args).toEqual(['-c', 'echo hello']);
    emitClose(0);
    await exec;
  });

  it('defaults timeout to 300_000 ms when not provided', async () => {
    const exec = makeExecutor().exec('echo x');
    await Promise.resolve();
    expect(lastSpawn!.options.timeout).toBe(300 * 1000);
    emitClose(0);
    await exec;
  });

  it('multiplies a custom timeout by 1000', async () => {
    const exec = makeExecutor().exec('echo x', { timeout: 7 });
    await Promise.resolve();
    expect(lastSpawn!.options.timeout).toBe(7 * 1000);
    emitClose(0);
    await exec;
  });

  it('passes cwd through unchanged when provided', async () => {
    const exec = makeExecutor().exec('pwd', { cwd: '/var/lib/launchly' });
    await Promise.resolve();
    expect(lastSpawn!.options.cwd).toBe('/var/lib/launchly');
    emitClose(0);
    await exec;
  });

  it('omits cwd when not provided (undefined, not empty string)', async () => {
    const exec = makeExecutor().exec('pwd');
    await Promise.resolve();
    expect(lastSpawn!.options.cwd).toBeUndefined();
    emitClose(0);
    await exec;
  });

  it('merges process.env with options.env and lets options.env win on conflict', async () => {
    const prev = process.env.LAUNCHLY_TEST_EXISTING;
    process.env.LAUNCHLY_TEST_EXISTING = 'from-process';
    try {
      const exec = makeExecutor().exec('env', {
        env: { LAUNCHLY_TEST_EXISTING: 'from-options', LAUNCHLY_TEST_NEW: 'new' },
      });
      await Promise.resolve();
      const env = lastSpawn!.options.env as Record<string, string>;
      expect(env.LAUNCHLY_TEST_EXISTING).toBe('from-options');
      expect(env.LAUNCHLY_TEST_NEW).toBe('new');
      // Inherited entries from process.env should also be present.
      expect(env.PATH).toBeDefined();
      emitClose(0);
      await exec;
    } finally {
      if (prev === undefined) delete process.env.LAUNCHLY_TEST_EXISTING;
      else process.env.LAUNCHLY_TEST_EXISTING = prev;
    }
  });
});

describe('CommandExecutor.exec - stdout/stderr/close behaviour', () => {
  it('concatenates multiple stdout chunks in order and resolves on close(0)', async () => {
    const promise = makeExecutor().exec('chunked');
    await Promise.resolve();
    emitStdout(Buffer.from('line-1\n'));
    emitStdout(Buffer.from('line-2\n'));
    emitStdout(Buffer.from('line-3'));
    emitClose(0);
    await expect(promise).resolves.toEqual({ stdout: 'line-1\nline-2\nline-3', stderr: '', exitCode: 0 });
  });

  it('concatenates multiple stderr chunks separately from stdout', async () => {
    const promise = makeExecutor().exec('mixed');
    await Promise.resolve();
    emitStdout(Buffer.from('out-a'));
    emitStderr(Buffer.from('err-a\n'));
    emitStdout(Buffer.from('out-b'));
    emitStderr(Buffer.from('err-b'));
    emitClose(1);
    await expect(promise).resolves.toEqual({ stdout: 'out-aout-b', stderr: 'err-a\nerr-b', exitCode: 1 });
  });

  it('resolves with exitCode -1 when close fires with null (current behavior)', async () => {
    const promise = makeExecutor().exec('null-close');
    await Promise.resolve();
    emitClose(null);
    await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: -1 });
  });

  it('does NOT reject on close with non-zero code; that is a normal exit', async () => {
    const promise = makeExecutor().exec('fail-42');
    await Promise.resolve();
    emitClose(42);
    await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: 42 });
  });

  it('rejects with the original Error when the process emits error', async () => {
    const err = new Error('spawn ENOENT');
    const promise = makeExecutor().exec('missing');
    await Promise.resolve();
    emitError(err);
    await expect(promise).rejects.toBe(err);
  });
});

// ─── execFile() ────────────────────────────────────────────────────────────

describe('CommandExecutor.execFile - spawn wiring', () => {
  it('passes command and args separately; does not invoke bash', async () => {
    const promise = makeExecutor().execFile('/usr/bin/git', ['rev-parse', 'HEAD']);
    await Promise.resolve();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(lastSpawn!.command).toBe('/usr/bin/git');
    expect(lastSpawn!.args).toEqual(['rev-parse', 'HEAD']);
    expect(lastSpawn!.options.shell).toBe(false);
    emitClose(0);
    await promise;
  });

  it('preserves the caller-supplied args array exactly (no mutation, no extra elements)', async () => {
    const originalArgs = [
      '--upload-file',
      '/tmp/file with spaces.txt; rm -rf $HOME',
      '$(echo evil)',
      '`echo backtick`',
    ];
    const argsCopy = [...originalArgs];
    const promise = makeExecutor().execFile('/usr/bin/rsync', originalArgs);
    await Promise.resolve();
    expect(lastSpawn!.args).toEqual(argsCopy);
    expect(originalArgs).toEqual(argsCopy); // not mutated
    expect(lastSpawn!.args[0]).toBe('--upload-file');
    expect(lastSpawn!.args[1]).toBe('/tmp/file with spaces.txt; rm -rf $HOME');
    expect(lastSpawn!.args[2]).toBe('$(echo evil)');
    expect(lastSpawn!.args[3]).toBe('`echo backtick`');
    emitClose(0);
    await promise;
  });

  it('does not put the command itself into args[0] and does not add ["-c", ...]', async () => {
    const promise = makeExecutor().execFile('docker', ['ps', '-a']);
    await Promise.resolve();
    expect(lastSpawn!.args).toEqual(['ps', '-a']);
    expect(lastSpawn!.args).not.toContain('-c');
    emitClose(0);
    await promise;
  });

  it('sets shell:false so spaces, semicolons, and shell metachars in args are not interpreted as shell', async () => {
    const promise = makeExecutor().execFile('binary', ['echo a; b', '$HOME', '`cmd`']);
    await Promise.resolve();
    expect(lastSpawn!.options.shell).toBe(false);
    // The args must be three separate elements, not a single shell string.
    expect(lastSpawn!.args).toHaveLength(3);
    expect(lastSpawn!.args[0]).toContain(' ');
    expect(lastSpawn!.args[1]).toBe('$HOME');
    expect(lastSpawn!.args[2]).toBe('`cmd`');
    emitClose(0);
    await promise;
  });

  it('uses default timeout 300_000 ms and multiplies custom timeout by 1000', async () => {
    const p1 = makeExecutor().execFile('bin', []);
    await Promise.resolve();
    expect(lastSpawn!.options.timeout).toBe(300 * 1000);
    emitClose(0);
    await p1;

    const p2 = makeExecutor().execFile('bin', [], { timeout: 9 });
    await Promise.resolve();
    expect(lastSpawn!.options.timeout).toBe(9 * 1000);
    emitClose(0);
    await p2;
  });

  it('passes cwd and merges env like exec()', async () => {
    const promise = makeExecutor().execFile('bin', [], { cwd: '/srv', env: { FOO: 'bar' } });
    await Promise.resolve();
    expect(lastSpawn!.options.cwd).toBe('/srv');
    expect((lastSpawn!.options.env as Record<string, string>).FOO).toBe('bar');
    emitClose(0);
    await promise;
  });

  it('resolves on close(0) with concatenated stdout and stderr', async () => {
    const promise = makeExecutor().execFile('bin', []);
    await Promise.resolve();
    emitStdout('a');
    emitStderr('b');
    emitClose(0);
    await expect(promise).resolves.toEqual({ stdout: 'a', stderr: 'b', exitCode: 0 });
  });

  it('resolves with exitCode -1 on null close', async () => {
    const promise = makeExecutor().execFile('bin', []);
    await Promise.resolve();
    emitClose(null);
    await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: -1 });
  });

  it('rejects on process error', async () => {
    const err = new Error('EACCES');
    const promise = makeExecutor().execFile('bin', []);
    await Promise.resolve();
    emitError(err);
    await expect(promise).rejects.toBe(err);
  });
});

// ─── sanitize() ────────────────────────────────────────────────────────────

describe('CommandExecutor.sanitize - structured key/value secrets', () => {
  it.each([
    ['password=hunter2', 'password'],
    ['PASSWORD=hunter2', 'PASSWORD'],
    ['password: hunter2', 'password'],
    ['password : "hunter2 with spaces"', 'password'],
    [`password='hunter2'`, 'password'],
    ['token=abc.def.ghi', 'token'],
    ['token : abc123', 'token'],
    ['secret=topsecret', 'secret'],
    ['SECRET=topsecret', 'SECRET'],
    ['api_key=ABC123', 'api_key'],
    ['api-key=ABC123', 'api-key'],
    ['api_key : "v2:abc"', 'api_key'],
    ['private_key=PRIV', 'private_key'],
    ['private-key=PRIV', 'private-key'],
    ['credential: "user:pass"', 'credential'],
  ])('redacts %s and removes the original %s value', (input, _label) => {
    const out = CommandExecutor.sanitize(input);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('topsecret');
    expect(out).not.toContain('ABC123');
    expect(out).not.toContain('v2:abc');
    expect(out).not.toContain('PRIV');
    expect(out).not.toContain('user:pass');
    expect(out).toContain('[REDACTED]');
  });
});

describe('CommandExecutor.sanitize - auth headers and provider tokens', () => {
  it('redacts Authorization Bearer tokens', () => {
    const out = CommandExecutor.sanitize('Authorization: Bearer eyJabc.def.ghi.signature');
    expect(out).not.toContain('eyJabc.def.ghi.signature');
    expect(out).toContain('[REDACTED]');
  });

  it.each([
    ['ghp_abcdefghijklmnopqrstuvwxyz'],
    ['gho_abcdefghijklmnopqrstuvwxyz'],
    ['ghs_abcdefghijklmnopqrstuvwxyz'],
    ['ghu_abcdefghijklmnopqrstuvwxyz'],
  ])('redacts GitHub-style token %s', (token) => {
    const out = CommandExecutor.sanitize(`token=${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED]');
  });
});

describe('CommandExecutor.sanitize - database URLs and PEM keys', () => {
  it('redacts postgres:// URLs with embedded user:password', () => {
    const out = CommandExecutor.sanitize('url=postgres://appuser:hunter2@db.example.com:5432/app');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('appuser:hunter2');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts postgresql:// URLs with embedded user:password', () => {
    const out = CommandExecutor.sanitize('connecting to postgresql://appuser:secretpw@db.internal/app');
    expect(out).not.toContain('secretpw');
    expect(out).not.toContain('appuser:secretpw');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts multi-line PEM PRIVATE KEY blocks', () => {
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQ\n-----END PRIVATE KEY-----';
    const out = CommandExecutor.sanitize(`key material: ${pem} done`);
    expect(out).not.toContain('MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQ');
    expect(out).not.toContain('PRIVATE KEY');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('key material:');
    expect(out).toContain('done');
  });
});

describe('CommandExecutor.sanitize - multi-secret and stability', () => {
  it('redacts every secret occurrence when the same string contains multiple distinct secrets', () => {
    const input = 'password=hunter2 token=ghp_abcdefghijklmnopqrstuvwxyz Authorization: Bearer abc.def.ghi';
    const out = CommandExecutor.sanitize(input);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(out).not.toContain('abc.def.ghi');
    // The redaction marker should appear at least 3 times.
    const matches = out.match(/\[REDACTED\]/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('is idempotent: sanitizing an already-sanitized string yields an unchanged result', () => {
    const once = CommandExecutor.sanitize('password=hunter2 token=abc postgres://u:p@h/db');
    const twice = CommandExecutor.sanitize(once);
    expect(twice).toBe(once);
  });

  it('leaves normal log output, URLs without credentials, and empty strings unchanged', () => {
    const clean = 'pulling ghcr.io/launchly/app:latest layer=2 size=128MB';
    expect(CommandExecutor.sanitize(clean)).toBe(clean);
    const empty = '';
    expect(CommandExecutor.sanitize(empty)).toBe('');
    const bareUrl = 'see https://docs.example.com/quickstart for setup';
    expect(CommandExecutor.sanitize(bareUrl)).toBe(bareUrl);
    const wordMention = 'no secrets here, just a tokenizing engine';
    // The bare word "tokenizing" should NOT be redacted (regex requires a key/value assignment).
    expect(CommandExecutor.sanitize(wordMention)).toBe(wordMention);
  });

  it('redacts secrets whose JSON object keys are quoted', () => {
    const input = '{"password":"hunter2","token":"plain-token","api_key":"api-secret"}';

    const output = CommandExecutor.sanitize(input);

    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('plain-token');
    expect(output).not.toContain('api-secret');
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
