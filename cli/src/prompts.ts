import * as fs from 'fs'

// ── 交互式确认（KI-042 修复点） ───────────────────────────────────────────
// restore / uninstall 等破坏性命令必须真正读取 stdin 并匹配用户输入。
// 历史实现：仅打印 prompt 并直接继续，"Continue? [y/N]" 形同虚设。
// 现在：使用 fs.openSync('/dev/stdin', 'r') + fs.readSync 真正同步读取
// 用户键入的字符串，并要求显式输入 "yes" 才视为通过。

/**
 * 向用户提出确认问题，仅在用户键入 "yes"（不区分大小写、忽略首尾空白）
 * 时返回 true，否则返回 false。
 *
 * 使用 /dev/stdin 直接读取，避开 Node 在某些容器环境里 process.stdin
 * 已被 commander 占用的场景。读取失败（fd 不可用、EOF 等）一律视为拒绝。
 */
export function confirmPrompt(message: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync('/dev/stdin', 'r')
    process.stdout.write(message)
    const buf = Buffer.alloc(256)
    const bytes = fs.readSync(fd, buf, 0, buf.length, null)
    const answer = buf.toString('utf-8', 0, bytes).trim().toLowerCase()
    return answer === 'yes'
  } catch {
    // stdin 不可用时（如非交互式环境）一律视为拒绝，避免误执行破坏性命令
    return false
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 关闭失败不影响结果 */
      }
    }
  }
}
