import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

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
    `LAUNCHLY_APP_PORT=${port}`,
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

  launchly-app:
    image: \${LAUNCHLY_APP_IMAGE:-ghcr.io/launchly/launchly-app:latest}
    container_name: launchly-app
    ports:
      - "\${LAUNCHLY_APP_PORT:-8080}:8080"
    environment:
      LAUNCHLY_DATABASE_URL: postgresql://launchly:\${LAUNCHLY_DB_PASSWORD}@launchly-postgres:5432/launchly
      LAUNCHLY_DB_HOST: launchly-postgres
      LAUNCHLY_DB_PORT: "5432"
      LAUNCHLY_DB_NAME: launchly
      LAUNCHLY_DB_USER: launchly
      LAUNCHLY_DB_PASSWORD: \${LAUNCHLY_DB_PASSWORD}
      LAUNCHLY_JWT_SECRET: \${LAUNCHLY_JWT_SECRET}
      LAUNCHLY_ENCRYPTION_KEY: \${LAUNCHLY_ENCRYPTION_KEY}
    volumes:
      - launchly-data:/var/lib/launchly
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - launchly-net
    depends_on:
      launchly-postgres:
        condition: service_healthy
    restart: unless-stopped

networks:
  launchly-net:
    driver: bridge

volumes:
  launchly-postgres-data:
  launchly-data:
`
}
