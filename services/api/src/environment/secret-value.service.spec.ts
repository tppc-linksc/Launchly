import { SecretValueService } from './secret-value.service';

const ENV_KEYS = [
  'NODE_ENV',
  'LAUNCHLY_ENCRYPTION_KEY',
  'LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS',
  'LAUNCHLY_JWT_SECRET',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function snapshotEnv(): Record<EnvKey, string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    LAUNCHLY_ENCRYPTION_KEY: process.env.LAUNCHLY_ENCRYPTION_KEY,
    LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS: process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS,
    LAUNCHLY_JWT_SECRET: process.env.LAUNCHLY_JWT_SECRET,
  };
}

function restoreEnv(snapshot: Record<EnvKey, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe('SecretValueService', () => {
  let snapshot: Record<EnvKey, string | undefined>;

  beforeEach(() => {
    snapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  describe('encrypt + decrypt', () => {
    it('v2 ciphertext does not contain plaintext and decrypts back to original', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'test-current-key-for-encryption';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      const plaintext = 'super-secret-value-12345';

      const ciphertext = service.encrypt(plaintext);

      expect(ciphertext.startsWith('v2:')).toBe(true);
      expect(ciphertext.includes(plaintext)).toBe(false);
      expect(service.decrypt(ciphertext)).toBe(plaintext);
    });

    it('encrypting the same plaintext twice produces different ciphertexts that both decrypt correctly', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'test-current-key-for-encryption';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      const plaintext = 'identical-input';

      const a = service.encrypt(plaintext);
      const b = service.encrypt(plaintext);

      expect(a).not.toBe(b);
      expect(service.decrypt(a)).toBe(plaintext);
      expect(service.decrypt(b)).toBe(plaintext);
    });

    it('tampering with the auth tag makes decrypt fail', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'test-current-key-for-encryption';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      const ciphertext = service.encrypt('hello-world');
      const parts = ciphertext.split(':');
      const payload = Buffer.from(parts[2], 'base64');
      // flip a bit inside the auth tag region (bytes 12..28)
      payload[15] = payload[15] ^ 0xff;
      parts[2] = payload.toString('base64');
      const tampered = parts.join(':');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('tampering with the ciphertext body makes decrypt fail', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'test-current-key-for-encryption';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      const ciphertext = service.encrypt('hello-world');
      const parts = ciphertext.split(':');
      const payload = Buffer.from(parts[2], 'base64');
      // flip a bit in the ciphertext region (after byte 28)
      payload[30] = payload[30] ^ 0xff;
      parts[2] = payload.toString('base64');
      const tampered = parts.join(':');

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('decrypt validation', () => {
    it('throws when the key id is unknown', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'current-key';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      // v2:UNKNOWN_KEYID:<base64>; v2 path requires the key id to match a known key
      const payload = Buffer.concat([Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from('x')]).toString('base64');
      const bogus = `v2:000000000000:${payload}`;

      expect(() => service.decrypt(bogus)).toThrow(/unavailable encryption key/);
    });

    it('throws for an unknown / unsupported version', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'current-key';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();

      expect(() => service.decrypt('v9:abc:def')).toThrow(/Unsupported encryption format/);
      expect(() => service.decrypt('notaversion')).toThrow(/Unsupported encryption format/);
    });

    it('throws when the payload is too short / malformed base64', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'current-key';
      delete process.env.NODE_ENV;

      const service = new SecretValueService();
      const valid = service.encrypt('hello');
      const validKeyId = valid.split(':')[1];

      // 28 bytes = 12 (iv) + 16 (tag); anything shorter is "malformed"
      const tooShort = Buffer.from('short').toString('base64');
      expect(() => service.decrypt(`v2:${validKeyId}:${tooShort}`)).toThrow(/malformed/);
    });
  });

  describe('key rotation', () => {
    it('previous keys can still decrypt older ciphertexts', () => {
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'old-key';
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      delete process.env.NODE_ENV;
      const oldService = new SecretValueService();
      const oldCipher = oldService.encrypt('legacy-secret');
      const oldKeyId = oldService.encrypt('x').split(':')[1]; // capture current key id under old config

      // Rotate: old key becomes "previous", new key is current
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'new-key';
      process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS = 'old-key';
      const newService = new SecretValueService();

      // The new key id must differ from the old key id
      const newKeyId = newService.encrypt('y').split(':')[1];
      expect(newKeyId).not.toBe(oldKeyId);

      // Decrypting the old ciphertext with the new service must still succeed
      expect(newService.decrypt(oldCipher)).toBe('legacy-secret');
    });

    it('reencrypt() rewrites under the current key and no longer uses the old key id', () => {
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'old-key';
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      delete process.env.NODE_ENV;
      const oldService = new SecretValueService();
      const oldCipher = oldService.encrypt('rotated-secret');
      const oldKeyId = oldCipher.split(':')[1];

      process.env.LAUNCHLY_ENCRYPTION_KEY = 'new-key';
      process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS = 'old-key';
      const newService = new SecretValueService();
      const currentKeyId = newService.encrypt('x').split(':')[1];

      const reencrypted = newService.reencrypt(oldCipher);

      expect(reencrypted.startsWith('v2:')).toBe(true);
      expect(reencrypted.split(':')[1]).toBe(currentKeyId);
      expect(reencrypted.split(':')[1]).not.toBe(oldKeyId);
      expect(newService.decrypt(reencrypted)).toBe('rotated-secret');
    });
  });

  describe('constructor', () => {
    it('throws in production when LAUNCHLY_ENCRYPTION_KEY is missing', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_KEY;
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.NODE_ENV = 'production';

      expect(() => new SecretValueService()).toThrow(/LAUNCHLY_ENCRYPTION_KEY is required/);
    });

    it('does not throw in non-production when LAUNCHLY_ENCRYPTION_KEY is missing', () => {
      delete process.env.LAUNCHLY_ENCRYPTION_KEY;
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.NODE_ENV = 'test';

      expect(() => new SecretValueService()).not.toThrow();
    });

    it('throws in production when the encryption key reuses the JWT secret', () => {
      process.env.NODE_ENV = 'production';
      process.env.LAUNCHLY_JWT_SECRET = 'same-production-secret';
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'same-production-secret';

      expect(() => new SecretValueService()).toThrow(/must not reuse/);
    });
  });

  describe('mask()', () => {
    function makeService(): SecretValueService {
      delete process.env.LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS;
      process.env.LAUNCHLY_ENCRYPTION_KEY = 'mask-test-key';
      delete process.env.NODE_ENV;
      return new SecretValueService();
    }

    it('returns **** for an empty string', () => {
      const s = makeService();
      expect(s.mask('')).toBe('****');
    });

    it('returns **** for 1, 2, 3 and 4 character inputs', () => {
      const s = makeService();
      expect(s.mask('a')).toBe('****');
      expect(s.mask('ab')).toBe('****');
      expect(s.mask('abc')).toBe('****');
      expect(s.mask('abcd')).toBe('****');
    });

    it('keeps first 2 and last 2 characters for a 5 character input', () => {
      const s = makeService();
      expect(s.mask('abcde')).toBe('ab*de');
    });

    it('masks a normal-length string keeping first 2 and last 2', () => {
      const s = makeService();
      const value = 'abcdefghij'; // 10 chars
      const masked = s.mask(value);
      expect(masked.startsWith('ab')).toBe(true);
      expect(masked.endsWith('ij')).toBe(true);
      // 10 - 4 = 6 stars between, no cap yet
      expect(masked).toBe('ab******ij');
    });

    it('caps stars at 20 and keeps first 2 / last 2 for very long strings', () => {
      const s = makeService();
      const value = 'a'.repeat(100) + 'XY'; // 102 chars, last two are 'XY'
      const masked = s.mask(value);
      // First 2 = 'aa', last 2 = 'XY'
      expect(masked.startsWith('aa')).toBe(true);
      expect(masked.endsWith('XY')).toBe(true);
      // Star count must be capped at 20, so total length = 2 + 20 + 2 = 24
      const stars = masked.slice(2, -2);
      expect(stars.length).toBe(20);
      expect(stars).toBe('*'.repeat(20));
      expect(masked.length).toBe(24);
    });
  });
});
