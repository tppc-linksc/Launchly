const SENSITIVE_ENV_KEY = /(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY(?:_BASE64)?|AUTH_JSON|ENCRYPTION_(?:KEY|PREVIOUS_KEYS)|DATABASE_URL)$/i

function parsedKey(line: string): string | null {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  return match?.[1] || null
}

export function isSensitiveEnvLine(line: string): boolean {
  const key = parsedKey(line)
  return Boolean(key && SENSITIVE_ENV_KEY.test(key))
}

/** Backups carry non-secret settings only; operational keys must be kept separately. */
export function sanitizeEnvForBackup(contents: string): string {
  const lines = contents.split(/\r?\n/).filter(line => !isSensitiveEnvLine(line))
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

/**
 * Safe backups contain no secret lines, so recovery reuses the separately
 * provisioned keys from the current instance. Legacy backups remain readable:
 * their original encryption/JWT keys win, while the active DB password wins
 * because pg_dump does not restore PostgreSQL roles/passwords.
 */
export function mergeRestoredEnv(current: string, restored: string): string {
  const currentSecrets = new Map<string, string>()
  const restoredSecrets = new Map<string, string>()
  for (const line of current.split(/\r?\n/)) {
    const key = parsedKey(line)
    if (key && isSensitiveEnvLine(line)) currentSecrets.set(key, line)
  }
  for (const line of restored.split(/\r?\n/)) {
    const key = parsedKey(line)
    if (key && isSensitiveEnvLine(line)) restoredSecrets.set(key, line)
  }

  const nonSecret = restored.split(/\r?\n/).filter(line => !isSensitiveEnvLine(line))
  const mergedSecrets = new Map(currentSecrets)
  for (const [key, line] of restoredSecrets) mergedSecrets.set(key, line)
  if (currentSecrets.has('LAUNCHLY_DB_PASSWORD')) {
    mergedSecrets.set('LAUNCHLY_DB_PASSWORD', currentSecrets.get('LAUNCHLY_DB_PASSWORD')!)
  }
  const body = [...nonSecret, ...mergedSecrets.values()].join('\n').replace(/\n+$/, '')
  return `${body}\n`
}

export function hasRequiredRestoreKeys(contents: string): boolean {
  const keys = new Set(contents.split(/\r?\n/).flatMap(line => {
    const key = parsedKey(line)
    const separator = line.indexOf('=')
    if (!key || separator < 0) return []
    const value = line.slice(separator + 1).trim()
    return value && value !== "''" && value !== '""' ? [key] : []
  }))
  return ['LAUNCHLY_DB_PASSWORD', 'LAUNCHLY_JWT_SECRET', 'LAUNCHLY_ENCRYPTION_KEY']
    .every(key => keys.has(key))
}
