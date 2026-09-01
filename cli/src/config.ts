import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

// 为保持向下兼容，从独立模块 re-export；后续命令实现统一从 './parse-port.js'
// 直接引入 parsePort，但历史代码继续 import 自 config 仍可工作。
export { isValidPort, parsePort } from './parse-port.js'

export const DATA_DIR_ENV = 'LAUNCHLY_DATA_DIR'
export const DEFAULT_DATA_DIR = '.launchly'
export const COMPOSE_FILE = 'docker-compose.yml'
export const ENV_FILE = '.env'

export function getDataDir(): string {
  return process.env[DATA_DIR_ENV] || path.join(os.homedir(), DEFAULT_DATA_DIR)
}

export function fileExists(p: string): boolean {
  try { fs.statSync(p); return true } catch { return false }
}

export function randomString(n: number): string {
  return crypto.randomBytes(n).toString('base64url').slice(0, n)
}

export function generateEnv(port: string = '8080'): string {
  return [
    '# Launchly Environment Configuration',
    `LAUNCHLY_DB_PASSWORD=${randomString(24)}`,
    `LAUNCHLY_JWT_SECRET=${randomString(32)}`,
    `LAUNCHLY_ENCRYPTION_KEY=${randomString(32)}`,
    'LAUNCHLY_APP_IMAGE=ghcr.io/tppc-linksc/launchly:latest',
    `LAUNCHLY_APP_PORT=${port}`,
    '# Lite mode is the default: deploy existing OCI images without a local BuildKit daemon.',
    '# Set COMPOSE_PROFILES=builder on a 2 vCPU / 4 GB+ server to enable local source builds.',
    'COMPOSE_PROFILES=',
    '',
  ].join('\n')
}

export function composeTemplate(): string {
  return `services:
  launchly-postgres:
    image: postgres:16-alpine
    container_name: launchly-postgres
    environment:
      POSTGRES_USER: launchly
      POSTGRES_PASSWORD: \${LAUNCHLY_DB_PASSWORD}
      POSTGRES_DB: launchly
    volumes:
      - launchly-postgres-data:/var/lib/postgresql/data
    networks:
      - launchly-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U launchly"]
      interval: 5s
      timeout: 3s
      retries: 5
    mem_limit: \${LAUNCHLY_POSTGRES_MEMORY_LIMIT:-512m}

  launchly-migrate:
    image: \${LAUNCHLY_APP_IMAGE:-ghcr.io/tppc-linksc/launchly:latest}
    environment:
      LAUNCHLY_DATABASE_URL: postgresql://launchly:\${LAUNCHLY_DB_PASSWORD}@launchly-postgres:5432/launchly
      LAUNCHLY_JWT_SECRET: \${LAUNCHLY_JWT_SECRET}
      LAUNCHLY_ENCRYPTION_KEY: \${LAUNCHLY_ENCRYPTION_KEY}
    command: ["./node_modules/.bin/prisma", "migrate", "deploy"]
    networks:
      - launchly-net
    depends_on:
      launchly-postgres:
        condition: service_healthy
    restart: "no"

  launchly-api:
    image: \${LAUNCHLY_APP_IMAGE:-ghcr.io/tppc-linksc/launchly:latest}
    ports:
      - "\${LAUNCHLY_APP_PORT:-8080}:8080"
    environment: &launchly-env
      LAUNCHLY_DATABASE_URL: postgresql://launchly:\${LAUNCHLY_DB_PASSWORD}@launchly-postgres:5432/launchly
      LAUNCHLY_JWT_SECRET: \${LAUNCHLY_JWT_SECRET}
      LAUNCHLY_ENCRYPTION_KEY: \${LAUNCHLY_ENCRYPTION_KEY}
    volumes:
      - launchly-data:/var/lib/launchly
    networks:
      - launchly-net
    depends_on:
      launchly-migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/api/health"]
      interval: 10s
      timeout: 5s
      retries: 12
    restart: unless-stopped
    mem_limit: \${LAUNCHLY_API_MEMORY_LIMIT:-384m}

  launchly-worker:
    image: \${LAUNCHLY_APP_IMAGE:-ghcr.io/tppc-linksc/launchly:latest}
    environment:
      <<: *launchly-env
      LAUNCHLY_PROCESS_ROLE: worker
      LAUNCHLY_BUILDKIT_ADDR: tcp://launchly-buildkit:1234
      LAUNCHLY_REGISTRY_AUTH_JSON: \${LAUNCHLY_REGISTRY_AUTH_JSON:-}
    volumes:
      - launchly-worker-data:/var/lib/launchly-worker
    networks:
      - launchly-net
      - launchly-builder-net
    depends_on:
      launchly-migrate:
        condition: service_completed_successfully
    restart: unless-stopped
    mem_limit: \${LAUNCHLY_WORKER_MEMORY_LIMIT:-384m}

  launchly-buildkit:
    image: moby/buildkit:v0.16.0-rootless
    command: ["buildkitd", "--addr", "tcp://0.0.0.0:1234"]
    security_opt:
      - no-new-privileges:true
    networks:
      - launchly-builder-net
    restart: unless-stopped
    profiles: ["builder"]
    mem_limit: \${LAUNCHLY_BUILDKIT_MEMORY_LIMIT:-1024m}

networks:
  launchly-net:
    driver: bridge
  launchly-builder-net:
    driver: bridge
    internal: true

volumes:
  launchly-postgres-data:
  launchly-data:
  launchly-worker-data:
`
}
