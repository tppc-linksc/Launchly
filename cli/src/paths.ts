import * as path from 'path';

// ── 路径安全解析（KI-041） ────────────────────────────────────────────────
// 任何来自环境变量、命令行参数或用户输入的路径都必须解析为绝对路径，
// 避免相对路径注入或符号链接穿越导致的命令执行歧义。

/**
 * 将任意路径值强制解析为绝对路径。
 * 若传入非字符串则抛错；解析过程调用 path.resolve，使用 process.cwd()。
 */
export function toAbsolutePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('路径必须是非空字符串');
  }
  return path.resolve(value);
}

/**
 * 解析数据根目录为绝对路径。getDataDir() 已保证是绝对路径，但这里再次
 * 校验以防御 LAUNCHLY_DATA_DIR 被注入为相对值或含换行的场景。
 */
export function absoluteDataDir(dataDir: string): string {
  return toAbsolutePath(dataDir);
}
