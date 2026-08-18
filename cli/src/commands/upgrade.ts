import { getDataDir } from '../config.js'
import { absoluteDataDir } from '../paths.js'
import { runCompose } from '../compose.js'

// ── upgrade ───────────────────────────────────────────────────────────────
// 先拉取最新镜像，再以 recreate 模式 up -d 重建容器。
// 拉取失败会冒泡抛错，不打印"升级完成"，避免误导用户。

/**
 * `launchly upgrade` —— 拉取最新镜像并重建服务。
 */
export function cmdUpgrade(): void {
  const dataDir = absoluteDataDir(getDataDir())
  console.log('正在升级 Launchly ...')
  console.log('拉取最新镜像 ...')
  runCompose(dataDir, ['pull'])
  console.log('重建服务 ...')
  runCompose(dataDir, ['up', '-d'])
  console.log('升级完成。')
}
