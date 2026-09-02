import { SAFE_REF_ID, assertSafeRefId, assertSafeTagSegment, isSafeRefId, isSafeTagSegment } from './ref-id-safety';

/**
 * ref-id-safety 单元测试（KI-032）。
 *
 * 单一权威：所有 Runner 拿到 caller 控制的 ID（refId / projectId /
 * environmentId 等）必须先过 assertSafeRefId，避免被注入 shell 元字符。
 *
 * OCI tag 段使用更严格的小写字母/数字/点/下划线/连字符规则。
 */
describe('ref-id-safety', () => {
  describe('A. SAFE_REF_ID 正则基础行为', () => {
    it('期望的合法字符串全部通过', () => {
      const samples = [
        'a',
        'A',
        '0',
        'abc',
        'ABC',
        'abc-123',
        'abc_123',
        'A_b-c-1',
        '1'.repeat(128), // 边界长度
      ];
      for (const s of samples) {
        expect(SAFE_REF_ID.test(s)).toBe(true);
      }
    });

    it('含有 shell 元字符的字符串全部被拒绝', () => {
      const samples = [
        'a;rm',
        'a|b',
        'a&b',
        'a$b',
        'a`b',
        'a b', // 空格
        'a' + '\n' + 'b',
        'a' + '\t' + 'b',
        "a'b",
        'a"b',
        'a<b',
        'a>b',
        'a(b',
        'a)b',
        'a{b',
        'a}b',
        'a[b',
        'a]b',
        'a/b',
        'a\\b',
        'a:b',
        'a,b',
        'a@b',
        'a#b',
        'a?b',
      ];
      for (const s of samples) {
        expect(SAFE_REF_ID.test(s)).toBe(false);
      }
    });

    it('空字符串 → 拒绝', () => {
      expect(SAFE_REF_ID.test('')).toBe(false);
    });

    it('长度 129（>128）→ 拒绝', () => {
      expect(SAFE_REF_ID.test('1'.repeat(129))).toBe(false);
    });
  });

  describe('B. isSafeRefId', () => {
    it('字符串合法 → 返回 true', () => {
      expect(isSafeRefId('abc-123')).toBe(true);
    });

    it('字符串不合法 → 返回 false', () => {
      expect(isSafeRefId('a;rm -rf /')).toBe(false);
      expect(isSafeRefId('has space')).toBe(false);
      expect(isSafeRefId('has.dot')).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number 1', 1],
      ['boolean true', true],
      ['object', {}],
      ['array', []],
    ])('非字符串输入 %s → 返回 false', (_label, value) => {
      expect(isSafeRefId(value)).toBe(false);
    });

    it('带点的字符串（如 v1.2.3）应被通用 ID 规则拒绝', () => {
      expect(isSafeRefId('v1.2.3')).toBe(false);
    });
  });

  describe('C. assertSafeRefId', () => {
    it('合法值 → 返回原值', () => {
      expect(assertSafeRefId('abc_123', 'projectId')).toBe('abc_123');
    });

    it('不合法 → 抛出 Error，message 同时包含 label 和规则描述', () => {
      const fn = () => assertSafeRefId('evil;rm', 'projectId');

      expect(fn).toThrow(Error);
      try {
        fn();
      } catch (err) {
        expect((err as Error).message).toContain('projectId');
        expect((err as Error).message).toMatch(/字母|数字|下划线|连字符/);
      }
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
    ])('非字符串输入 %s → 抛出 Error', (_label, value) => {
      expect(() => assertSafeRefId(value, 'envId')).toThrow(Error);
    });
  });

  describe('D. isSafeTagSegment - 小写/数字/._-，首字符不能是 -', () => {
    it('典型 tag 段全部通过', () => {
      const samples = [
        'main',
        'v1',
        'v1.2.3',
        'release_2026_08',
        'a',
        '0',
        'main-rc1',
        'a'.repeat(128), // 长度边界
      ];
      for (const s of samples) {
        expect(isSafeTagSegment(s)).toBe(true);
      }
    });

    it('大写字母 → 拒绝（OCI tag 必须小写）', () => {
      expect(isSafeTagSegment('Main')).toBe(false);
      expect(isSafeTagSegment('V1')).toBe(false);
    });

    it('首字符是连字符 → 拒绝', () => {
      expect(isSafeTagSegment('-main')).toBe(false);
    });

    it('空格 / shell 元字符 → 拒绝', () => {
      expect(isSafeTagSegment('a b')).toBe(false);
      expect(isSafeTagSegment('a;b')).toBe(false);
      expect(isSafeTagSegment('a/b')).toBe(false);
    });

    it('长度 129（>128）→ 拒绝', () => {
      expect(isSafeTagSegment('a'.repeat(129))).toBe(false);
    });

    it('空字符串 → 拒绝', () => {
      expect(isSafeTagSegment('')).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 1],
    ])('非字符串输入 %s → 拒绝', (_label, value) => {
      expect(isSafeTagSegment(value)).toBe(false);
    });
  });

  describe('E. assertSafeTagSegment', () => {
    it('合法 tag 段 → 返回原值', () => {
      expect(assertSafeTagSegment('v1.2.3', 'imageTag')).toBe('v1.2.3');
    });

    it('不合法 → 抛出 Error，message 含 label 与 OCI tag 规则描述', () => {
      const fn = () => assertSafeTagSegment('Main', 'imageTag');
      expect(fn).toThrow(Error);
      try {
        fn();
      } catch (err) {
        expect((err as Error).message).toContain('imageTag');
        expect((err as Error).message).toMatch(/OCI tag/);
      }
    });

    it('首字符是连字符的场景也抛错', () => {
      expect(() => assertSafeTagSegment('-rc1', 'tag')).toThrow(Error);
    });
  });
});
