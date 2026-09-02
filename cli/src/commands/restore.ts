import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getDataDir, fileExists, ENV_FILE, COMPOSE_FILE } from '../config.js';
import { absoluteDataDir, toAbsolutePath } from '../paths.js';
import { confirmPrompt } from '../prompts.js';
import { hasRequiredRestoreKeys, mergeRestoredEnv } from '../backup-env.js';

// ── restore（KI-042 修复点） ───────────────────────────────────────────────
// 修复点：
//   1. 真正从 stdin 读取 confirmPrompt 答案，旧实现只是打印 prompt 然后继续。
//   2. 用 execFileSync 参数数组执行 tar / psql（KI-041）。
//   3. 备份路径强制解析为绝对路径后再传给 tar。
//   4. 恢复 db_dump.sql、.env、launchly-data、launchly-worker-data 四项。

export interface RestoreOptions {
  force?: boolean;
}

/**
 * `launchly restore <backup-file> [--force]`
 */
export function cmdRestore(backupFile: string, options: RestoreOptions = {}): void {
  if (!backupFile) {
    console.error('用法：launchly restore <backup-file>');
    process.exit(1);
  }
  // 强制把备份文件解析为绝对路径后再做存在性校验（KI-041）
  let absBackupFile: string;
  try {
    absBackupFile = toAbsolutePath(backupFile);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`错误：备份文件路径无效：${msg}`);
    process.exit(1);
  }
  if (!fileExists(absBackupFile)) {
    console.error(`错误：找不到备份文件：${absBackupFile}`);
    process.exit(1);
  }

  const dataDir = absoluteDataDir(getDataDir());
  console.log(`正在从备份恢复：${absBackupFile}`);
  console.log('警告：此操作将覆盖现有数据。');
  // KI-042 核心修复：真正读取并判断 stdin 答案
  if (!options.force && !confirmPrompt('继续？[y/N] ')) {
    console.log('已取消。');
    return;
  }

  const restoreDir = path.join(dataDir, 'restore_tmp');
  fs.rmSync(restoreDir, { recursive: true, force: true });
  fs.mkdirSync(restoreDir, { recursive: true });

  try {
    // 解压（参数数组；absBackupFile 必为绝对路径）
    execFileSync('tar', ['-xzf', absBackupFile, '-C', restoreDir], {
      stdio: 'inherit',
    });

    // 在任何破坏性数据库写入前先验证恢复后的运行密钥是否完整。
    const restoredEnv = path.join(restoreDir, ENV_FILE);
    const currentEnv = path.join(dataDir, ENV_FILE);
    const mergedEnv = fileExists(restoredEnv)
      ? mergeRestoredEnv(
          fileExists(currentEnv) ? fs.readFileSync(currentEnv, 'utf-8') : '',
          fs.readFileSync(restoredEnv, 'utf-8'),
        )
      : fileExists(currentEnv)
        ? fs.readFileSync(currentEnv, 'utf-8')
        : '';
    if (!hasRequiredRestoreKeys(mergedEnv)) {
      throw new Error(
        '恢复需要当前实例预先配置 LAUNCHLY_DB_PASSWORD、LAUNCHLY_JWT_SECRET 和 LAUNCHLY_ENCRYPTION_KEY；数据库尚未修改',
      );
    }

    // 恢复数据库
    const dumpFile = path.join(restoreDir, 'db_dump.sql');
    if (fileExists(dumpFile)) {
      console.log('正在恢复数据库 ...');
      const dumpFd = fs.openSync(dumpFile, 'r');
      try {
        // 直接把 dump 文件描述符接到 psql stdin，避免大型备份完整读入 Node 内存。
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
            '--set',
            'ON_ERROR_STOP=on',
            '-d',
            'postgres',
          ],
          { stdio: [dumpFd, 'inherit', 'inherit'] },
        );
      } finally {
        fs.closeSync(dumpFd);
      }
    }

    // 恢复 .env
    if (fileExists(restoredEnv)) {
      fs.writeFileSync(currentEnv, mergedEnv, { mode: 0o600 });
    }

    // 恢复真实 Docker named volumes；旧版目录格式仍保留兼容。
    for (const volume of ['launchly-data', 'launchly-worker-data']) {
      const volumeArchive = path.join(restoreDir, `${volume}.tar`);
      if (fileExists(volumeArchive)) {
        const dockerVolume = `launchly_${volume}`;
        execFileSync(
          'docker',
          [
            'run',
            '--rm',
            '-v',
            `${dockerVolume}:/destination`,
            '-v',
            `${restoreDir}:/backup:ro`,
            'alpine:3.20',
            'sh',
            '-c',
            `find /destination -mindepth 1 -delete && tar -xf /backup/${volume}.tar -C /destination`,
          ],
          { stdio: 'inherit' },
        );
        continue;
      }
      const legacyDir = path.join(restoreDir, volume);
      if (fileExists(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
        fs.rmSync(path.join(dataDir, volume), { recursive: true, force: true });
        fs.cpSync(legacyDir, path.join(dataDir, volume), { recursive: true });
      }
    }

    console.log('恢复完成。');
  } finally {
    fs.rmSync(restoreDir, { recursive: true, force: true });
  }
}
