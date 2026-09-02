import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import {
  getDataDir,
  fileExists,
  randomString,
  generateEnv,
  composeTemplate,
  DATA_DIR_ENV,
  DEFAULT_DATA_DIR,
  COMPOSE_FILE,
  ENV_FILE,
  isValidPort,
} from '../config';

describe('randomString', () => {
  it('returns string of requested length', () => {
    expect(randomString(24)).toHaveLength(24);
    expect(randomString(32)).toHaveLength(32);
    expect(randomString(1)).toHaveLength(1);
  });

  it('returns different strings on each call', () => {
    const a = randomString(32);
    const b = randomString(32);
    expect(a).not.toBe(b);
  });

  it('uses base64url charset (no +, /, or =)', () => {
    const s = randomString(1000);
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe('getDataDir', () => {
  const originalEnv = process.env[DATA_DIR_ENV];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[DATA_DIR_ENV];
    } else {
      process.env[DATA_DIR_ENV] = originalEnv;
    }
  });

  it('returns env var when set', () => {
    process.env[DATA_DIR_ENV] = '/custom/path';
    expect(getDataDir()).toBe('/custom/path');
  });

  it('returns default when env var is unset', () => {
    delete process.env[DATA_DIR_ENV];
    expect(getDataDir()).toBe(path.join(os.homedir(), DEFAULT_DATA_DIR));
  });
});

describe('fileExists', () => {
  it('returns true for existing file', () => {
    expect(fileExists(path.join(__dirname, 'config.spec.ts'))).toBe(true);
  });

  it('returns false for non-existing file', () => {
    expect(fileExists('/nonexistent/path/file.txt')).toBe(false);
  });
});

describe('generateEnv', () => {
  it('contains all required keys', () => {
    const env = generateEnv();
    expect(env).toContain('LAUNCHLY_DB_PASSWORD=');
    expect(env).toContain('LAUNCHLY_JWT_SECRET=');
    expect(env).toContain('LAUNCHLY_ENCRYPTION_KEY=');
    expect(env).toContain('LAUNCHLY_APP_PORT=');
  });

  it('uses default port 8080', () => {
    const env = generateEnv();
    expect(env).toContain('LAUNCHLY_APP_PORT=8080');
  });

  it('uses custom port when specified', () => {
    const env = generateEnv('3000');
    expect(env).toContain('LAUNCHLY_APP_PORT=3000');
  });

  it('generates different secrets each time', () => {
    const a = generateEnv();
    const b = generateEnv();
    expect(a).not.toBe(b);
  });
});

describe('composeTemplate', () => {
  it('contains postgres service', () => {
    const tpl = composeTemplate();
    expect(tpl).toContain('launchly-postgres:');
    expect(tpl).toContain('postgres:16-alpine');
  });

  it('contains migration, API, and isolated worker services', () => {
    const tpl = composeTemplate();
    expect(tpl).toContain('launchly-migrate:');
    expect(tpl).toContain('launchly-api:');
    expect(tpl).toContain('launchly-worker:');
    expect(tpl).toContain('service_completed_successfully');
    expect(tpl).not.toContain('/var/run/docker.sock');
    expect(tpl).toContain('LAUNCHLY_DATABASE_URL');
  });

  it('contains network and volume definitions', () => {
    const tpl = composeTemplate();
    expect(tpl).toContain('launchly-net:');
    expect(tpl).toContain('launchly-builder-net:');
    expect(tpl).toContain('internal: true');
    expect(tpl).toContain('launchly-postgres-data:');
    expect(tpl).toContain('launchly-data:');
  });

  it('has healthcheck for postgres', () => {
    const tpl = composeTemplate();
    expect(tpl).toContain('pg_isready -U launchly');
  });
});

// ── parsePort（KI-041 端口校验） ─────────────────────────────────────────────

describe('isValidPort', () => {
  it('accepts canonical port numbers', () => {
    expect(isValidPort('1')).toBe(true);
    expect(isValidPort('80')).toBe(true);
    expect(isValidPort('8080')).toBe(true);
    expect(isValidPort('65535')).toBe(true);
  });

  it('rejects empty / null / undefined', () => {
    expect(isValidPort('')).toBe(false);
    expect(isValidPort('   ')).toBe(false);
    expect(isValidPort(undefined)).toBe(false);
    expect(isValidPort(null)).toBe(false);
  });

  it('rejects out-of-range numbers', () => {
    expect(isValidPort('0')).toBe(false);
    expect(isValidPort('65536')).toBe(false);
    expect(isValidPort('70000')).toBe(false);
  });

  it('rejects non-numeric / injection payloads (KI-041)', () => {
    expect(isValidPort('-1')).toBe(false);
    expect(isValidPort('1.5')).toBe(false);
    expect(isValidPort('8080\n; rm -rf /')).toBe(false);
    expect(isValidPort('8080; ls')).toBe(false);
    expect(isValidPort('8080 foo')).toBe(false);
    expect(isValidPort('0x1F90')).toBe(false);
    expect(isValidPort('8080\t')).toBe(true); // 前后空白允许
  });
});

describe('parsePort', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('returns parsed integer for valid input', async () => {
    const { parsePort } = await import('../parse-port');
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with code 1 on invalid input', async () => {
    const { parsePort } = await import('../parse-port');
    expect(() => parsePort('abc')).toThrow('process.exit(1)');
    expect(() => parsePort('70000')).toThrow('process.exit(1)');
    expect(() => parsePort('')).toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
