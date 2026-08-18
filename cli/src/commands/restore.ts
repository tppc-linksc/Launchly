import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { getDataDir, fileExists, ENV_FILE, COMPOSE_FILE } from '../config.js'
import { absoluteDataDir, toAbsolutePath } from '../paths.js'
import { confirmPrompt } from '../prompts.js'

// ── restore（KI-042 修复点） ───────────────────────────────────────────────
// 修复点：
//   1. 真正从 stdin 读取 confirmPrompt 答案，旧实现只是打印 prompt 然后继续。
//   2. 用 execFileSync 参数数组执行 tar / psql（KI-041）。
//   3. 备份路径强制解析为绝对路径后再传给 tar。
//   4. 恢复 db_dump.sql、.env、launchly-data、launchly-worker-data 四项。

export interface RestoreOptions {
  force?: boolean
}

/**
 * `launchly restore <backup-file> [--force]`
 */
export function cmdRestore(backupFile: string, options: RestoreOptions = {}): void {
  if (!backupFile) {
    console.error('用法：launchly restore <backup-file>')
    process.exit(1)
  }
  // 强制把备份文件解析为绝对路径后再做存在性校验（KI-041）
  let absBackupFile: string
  try {
    absBackupFile = toAbsolutePath(backupFile)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`错误：备份文件路径无效：${msg}`)
    process.exit(1)
  }
  if (!fileExists(absBackupFile)) {
    console.error(`错误：找不到备份文件：${absBackupFile}`)
    process.exit(1)
  }

  const dataDir = absoluteDataDir(getDataDir())
  console.log(`正在从备份恢复：${absBackupFile}`)
  console.log('警告：此操作将覆盖现有数据。')
  // KI-042 核心修复：真正读取并判断 stdin 答案
  if (!options.force && !confirmPrompt('继续？[y/N] ')) {
    console.log('已取消。')
    return
  }

  const restoreDir = path.join(dataDir, 'restore_tmp')
  fs.rmSync(restoreDir, { recursive: true, force: true })
  fs.mkdirSync(restoreDir, { recursive: true })

  try {
    // 解压（参数数组；absBackupFile 必为绝对路径）
    execFileSync('tar', ['-xzf', absBackupFile, '-C', restoreDir], {
      stdio: 'inherit',
    })

    // 恢复数据库
    const dumpFile = path.join(restoreDir, 'db_dump.sql')
    if (fileExists(dumpFile)) {
      console.log('正在恢复数据库 ...')
      const data = fs.readFileSync(dumpFile, 'utf-8')
      // 不传 --env-file：psql 通过 stdin 接收 dump，环境变量无需注入；
      // 这与历史实现一致，也减少 psql 被 .env 注入影响的可能性。
      execFileSync(
        'docker',
        [
          'compose',
          '-f',
          path.join(dataDir, COMPOSE_FILE),
          'exec',
          '-T',
          'launchly-postgres',
          'psql',
          '-U',
          'launchly',
          '-d',
          'launchly',
        ],
        { input: data, stdio: ['pipe', 'inherit', 'inherit'] },
      )
    }

    // 恢复 .env
    const restoredEnv = path.join(restoreDir, ENV_FILE)
    if (fileExists(restoredEnv)) {
      fs.copyFileSync(restoredEnv, path.join(dataDir, ENV_FILE))
    }

    // 恢复挂载目录（launchly-data / launchly-worker-data）
    for (const dir of ['launchly-data', 'launchly-worker-data']) {
      const volumeDir = path.join(restoreDir, dir)
      if (fileExists(volumeDir) && fs.statSync(volumeDir).isDirectory()) {
        fs.rmSync(path.join(dataDir, dir), { recursive: true, force: true })
        fs.cpSync(volumeDir, path.join(dataDir, dir), { recursive: true })
      }
    }

    console.log('恢复完成。')
  } finally {
    fs.rmSync(restoreDir, { recursive: true, force: true })
  }
}
