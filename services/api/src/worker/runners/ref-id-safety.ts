/**
 * 统一的 ID 合法性校验（KI-032）。
 *
 * 单一权威，避免不同 Runner 对同一份 caller 数据写出不同的"安全"判断。
 * 任何 Runner 收到 caller 控制的 refId / projectId / environmentId 等，
 * 都必须先调用 assertSafeRefId，否则拒绝执行。
 *
 * OCI tag 段使用更严格的"小写字母/数字/点/下划线/连字符，首字符不能是 -"的规则，
 * 这是 OCI distribution spec 的基础约束。
 */

/** 通用 ID：字母/数字/下划线/连字符，1-128 字符。 */
export const SAFE_REF_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function isSafeRefId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REF_ID.test(value);
}

/** 校验失败抛出 Error，调用方必须捕获或转为 RunnerResult.failure。 */
export function assertSafeRefId(value: unknown, label: string): string {
  if (!isSafeRefId(value)) {
    throw new Error(`${label} 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID`);
  }
  return value;
}

/** OCI tag 段：小写字母/数字/点/下划线/连字符，首字符不能是连字符，最长 128。 */
const SAFE_TAG_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function isSafeTagSegment(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TAG_SEGMENT.test(value);
}

export function assertSafeTagSegment(value: unknown, label: string): string {
  if (!isSafeTagSegment(value)) {
    throw new Error(`${label} 必须是合法的 OCI tag 段（小写字母/数字/点/下划线/连字符，1-128 字符）`);
  }
  return value;
}
