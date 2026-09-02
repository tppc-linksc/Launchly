import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { getDataDir } from '../config.js';

// ── doctor（系统自检） ─────────────────────────────────────────────────────
// 检查项：
//   1. Docker 版本（docker version --format ...）
//   2. Docker Compose（优先 plugin，缺失则尝试 docker-compose 兜底）
//   3. 关键端口占用情况（lsof）
//   4. 主目录可用空间（statfsSync）
//   5. 数据目录是否存在
// 命令全部走 execFileSync 参数数组（KI-041）；端口参数已硬编码，不接用户
// 输入，因此无注入面。

interface PortSpec {
  port: number;
  name: string;
}

const PORTS_TO_CHECK: PortSpec[] = [
  { port: 8080, name: 'launchly-app' },
  { port: 5173, name: 'launchly-web (dev)' },
  { port: 5432, name: 'launchly-postgres' },
];

/**
 * `launchly doctor`
 */
export function cmdDoctor(): void {
  console.log('=== Launchly Doctor ===\n');

  // 1. Docker
  process.stdout.write('Docker ....................... ');
  try {
    const ver = execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`OK (v${String(ver).trim()})`);
  } catch {
    console.log('未找到');
    console.log('  修复方法：从 https://docs.docker.com/get-docker/ 安装 Docker');
  }

  // 2. Docker Compose（plugin → legacy fallback）
  process.stdout.write('Docker Compose .............. ');
  try {
    const ver = execFileSync('docker', ['compose', 'version', '--short'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`OK (v${String(ver).trim()})`);
  } catch {
    try {
      const ver = execFileSync('docker-compose', ['version', '--short'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(`OK (v${String(ver).trim()})`);
    } catch {
      console.log('未找到');
      console.log('  修复方法：安装 Docker Compose 插件或 Docker Desktop。');
    }
  }

  // 3. 端口占用
  console.log('端口 ........................');
  for (const { port, name } of PORTS_TO_CHECK) {
    process.stdout.write(`  ${port} (${name}) ............... `);
    try {
      execFileSync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log('占用');
    } catch {
      console.log('空闲');
    }
  }

  // 4. 磁盘空间
  process.stdout.write('磁盘空间 ................... ');
  try {
    const stat = fs.statfsSync(os.homedir());
    const availGB = (stat.bavail * stat.bsize) / 1_073_741_824;
    if (availGB < 1.0) {
      console.log(`警告（剩余 ${availGB.toFixed(1)} GB）`);
      console.log('  Launchly 至少需要 1 GB 可用空间。');
    } else {
      console.log(`OK（剩余 ${availGB.toFixed(1)} GB）`);
    }
  } catch {
    console.log('无法检查');
  }

  // 5. 数据目录
  const dataDir = getDataDir();
  process.stdout.write(`数据目录 (${dataDir}) ... `);
  try {
    const stat = fs.statSync(dataDir);
    console.log(stat.isDirectory() ? '已存在' : '已存在但不是目录');
  } catch {
    console.log('尚未创建（安装时将自动创建）');
  }

  console.log('\nDoctor 检查完成。');
}
