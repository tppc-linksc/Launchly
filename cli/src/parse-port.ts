// ── 端口安全解析（KI-041） ──────────────────────────────────────────────
// 仅接受 1–65535 的纯数字字符串，拒绝空值、负数、小数、换行或非数字字符。
// 用于 `launchly install --port <port>` 等所有用户输入端口的位置。

/**
 * 校验一个端口字符串是否合法。
 * 合法条件：非空、纯十进制整数、范围 1–65535。
 */
export function isValidPort(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  if (!/^\d+$/.test(trimmed)) return false
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/**
 * 将端口字符串解析为整数；非法时抛错并以中文错误信息提示用户，
 * 退出码为 1。
 */
export function parsePort(value: string | undefined | null, label = '端口'): number {
  if (!isValidPort(value)) {
    const reason =
      value === undefined || value === null || value.trim().length === 0
        ? '不能为空'
        : '必须是 1 到 65535 之间的整数'
    console.error(`错误：${label} ${reason}（当前值：${JSON.stringify(value ?? null)}）`)
    process.exit(1)
  }
  return Number(value!.trim())
}
