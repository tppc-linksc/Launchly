import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

type EncryptionKey = { id: string; value: Buffer };

@Injectable()
export class SecretValueService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keys: EncryptionKey[];

  constructor() {
    const current = process.env.LAUNCHLY_ENCRYPTION_KEY;
    if (!current && process.env.NODE_ENV === 'production') {
      throw new Error('LAUNCHLY_ENCRYPTION_KEY is required in production and must not reuse the JWT secret');
    }
    if (process.env.NODE_ENV === 'production' && current === process.env.LAUNCHLY_JWT_SECRET) {
      throw new Error('LAUNCHLY_ENCRYPTION_KEY must not reuse LAUNCHLY_JWT_SECRET in production');
    }
    const rawKeys = [current || 'launchly-development-encryption-key-not-for-production', ...(process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS || '').split(',').filter(Boolean)];
    this.keys = rawKeys.map(raw => ({
      id: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12),
      value: crypto.createHash('sha256').update(raw).digest(),
    }));
  }

  encrypt(plaintext: string): string {
    const key = this.keys[0];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, key.value, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v2:${key.id}:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
  }

  decrypt(encryptedValue: string): string {
    const [version, keyId, encoded] = encryptedValue.split(':', 3);
    if (version === 'v2' && keyId && encoded) {
      const key = this.keys.find(candidate => candidate.id === keyId);
      if (!key) throw new Error('Encrypted value requires an unavailable encryption key');
      return this.decryptWithKey(encoded, key.value);
    }
    if (version === 'v1' && keyId) {
      for (const key of this.keys) {
        try { return this.decryptWithKey(keyId, key.value); } catch { /* try rotated key */ }
      }
      throw new Error('Unable to decrypt legacy value with configured encryption keys');
    }
    throw new Error('Unsupported encryption format');
  }

  /** Re-encrypt a value with the active key after a successful read using a prior key. */
  reencrypt(encryptedValue: string): string {
    return this.encrypt(this.decrypt(encryptedValue));
  }

  mask(value: string): string {
    if (!value || value.length <= 4) return '****';
    return value.slice(0, 2) + '*'.repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
  }

  private decryptWithKey(encoded: string, key: Buffer): string {
    const data = Buffer.from(encoded, 'base64');
    if (data.length < 29) throw new Error('Encrypted value is malformed');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  }
}
