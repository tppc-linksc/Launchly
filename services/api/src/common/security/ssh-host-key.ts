const KEY_ALGORITHM =
  /^(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-[a-z0-9-]+|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/;
const KEY_BODY = /^[A-Za-z0-9+/]+={0,3}$/;

export interface ParsedSshHostKey {
  algorithm: string;
  key: string;
}
/** Accepts either `algorithm base64 [comment]` or `host algorithm base64 [comment]`. */
export function parseSshHostKey(value: unknown): ParsedSshHostKey | null {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) return null;
  const parts = value.trim().split(/\s+/);
  const algorithmIndex = KEY_ALGORITHM.test(parts[0] || '') ? 0 : KEY_ALGORITHM.test(parts[1] || '') ? 1 : -1;
  if (algorithmIndex < 0) return null;
  const key = parts[algorithmIndex + 1];
  if (!key || key.length < 16 || !KEY_BODY.test(key)) return null;
  try {
    if (Buffer.from(key, 'base64').length < 8) return null;
  } catch {
    return null;
  }
  return { algorithm: parts[algorithmIndex], key };
}

export function canonicalSshHostKey(value: unknown): string | null {
  const parsed = parseSshHostKey(value);
  return parsed ? `${parsed.algorithm} ${parsed.key}` : null;
}
