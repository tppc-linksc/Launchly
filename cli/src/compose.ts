import { execFileSync } from 'child_process'
import * as path from 'path'
import { fileExists, COMPOSE_FILE, ENV_FILE } from './config.js'

// ── docker compose 调用封装（KI-041 修复） ─────────────────────────────────
// 历史实现：把路径和参数拼成字符串后 execSync，存在命令注入风险。
// 现在：所有 docker compose 子命令均通过 execFileSync('docker', [...args])
// 由 Node 直接传入参数数组，绕过 shell 解释器；数据目录始终使用绝对路径。

/**
 * 构造 docker compose 的标准参数前缀：
 *   ['compose', '-f', <compose 文件绝对路径>, '--env-file', <env 绝对路径>]
 * 若 .env 不存在则省略 --env-file 段。
 */
export function composeBaseArgs(dataDir: string): string[] {
  const args: string[] = ['compose', '-f', path.join(dataDir, COMPOSE_FILE)]
  const envPath = path.join(dataDir, ENV_FILE)
  if (fileExists(envPath)) {
    args.push('--env-file', envPath)
  }
  return args
}

/**
 * 运行 docker compose 子命令。dataDir 必须是绝对路径，extra 会被作为参数
 * 数组逐项传给 execFileSync，绝不会经过 shell 解释。
 */
export function runCompose(
  dataDir: string,
  extra: string[],
  options: { stdio?: 'inherit' | 'pipe' } = { stdio: 'inherit' },
): void {
  const args = [...composeBaseArgs(dataDir), ...extra]
  execFileSync('docker', args, { stdio: options.stdio ?? 'inherit' })
}

/**
 * 运行 docker compose 子命令并捕获 stdout（用于 dump / 解析等）。
 * dataDir 必须是绝对路径；返回值为 Buffer，可指定 encoding 拿到字符串。
 * 与 runCompose 不同：默认不附加 --env-file，以避免 .env 内容影响 dump 内容。
 */
export function runComposeCapture(
  dataDir: string,
  extra: string[],
  options: { encoding?: 'utf-8' } = {},
): string {
  const args = ['compose', '-f', path.join(dataDir, COMPOSE_FILE), ...extra]
  // 显式声明返回类型为 string | Buffer，避开 Node typings 对 Buffer#toString 的窄化
  const result = execFileSync('docker', args, {
    encoding: options.encoding ?? 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as string | Buffer
  if (typeof result === 'string') return result
  return Buffer.from(result).toString('utf-8')
}

/**
 * 运行 docker compose 子命令并把 stdin 输入管道交给子进程。
 * 用于 psql 等需要从 stdin 喂 SQL 数据的场景。
 * 注意：与 runCompose 不同，这里默认不附加 --env-file。
 * 因为 psql 等子命令通过 stdin 接收数据，不需要环境注入；
 * 同时减小 .env 内容对子进程的影响面。
 */
export function runComposeWithInput(
  dataDir: string,
  extra: string[],
  input: string,
): void {
  const args = ['compose', '-f', path.join(dataDir, COMPOSE_FILE), ...extra]
  execFileSync('docker', args, {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}
