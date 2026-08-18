import * as fs from 'fs'
import * as path from 'path'
import { getDataDir, fileExists, generateEnv, composeTemplate, ENV_FILE, COMPOSE_FILE } from '../config.js'
import { parsePort } from '../parse-port.js'
import { absoluteDataDir } from '../paths.js'
import { runCompose } from '../compose.js'

// ── install / up / down / restart ─────────────────────────────────────────
// install 命令：创建数据根目录、生成 .env、写 compose.yml、启动服务。
// 所有用户输入端口都经过 parsePort 校验（KI-041）。
// 数据目录始终通过 absoluteDataDir 解析为绝对路径（KI-041）。

export interface InstallOptions {
  dryRun?: boolean
  port?: string
}

/**
 * `launchly install [--dry-run] [--port <port>]`
 */
export function cmdInstall(opts: InstallOptions): void {
  // 安全端口解析：拒绝空值、负数、非数字、范围外（KI-041）
  const port = parsePort(opts.port ?? '8080', '应用端口')
  const dataDir = absoluteDataDir(getDataDir())

  if (opts.dryRun) {
    console.log('=== Launchly Install (Dry Run) ===\n')
    console.log('计划执行的操作：\n')
    console.log(`  1. 创建数据目录：${dataDir}`)
    console.log(`  2. 生成 .env 文件（自动生成数据库密码、JWT 与加密密钥）`)
    console.log(`  3. 写入 docker-compose.yml`)
    console.log(`  4. 启动 Docker Compose 服务`)
    console.log(`  5. 输出浏览器初始化地址：\n`)
    console.log(`     http://localhost:${port}/setup\n`)
    return
  }

  console.log('=== Launchly Install ===\n')

  // 1. 创建子目录（绝对路径）
  console.log('创建目录 ...')
  for (const sub of ['', 'logs', 'data', 'config']) {
    const dir = path.join(dataDir, sub)
    fs.mkdirSync(dir, { recursive: true })
    console.log(`  ${dir}`)
  }
  console.log()

  // 2. 生成 .env（不存在时；存在则保留）
  const envPath = path.join(dataDir, ENV_FILE)
  if (fileExists(envPath)) {
    console.log(`  .env 已存在于 ${envPath}，跳过生成。\n`)
  } else {
    console.log('生成 .env 文件 ...')
    fs.writeFileSync(envPath, generateEnv(String(port)), { mode: 0o600 })
    console.log(`  ${envPath}（权限：600）\n`)
  }

  // 3. 写入 docker-compose.yml
  console.log('写入 docker-compose.yml ...')
  fs.writeFileSync(path.join(dataDir, COMPOSE_FILE), composeTemplate())
  console.log(`  ${path.join(dataDir, COMPOSE_FILE)}\n`)

  // 4. 启动服务（execFileSync 参数数组，绕开 shell）
  console.log('启动服务 ...')
  runCompose(dataDir, ['up', '-d'])

  console.log('\n安装完成。\n')
  console.log('后续步骤：')
  console.log(`  1. 在浏览器打开 http://localhost:${port}/setup`)
  console.log('  2. 创建所有者账号和工作区\n')
}

/**
 * `launchly up` —— 启动后台服务。
 */
export function cmdUp(): void {
  const dataDir = absoluteDataDir(getDataDir())
  console.log('启动 Launchly 服务 ...')
  runCompose(dataDir, ['up', '-d'])
  console.log('服务已启动。')
}

/**
 * `launchly down` —— 停止后台服务（保留卷）。
 */
export function cmdDown(): void {
  const dataDir = absoluteDataDir(getDataDir())
  console.log('停止 Launchly 服务 ...')
  runCompose(dataDir, ['down'])
  console.log('服务已停止。')
}

/**
 * `launchly restart` —— 重启后台服务。
 */
export function cmdRestart(): void {
  const dataDir = absoluteDataDir(getDataDir())
  console.log('重启 Launchly 服务 ...')
  runCompose(dataDir, ['restart'])
  console.log('服务已重启。')
}
