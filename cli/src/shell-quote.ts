// ── 安全 shell 引号工具（KI-041 兜底） ────────────────────────────────────
// 内部已全面切换到 execFileSync + 参数数组，因此本模块只在把字符串交给
// 真正不可避免 shell 解释的工具（tar、lsof、pg_dump 等）时作为防御层。
// 规则：仅包裹单引号，并按 POSIX 单引号规则对内部出现的单引号转义。

/**
 * 把任意字符串安全地包装为 POSIX 单引号字符串。
 * - 空字符串：返回 ''
 * - 不含单引号：返回 'value'
 * - 含单引号：按 'foo'\''bar' 规则闭合每个单引号
 */
export function shellQuote(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('shellQuote 仅接受字符串参数');
  }
  if (value.length === 0) return "''";
  // POSIX 单引号字符串内部不允许出现裸单引号；必须闭合、转义、再开启。
  // 形如：'foo'\''bar'
  return "'" + value.replace(/'/g, "'\\\\''") + "'";
}

/**
 * 将若干字符串参数拼接成单个安全的 shell 命令片段（用于调试输出）。
 * 注意：本项目所有外部命令已切到 execFileSync；该函数仅在生成日志时
 * 用来给运维人员展示"实际会被解释成什么"，不会作为执行入口。
 */
export function shellPreview(parts: string[]): string {
  return parts.map(shellQuote).join(' ');
}
