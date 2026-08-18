/**
 * 日志/错误脱敏器（KI-028 / KI-030 / R0-08）。
 *
 * 关键修复：
 * - 支持 JSON 结构感知，能识别 "password":"hunter2" 这种引号包裹字段名（KI-030）。
 * - 字段名匹配大小写不敏感。
 * - 同时覆盖 shell 命令行风格、Authorization Bearer、GitHub Token、连接串、PEM 私钥。
 *
 * 所有 Runner / Worker 错误持久化前必须经过 redact()。
 *
 * 实现策略：先识别敏感 key 及其 value 范围，
 * 再按"key+分隔符+占位符"重写，最后把占位符统一替换为 [REDACTED]。
 * 使用纯函数（不依赖全局状态）。
 */

const SENSITIVE_KEYS = [
  'password', 'passwd', 'token', 'access_token', 'refresh_token',
  'secret', 'api_key', 'apikey', 'api-key', 'private_key', 'privatekey', 'private-key',
  'credential', 'credentials', 'auth', 'authorization',
];

const REDACTED = '[REDACTED]';

const KEY_PATTERN_SOURCE = SENSITIVE_KEYS
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

interface KeyMatch {
  key: string;
  start: number;
  end: number;
}

interface ValueSpan {
  start: number;
  end: number;
}

/** 在 text 中找出所有敏感字段出现的位置。 */
function findKeys(text: string): KeyMatch[] {
  // 模式 1："key" / 'key' 形式（JSON）
  // 模式 2：\bkey\b 形式（shell 风格）
  const DQ = String.fromCharCode(34);
  const SQ = String.fromCharCode(39);
  const pattern = '(?:' + DQ + '(' + KEY_PATTERN_SOURCE + ')' + DQ + '|' + SQ + '(' + KEY_PATTERN_SOURCE + ')' + SQ + '|\\b(' + KEY_PATTERN_SOURCE + ')\\b)';
  const re = new RegExp(pattern, 'gi');
  const out: KeyMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1] ?? m[2] ?? m[3];
    out.push({ key, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 解析 key 之后的 value。返回 { start, end } 或 null。 */
function parseValueAfter(text: string, fromPos: number): ValueSpan | null {
  let i = fromPos;
  while (i < text.length && /[ \t]/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  if (text[i] !== ':' && text[i] !== '=') return null;
  i += 1;
  while (i < text.length && /[ \t]/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  if (text[i] === '"') return parseQuoted(text, i, '"');
  if (text[i] === "'") return parseQuoted(text, i, "'");
  // 裸值
  const start = i;
  while (i < text.length && !/[\s,;}\]\)]/.test(text[i])) i += 1;
  if (i === start) return null;
  return { start, end: i };
}

function parseQuoted(text: string, start: number, quote: string): ValueSpan | null {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) { i += 2; continue; }
    if (text[i] === quote) return { start, end: i + 1 };
    i += 1;
  }
  return null;
}

/** 用占位符替换敏感键值对。 */
function maskKeyValues(text: string): string {
  const keys = findKeys(text);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const k of keys) {
    const v = parseValueAfter(text, k.end);
    if (!v) continue;
    const originalValue = text.slice(v.start, v.end);
    // 幂等性：值已经是 REDACTED 占位符或被包含，则跳过，避免重复添加 [REDACTED] 末尾。
    if (originalValue.includes(REDACTED)) continue;
    const replacement = text.slice(k.start, v.start) + REDACTED;
    replacements.push({ start: k.start, end: v.end, text: replacement });
  }
  if (replacements.length === 0) return text;
  let result = '';
  let cursor = 0;
  for (const r of replacements) {
    if (r.start < cursor) continue; // 跳过重叠
    result += text.slice(cursor, r.start) + r.text;
    // 修复：r.end 是原 value 的右边界，但替换文本（REDACTED）长度可能不同；
    // 应当以替换文本长度为准推进 cursor，避免遗留一个字符（如 "]"）。
    cursor = r.start + r.text.length;
  }
  return result + text.slice(cursor);
}

/** 替换 Authorization / Bearer / Basic 头。 */
function redactHeaders(text: string): string {
  return text.replace(
    /(authorization|auth)(\s*[:=]\s*(?:bearer|basic)\s+)(\S+)/gi,
    (_match, prefix, mid) => `${prefix}${mid}${REDACTED}`,
  );
}

/** 替换 ghp_/ghs_/gho_/ghu_ 前缀的 GitHub Token。 */
function redactGithubTokens(text: string): string {
  return text.replace(/\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, REDACTED);
}

/** 替换包含内嵌凭据的连接串。 */
function redactDSNs(text: string): string {
  const DQ = String.fromCharCode(34);
  const SQ = String.fromCharCode(39);
  const LT = String.fromCharCode(60);
  const GT = String.fromCharCode(62);
  const pattern = '\\b(?:postgres(?:ql)?|mysql|amqp(?:s)?|mongodb(?:\\+srv)?|redis(?:s)?):\\/\\/[^\\s' + DQ + SQ + LT + GT + ']*?:[^\\s' + DQ + SQ + LT + GT + ']*?@[^\\s' + DQ + SQ + LT + GT + ']+';
  return text.replace(new RegExp(pattern, 'gi'), REDACTED);
}

/** 替换 PEM 私钥块。 */
function redactPEMs(text: string): string {
  return text.replace(
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
    REDACTED,
  );
}

/** 公开 API：对任意文本统一脱敏。 */
export function redact(input: unknown): string {
  if (input === null || input === undefined) return '';
  let text = typeof input === 'string' ? input : safeStringify(input);
  // 顺序：先 DSN/PEM/GitHub/Header 等独立模式，最后 key=value（避免 token 段被截断）。
  text = redactDSNs(text);
  text = redactPEMs(text);
  text = redactGithubTokens(text);
  text = redactHeaders(text);
  text = maskKeyValues(text);
  return text;
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** 检测是否包含敏感字段名（用于输入校验和告警）。 */
export function containsSensitiveKey(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYS.some(k => lower.includes(k.toLowerCase()));
}
