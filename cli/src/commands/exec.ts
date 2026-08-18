import { execFileSync } from 'child_process'
import { getDataDir } from '../config.js'
import { absoluteDataDir } from '../paths.js'
import { composeBaseArgs } from '../compose.js'

// ── exec / shell ──────────────────────────────────────────────────────────
// 在指定服务容器内运行一次性命令，或启动交互式 shell。
// service 必须是硬编码枚举（KI-041：禁止把任意用户输入直接拼入命令）。

const ALLOWED_SERVICES = [
  'launchly-postgres',
  'launchly-migrate',
  'launchly-api',
  'launchly-worker',
  'launchly-buildkit',
] as const

type AllowedService = (typeof ALLOWED_SERVICES)[number]

function isAllowedService(value: string): value is AllowedService {
  return (ALLOWED_SERVICES as readonly string[]).includes(value)
}

/**
 * `launchly exec <service> <command...>`
 */
export function cmdExec(service: string, userArgs: string[]): void {
  if (!isAllowedService(service)) {
    console.error(
      `错误：未知服务 ${JSON.stringify(service)}。允许的服务：${ALLOWED_SERVICES.join(', ')}`,
    )
    process.exit(1)
  }
  if (!Array.isArray(userArgs) || userArgs.length === 0) {
    console.error('用法：launchly exec <service> <command...>')
    process.exit(1)
  }
  const dataDir = absoluteDataDir(getDataDir())
  execFileSync(
    'docker',
    [...composeBaseArgs(dataDir), 'exec', '-T', service, ...userArgs],
    { stdio: 'inherit' },
  )
}

/**
 * `launchly shell <service>` —— 进入容器内的交互式 shell。
 */
export function cmdShell(service: string): void {
  if (!isAllowedService(service)) {
    console.error(
      `错误：未知服务 ${JSON.stringify(service)}。允许的服务：${ALLOWED_SERVICES.join(', ')}`,
    )
    process.exit(1)
  }
  const dataDir = absoluteDataDir(getDataDir())
  execFileSync(
    'docker',
    [...composeBaseArgs(dataDir), 'exec', service, '/bin/sh'],
    { stdio: 'inherit' },
  )
}
