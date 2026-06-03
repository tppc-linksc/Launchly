import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
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
} from '../config'

describe('randomString', () => {
  it('returns string of requested length', () => {
    expect(randomString(24)).toHaveLength(24)
    expect(randomString(32)).toHaveLength(32)
    expect(randomString(1)).toHaveLength(1)
  })

  it('returns different strings on each call', () => {
    const a = randomString(32)
    const b = randomString(32)
    expect(a).not.toBe(b)
  })

  it('uses base64url charset (no +, /, or =)', () => {
    const s = randomString(1000)
    expect(s).not.toMatch(/[+/=]/)
  })
})

describe('getDataDir', () => {
  const originalEnv = process.env[DATA_DIR_ENV]

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[DATA_DIR_ENV]
    } else {
      process.env[DATA_DIR_ENV] = originalEnv
    }
  })

  it('returns env var when set', () => {
    process.env[DATA_DIR_ENV] = '/custom/path'
    expect(getDataDir()).toBe('/custom/path')
  })

  it('returns default when env var is unset', () => {
    delete process.env[DATA_DIR_ENV]
    expect(getDataDir()).toBe(path.join(os.homedir(), DEFAULT_DATA_DIR))
  })
})

describe('fileExists', () => {
  it('returns true for existing file', () => {
    expect(fileExists(path.join(__dirname, 'config.spec.ts'))).toBe(true)
  })

  it('returns false for non-existing file', () => {
    expect(fileExists('/nonexistent/path/file.txt')).toBe(false)
  })
})

describe('generateEnv', () => {
  it('contains all required keys', () => {
    const env = generateEnv()
    expect(env).toContain('LAUNCHLY_DB_PASSWORD=')
    expect(env).toContain('LAUNCHLY_JWT_SECRET=')
    expect(env).toContain('LAUNCHLY_ENCRYPTION_KEY=')
    expect(env).toContain('LAUNCHLY_APP_PORT=')
  })

  it('uses default port 8080', () => {
    const env = generateEnv()
    expect(env).toContain('LAUNCHLY_APP_PORT=8080')
  })

  it('uses custom port when specified', () => {
    const env = generateEnv('3000')
    expect(env).toContain('LAUNCHLY_APP_PORT=3000')
  })

  it('generates different secrets each time', () => {
    const a = generateEnv()
    const b = generateEnv()
    expect(a).not.toBe(b)
  })
})

describe('composeTemplate', () => {
  it('contains postgres service', () => {
    const tpl = composeTemplate()
    expect(tpl).toContain('launchly-postgres:')
    expect(tpl).toContain('postgres:16-alpine')
  })

  it('contains app service', () => {
    const tpl = composeTemplate()
    expect(tpl).toContain('launchly-app:')
    expect(tpl).toContain('LAUNCHLY_DATABASE_URL')
  })

  it('contains network and volume definitions', () => {
    const tpl = composeTemplate()
    expect(tpl).toContain('launchly-net:')
    expect(tpl).toContain('launchly-postgres-data:')
    expect(tpl).toContain('launchly-data:')
  })

  it('has healthcheck for postgres', () => {
    const tpl = composeTemplate()
    expect(tpl).toContain('pg_isready -U launchly')
  })
})
