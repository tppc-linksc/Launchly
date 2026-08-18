/**
 * 受限的整型环境变量解析器（KI-036）。
 *
 * 行为：
 * - 缺失 / 空 / 非数字 → defaultValue
 * - 解析后 < min           → defaultValue
 * - 解析后 > max           → defaultValue
 * - 否则返回解析值
 *
 * 不打印日志；由调用者决定是否提示。
 */
export function resolveBoundedInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  label: string,
): number {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${label}=${JSON.stringify(raw)} 不是整数，回退到 ${defaultValue}`);
    return defaultValue;
  }
  if (parsed < min || parsed > max) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${label}=${parsed} 超出范围 [${min}, ${max}]，回退到 ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}
