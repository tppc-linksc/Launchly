import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getDataDir, fileExists, ENV_FILE } from '../config.js';
import { absoluteDataDir, toAbsolutePath } from '../paths.js';
import { runComposeToFile } from '../compose.js';
import { sanitizeEnvForBackup } from '../backup-env.js';

// ── backup（KI-042 增强） ──────────────────────────────────────────────────
// 备份内容：
//   1. Launchly Postgres 数据库 dump（pg_dump）
//   2. .env 中的非敏感运行配置（密码、Token、私钥不入归档）
//   3. launchly-data 与 launchly-worker-data 两个 named volume 的全部内容
// 三个层次打包成一个 tar.gz，文件名包含时间戳。
// 所有命令走 execFileSync 参数数组，路径全部解析为绝对值（KI-041）。

/**
 * `launchly backup`
 */
export function cmdBackup(): void {
  const dataDir = absoluteDataDir(getDataDir());
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = toAbsolutePath(path.join(backupDir, `launchly-backup-${timestamp}.tar.gz`));
  const tmpDir = toAbsolutePath(path.join(backupDir, `tmp_${timestamp}`));
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`正在创建备份：${backupFile}`);

  // 1. 导出数据库
  const dbFile = path.join(tmpDir, 'db_dump.sql');
  try {
    runComposeToFile(
      dataDir,
      [
        'exec',
        '-T',
        'launchly-postgres',
        'pg_dump',
        '-U',
        'launchly',
        '-d',
        'launchly',
        '--clean',
        '--if-exists',
        '--create',
      ],
      dbFile,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('错误：导出数据库失败：', msg);
    console.error('请确认 Launchly 已启动（`launchly up`），然后重试。');
    process.exit(1);
  }
  // 2. 准备运行数据。Compose 项目固定名为 launchly，因此实际卷名带此前缀；
  // 归档内仍使用稳定的逻辑卷名，避免把部署细节写入备份格式。
  const envSrc = path.join(dataDir, ENV_FILE);
  if (fileExists(envSrc)) {
    const sanitizedEnv = sanitizeEnvForBackup(fs.readFileSync(envSrc, 'utf-8'));
    fs.writeFileSync(path.join(tmpDir, ENV_FILE), sanitizedEnv, { mode: 0o600 });
    console.log('提示：密码、Token、私钥和加密密钥未写入归档；请在独立安全位置保管恢复所需密钥。');
  }
  for (const volume of ['launchly-data', 'launchly-worker-data']) {
    const dockerVolume = `launchly_${volume}`;
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${dockerVolume}:/source:ro`,
        '-v',
        `${tmpDir}:/backup`,
        'alpine:3.20',
        'tar',
        '-cf',
        `/backup/${volume}.tar`,
        '-C',
        '/source',
        '.',
      ],
      { stdio: 'inherit' },
    );
  }

  // 3. 打包为 tar.gz（参数数组，绝对路径，绕开 shell）
  execFileSync('tar', ['-czf', backupFile, '-C', tmpDir, '.'], {
    stdio: 'inherit',
  });
  // 归档包含数据库与运行数据；不受调用者 umask 影响，固定仅所有者可读写。
  fs.chmodSync(backupFile, 0o600);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`备份已生成：${backupFile}`);
}
