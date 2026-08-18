import { execFileSync } from 'child_process'
import { getDataDir } from '../config.js'
import { absoluteDataDir } from '../paths.js'
import { composeBaseArgs } from '../compose.js'

// ── status / logs ─────────────────────────────────────────────────────────
// status：列出运行中容器（docker compose ps）
// logs：流式跟踪容器日志，支持 -f 与 --service <name>
// 全部走 execFileSync 参数数组（KI-041）。

export interface LogsOptions {
  follow?: boolean
  service?: string
}

/**
 * `launchly status`
 */
export function cmdStatus(): void {
  const dataDir = absoluteDataDir(getDataDir())
  try {
    execFileSync(
      'docker',
      [...composeBaseArgs(dataDir), 'ps'],
      { stdio: 'inherit' },
    )
  } catch {
    console.log('未找到 Launchly 服务，请先运行 `launchly install`。')
  }
}

/**
 * `launchly logs [-f] [--service <name>]`
 */
export function cmdLogs(opts: LogsOptions): void {
  const dataDir = absoluteDataDir(getDataDir())
  const args = ['logs']
  if (opts.follow) args.push('-f')
  if (opts.service) args.push(opts.service)
  execFileSync(
    'docker',
    [...composeBaseArgs(dataDir), ...args],
    { stdio: 'inherit' },
  )
}
