import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class SecretValueService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.LAUNCHLY_ENCRYPTION_KEY || process.env.LAUNCHLY_JWT_SECRET || '';
    this.key = crypto.createHash('sha256').update(rawKey).digest();
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'v1:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(encryptedValue: string): string {
    if (!encryptedValue.startsWith('v1:')) {
      throw new Error('Unsupported encryption format');
    }
    const data = Buffer.from(encryptedValue.slice(3), 'base64');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  mask(value: string): string {
    if (!value || value.length <= 4) return '****';
    return value.slice(0, 2) + '*'.repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
  }
}
