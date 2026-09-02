import * as fs from 'fs';
import { getDataDir } from '../config.js';
import { absoluteDataDir } from '../paths.js';
import { runCompose } from '../compose.js';
import { confirmPrompt } from '../prompts.js';

// ── uninstall（KI-042 修复点） ─────────────────────────────────────────────
// 历史 bug：--keep-data 时仍然执行 `docker compose down -v`，会把命名卷
// （launchly-postgres-data、launchly-data、launchly-worker-data）一并删除。
// 现在：
//   --keep-data: docker compose down （绝对不带 -v），且不删除数据目录
//   默认：       docker compose down -v，并删除数据目录

/**
 * `launchly uninstall [--force] [--keep-data]`
 */
export interface UninstallOptions {
  force?: boolean;
  keepData?: boolean;
}

export function cmdUninstall(opts: UninstallOptions = {}): void {
  const dataDir = absoluteDataDir(getDataDir());

  if (!opts.force) {
    console.log('警告：此操作将停止并移除所有 Launchly 服务。');
    if (!opts.keepData) {
      console.log('         所有数据卷和数据目录都将被删除（使用 --keep-data 可保留）。');
    }
    if (!confirmPrompt("请输入 'yes' 确认：")) {
      console.log('已取消。');
      return;
    }
  }

  console.log('停止服务 ...');
  // KI-042 核心修复：保留数据时绝对不能传 -v
  const downArgs = opts.keepData ? ['down'] : ['down', '-v'];
  try {
    runCompose(dataDir, downArgs);
  } catch {
    // 即使服务已经停止也允许完成卸载流程（幂等）
  }

  if (!opts.keepData) {
    console.log('删除数据目录 ...');
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log(`  ${dataDir} 已删除`);
  } else {
    console.log('已保留数据目录与所有命名卷。');
  }

  console.log('Launchly 已卸载。');
}
