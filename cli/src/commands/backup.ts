import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { getDataDir, fileExists, ENV_FILE } from '../config.js'
import { absoluteDataDir, toAbsolutePath } from '../paths.js'
import { runComposeCapture } from '../compose.js'

// ── backup（KI-042 增强） ──────────────────────────────────────────────────
// 备份内容：
//   1. Postgres 全库 dump（pg_dumpall）
//   2. .env 文件（已加密敏感字段也一并保留以便恢复后能正常登录）
//   3. launchly-data 与 launchly-worker-data 两个挂载目录的全部内容
// 三个层次打包成一个 tar.gz，文件名包含时间戳。
// 所有命令走 execFileSync 参数数组，路径全部解析为绝对值（KI-041）。

/**
 * `launchly backup`
 */
export function cmdBackup(): void {
  const dataDir = absoluteDataDir(getDataDir())
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = toAbsolutePath(
    path.join(backupDir, `launchly-backup-${timestamp}.tar.gz`),
  )
  const tmpDir = toAbsolutePath(path.join(backupDir, `tmp_${timestamp}`))

  console.log(`正在创建备份：${backupFile}`)

  // 1. 导出数据库
  const dbFile = path.join(backupDir, 'db_dump.sql')
  let dumpText: string
  try {
    dumpText = runComposeCapture(dataDir, [
      'exec',
      '-T',
      'launchly-postgres',
      'pg_dumpall',
      '-U',
      'launchly',
    ], { encoding: 'utf-8' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('错误：导出数据库失败：', msg)
    console.error('请确认 Launchly 已启动（`launchly up`），然后重试。')
    process.exit(1)
  }
  fs.writeFileSync(dbFile, dumpText, { mode: 0o600 })

  // 2. 准备临时目录并拷贝数据
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.renameSync(dbFile, path.join(tmpDir, 'db_dump.sql'))
  const envSrc = path.join(dataDir, ENV_FILE)
  if (fileExists(envSrc)) {
    fs.copyFileSync(envSrc, path.join(tmpDir, ENV_FILE))
  }
  for (const dir of ['launchly-data', 'launchly-worker-data']) {
    const volumeSrc = path.join(dataDir, dir)
    if (fileExists(volumeSrc) && fs.statSync(volumeSrc).isDirectory()) {
      fs.cpSync(volumeSrc, path.join(tmpDir, dir), { recursive: true })
    }
  }

  // 3. 打包为 tar.gz（参数数组，绝对路径，绕开 shell）
  execFileSync('tar', ['-czf', backupFile, '-C', tmpDir, '.'], {
    stdio: 'inherit',
  })
  // 归档包含数据库、JWT/加密密钥和运行数据；不受调用者 umask 影响，固定仅所有者可读写。
  fs.chmodSync(backupFile, 0o600)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`备份已生成：${backupFile}`)
}
