import { containsSensitiveKey, redact } from './secret-redactor';

/**
 * 日志脱敏器单元测试（KI-028 / KI-030 / R0-08）。
 *
 * 实际行为契约：
 * - JSON 结构感知：\"key\":\"value\" 形式的 value 会被替换为 ' [REDACTED]'（保留闭合引号）；
 * - shell 风格：key=value / key:value，且 key 必须位于行首或前导空白/;/{；
 * - 字段名匹配大小写不敏感；
 * - 同时覆盖 Authorization Bearer、GitHub Token、DSN、PEM 私钥；
 * - 不修改文本中不含敏感字段或结构的部分。
 */
// ⚠️ 该 suite 已编写完成（覆盖 JSON / shell / Bearer / GitHub / DSN / PEM /
// containsSensitiveKey 等场景）。
// 但当前上游 secret-redactor.ts 处于活跃修改状态（untracked 文件，每次读取都不同），
// 不同时刻的实现契约存在不一致（例如 HEADER_PATTERN 对 token 部分的处理边界）。
// 在源码稳定之前，整套用例暂以 .skip 跳过，避免干扰 CI。
// 解除方法：把 .skip 去掉即可。
describe('secret-redactor.redact', () => {
  it('redacts exact per-task secret values even when no sensitive key is present', () => {
    const output = redact('application printed bare-value-123 in stdout', ['bare-value-123']);
    expect(output).toBe('application printed [REDACTED] in stdout');
  });

  it('redacts overlapping registered values longest-first', () => {
    expect(redact('token-extended token', ['token', 'token-extended']))
      .toBe('[REDACTED] [REDACTED]');
  });

  // ============================================================
  // A. JSON 风格敏感键值对
  // ============================================================
  describe('A. JSON 风格：\"key\":\"value\"', () => {
    it('脱敏 \"password\":\"hunter2\" → value 部分被替换为 [REDACTED]', () => {
      const out = redact('{\"password\":\"hunter2\", \"user\":\"alice\"}');
      // 实际行为：\"password\":\"hunter2\" 变成 \"password\": [REDACTED]\"（闭合引号保留）
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('hunter2');
      expect(out).toContain('\"user\":\"alice\"');
    });

    it('JSON 中所有 SENSITIVE_KEYS 命名的 value 都被脱敏', () => {
      const keys = ['password','passwd','token','access_token','refresh_token','secret','api_key','apikey','private_key','privatekey','credential','credentials','auth','authorization'];
      for (const k of keys) {
        const input = JSON.stringify({ [k]: 'leaked-value-123' });
        const out = redact(input);
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('leaked-value-123');
      }
    });

    it('字段名大小写不敏感：Password / TOKEN / Secret 都能识别', () => {
      const samples = [
        '{\"Password\":\"a\"}',
        '{\"TOKEN\":\"b\"}',
        '{\"Secret\":\"c\"}',
        '{\"AUTHORIZATION\":\"d\"}',
      ];
      for (const s of samples) {
        const out = redact(s);
        // 注意：闭合引号保留，所以 value 字符应不再出现。
        expect(out).not.toMatch(/\":\"[abcd]\"/);
        expect(out).toContain('[REDACTED]');
      }
    });

    it('同一个 JSON 中多个敏感 key 全部被处理', () => {
      const out = redact('{\"password\":\"a\",\"token\":\"b\",\"name\":\"alice\"}');
      expect(out).not.toMatch(/\":\"a\"/);
      expect(out).not.toMatch(/\":\"b\"/);
      expect(out).toContain('\"name\":\"alice\"');
      const matches = out.match(/\[REDACTED\]/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('数组里的敏感对象同样被脱敏', () => {
      const input = '[{\"secret\":\"x\"},{\"secret\":\"y\"}]';
      const out = redact(input);
      expect(out).not.toMatch(/\":\"x\"/);
      expect(out).not.toMatch(/\":\"y\"/);
      const matches = out.match(/\[REDACTED\]/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('数字 / 布尔 value 同样被脱敏（裸值模式覆盖 JSON 数字）', () => {
      const out = redact('{\"password\":123, \"user\":\"alice\"}');
      expect(out).toContain('\"user\":\"alice\"');
      expect(out).not.toContain('123');
      expect(out).toContain('[REDACTED]');
    });

    it('非敏感字段（如 name / url）原样保留', () => {
      const input = JSON.stringify({ name: 'demo', url: 'https://example.com' });
      const out = redact(input);
      expect(out).toBe(input);
    });
  });

  // ============================================================
  // B. shell 命令行风格
  // ============================================================
  describe('B. shell 风格：key=value / key: value', () => {
    it('行首的 key=value 会被脱敏', () => {
      const out = redact('PASSWORD=hunter2');
      expect(out).not.toContain('hunter2');
      expect(out).toContain('[REDACTED]');
    });

    it('export TOKEN=hunter2（前导空格/分界符）会被脱敏', () => {
      const out = redact('export TOKEN=hunter2 && echo hi');
      expect(out).not.toContain('hunter2');
      expect(out).toContain('[REDACTED]');
      expect(out).toContain('echo hi');
    });

    it('API_KEY : my-secret-xyz（key 与 : 之间有空格）也能识别', () => {
      const out = redact('API_KEY : my-secret-xyz');
      expect(out).not.toContain('my-secret-xyz');
      expect(out).toContain('[REDACTED]');
    });

    it('shell 单引号包裹的 value 也会被脱敏', () => {
      const out = redact("PASSWORD='hunter2'");
      expect(out).not.toContain('hunter2');
      expect(out).toContain('[REDACTED]');
    });

    it('前一个 token 是字母数字（如 user=alice 后跟 password=...）时 password 段会被处理', () => {
      const out = redact('user=alice password=secret1');
      // 注意：当前实现仅当 key 前为 \\s/;/{ 或行首才匹配。
      // 这里 password 前是空格，所以应该被匹配。
      expect(out).not.toContain('secret1');
      expect(out).toContain('[REDACTED]');
    });
  });

  // ============================================================
  // C. Authorization Bearer / Basic
  // ============================================================
  describe('C. Authorization / Bearer / Basic 头', () => {
    it('Authorization: Bearer xxx → 整段替换为 [REDACTED]', () => {
      const out = redact('headers: { Authorization: Bearer eyJabc.def.ghi }');
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('eyJabc.def.ghi');
      expect(out).not.toMatch(/Bearer\\s+eyJabc/);
    });

    it('authorization=Basic dXNlcjpwYXNzd29yZA== 也被识别（大小写不敏感）', () => {
      const out = redact('authorization=Basic dXNlcjpwYXNzd29yZA==');
      expect(out).not.toContain('dXNlcjpwYXNzd29yZA==');
      expect(out).toContain('[REDACTED]');
    });

    it('auth: bearer token（小写 key 也能识别）', () => {
      const out = redact('auth: bearer secret-token');
      expect(out).not.toContain('secret-token');
      expect(out).toContain('[REDACTED]');
    });
  });

  // ============================================================
  // D. GitHub personal access token
  // ============================================================
  describe('D. GitHub personal access token (ghp_/ghs_/gho_/ghu_)', () => {
    it.each([
      ['ghp_aaaaaaaaaaaaaaaaaaaa'],
      ['ghs_bbbbbbbbbbbbbbbbbbbb'],
      ['gho_cccccccccccccccccccc'],
      ['ghu_dddddddddddddddddddd'],
    ])('前缀 token %s 被脱敏', (token) => {
      const out = redact(`commit message body contains ${token}`);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain(token);
    });

    it('短于 20 字符的 ghp_ 不被识别（避免误伤相似单词）', () => {
      const out = redact('ghp_short');
      expect(out).toBe('ghp_short');
    });

    it('前后文中的 GitHub token 替换为 REDACTED 后保留其他文本', () => {
      const out = redact('user said ghp_bbbbbbbbbbbbbbbbbbbb today');
      expect(out).toContain('user said');
      expect(out).toContain('today');
      expect(out).toContain('[REDACTED]');
    });
  });

  // ============================================================
  // E. DSN（连接串）
  // ============================================================
  describe('E. DSN 连接串（含 user:pass@host 模式）', () => {
    it.each([
      ['postgres://user:pass@host:5432/db'],
      ['postgresql://u:p@h/d'],
      ['mysql://u:p@h:3306/d'],
      ['amqp://u:p@h:5672'],
      ['amqps://u:p@h:5671'],
      ['mongodb://u:p@h:27017/d'],
      ['mongodb+srv://u:p@h/d'],
      ['redis://:pass@h:6379'],
      ['rediss://u:p@h:6380'],
    ])('脱敏 %s', (dsn) => {
      const out = redact('connecting to ' + dsn + ' now');
      expect(out).toContain('[REDACTED]');
      // DSN 整段被替换，不应再含 ':pass@' 或 ':p@'
      expect(out).not.toMatch(/:(p|pass|u:p)@/);
    });

    it('普通 https URL 不被误伤（没有 user:pass@ 结构）', () => {
      const out = redact('https://example.com/foo/bar');
      expect(out).toBe('https://example.com/foo/bar');
    });
  });

  // ============================================================
  // F. PEM 私钥块
  // ============================================================
  describe('F. PEM 私钥块', () => {
    it('标准 PRIVATE KEY 块整段被脱敏', () => {
      const pem = ['-----BEGIN PRIVATE KEY-----', 'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEAuKR=', '-----END PRIVATE KEY-----'].join('\n');
      const out = redact(`key file:\n${pem}`);
      expect(out).not.toContain('MIIBVgIBADANBgkq');
      expect(out).not.toContain('-----BEGIN PRIVATE KEY-----');
      expect(out).not.toContain('-----END PRIVATE KEY-----');
      expect(out).toContain('[REDACTED]');
    });

    it('RSA PRIVATE KEY 块也被覆盖', () => {
      const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'abcdef0123456789', '-----END RSA PRIVATE KEY-----'].join('\n');
      const out = redact(pem);
      expect(out).not.toContain('abcdef0123456789');
      expect(out).toContain('[REDACTED]');
    });

    it('多块 PEM 全部被脱敏', () => {
      const pem1 = ['-----BEGIN EC PRIVATE KEY-----', 'AAAA', '-----END EC PRIVATE KEY-----'].join('\n');
      const pem2 = ['-----BEGIN PRIVATE KEY-----', 'BBBB', '-----END PRIVATE KEY-----'].join('\n');
      const out = redact(pem1 + '\n' + pem2);
      expect(out).not.toContain('AAAA');
      expect(out).not.toContain('BBBB');
      const matches = out.match(/\[REDACTED\]/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // G. 输入处理边界
  // ============================================================
  describe('G. 输入处理', () => {
    it('null → 返回空字符串', () => {
      expect(redact(null)).toBe('');
    });
    it('undefined → 返回空字符串', () => {
      expect(redact(undefined)).toBe('');
    });
    it('空字符串 → 返回空字符串', () => {
      expect(redact('')).toBe('');
    });
    it('非字符串对象 → safeStringify 后再做脱敏', () => {
      const out = redact({ password: 'leaked', name: 'demo' });
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('leaked');
      expect(out).toContain('demo');
    });
    it('无法 JSON 序列化的对象（BigInt）→ 走 String() 路径不抛错', () => {
      const value: any = { token: BigInt(1) };
      expect(() => redact(value)).not.toThrow();
    });
    it('普通英文文本无敏感结构 → 原样返回', () => {
      const plain = 'docker build -t app:1.0 . && docker push registry/app:1.0';
      expect(redact(plain)).toBe(plain);
    });
  });

  // ============================================================
  // H. 组合场景
  // ============================================================
  describe('H. 组合场景', () => {
    it('一个文本同时含 Bearer、GitHub token、JSON password 都被处理', () => {
      const text = [
        'Request headers: Authorization: Bearer abc.def.ghi',
        'GitHub token used: ghp_aaaaaaaaaaaaaaaaaaaa',
        'Body: {\"password\":\"hunter2\"}',
      ].join('\n');
      const out = redact(text);

      expect(out).not.toContain('abc.def.ghi');
      expect(out).not.toContain('ghp_aaaaaaaaaaaaaaaaaaaa');
      expect(out).not.toContain('hunter2');
      const matches = out.match(/\[REDACTED\]/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('secret-redactor.containsSensitiveKey', () => {
  it('包含 password / PASSWORD / Password 都返回 true（大小写不敏感）', () => {
    expect(containsSensitiveKey('user password=xxx')).toBe(true);
    expect(containsSensitiveKey('PASSWORD=foo')).toBe(true);
    expect(containsSensitiveKey('my Password here')).toBe(true);
  });

    it.each(['token','secret','credential','authorization','auth','apikey','api_key'])('包含 %s → true', (key) => {
      expect(containsSensitiveKey('with ' + key + ' here')).toBe(true);
    });

  it('不包含任何敏感字段名 → false', () => {
    expect(containsSensitiveKey('hello world')).toBe(false);
    expect(containsSensitiveKey('foo bar baz')).toBe(false);
    expect(containsSensitiveKey('env=production')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(containsSensitiveKey('')).toBe(false);
  });
});
