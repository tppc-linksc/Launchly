import { resolveBoundedInt } from './env-integer';

/**
 * resolveBoundedInt 单元测试（KI-036）。
 *
 * 行为契约：
 * - raw ∈ {undefined, null, ""}            → defaultValue
 * - parseInt 结果非有限数（NaN）             → defaultValue + warn
 * - 解析值 < min 或 > max                    → defaultValue + warn
 * - 其余                                     → 返回解析值
 *
 * 不验证 console.warn 调用——本测试只断言返回值，确保实现不"沉默"
 * 把无效输入落到合法值上时仍能跑通业务（label 参数仅用作日志前缀）。
 */
describe('resolveBoundedInt', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  // ============================================================
  // A. 缺失 / 空值
  // ============================================================
  describe('A. 缺失 / 空值', () => {
    it('undefined → 返回 defaultValue', () => {
      expect(resolveBoundedInt(undefined, 5, 1, 10, 'X')).toBe(5);
    });

    it('null → 返回 defaultValue', () => {
      expect(resolveBoundedInt(null as any, 7, 1, 10, 'X')).toBe(7);
    });

    it('空字符串 "" → 返回 defaultValue', () => {
      expect(resolveBoundedInt('', 3, 1, 10, 'X')).toBe(3);
    });
  });

  // ============================================================
  // B. 非数字字符串
  // ============================================================
  describe('B. 非数字字符串', () => {
    it.each(['abc', '   ', '--3', 'NaN', 'not-a-number', 'foo123bar'])('parseInt("%s")=NaN → defaultValue', (raw) => {
      expect(resolveBoundedInt(raw, 9, 1, 100, 'X')).toBe(9);
    });

    it.each([
      // parseInt 在 radix=10 下逐字符解析；这些看起来"奇怪"的字符串实际会被
      // parseInt 截断到非数字字符为止，得到一个有限整数。然后由区间校验判断是否合法。
      ['0xZZ', 9], // parseInt('0xZZ', 10) = 0 → 0 < min=1 → 落到 default
      ['1.5.5', 1], // parseInt('1.5.5', 10) = 1 → 合法，原样返回
      ['1.0e5', 1], // parseInt('1.0e5', 10) = 1 → 合法，原样返回
    ])('parseInt("%s")=%d 后由范围校验决定最终返回值', (raw, expected) => {
      expect(resolveBoundedInt(raw, 9, 1, 100, 'X')).toBe(expected);
    });
  });

  // ============================================================
  // C. 范围下界
  // ============================================================
  describe('C. 范围下界', () => {
    it('等于 min → 通过（闭区间）', () => {
      expect(resolveBoundedInt('5', 0, 5, 10, 'X')).toBe(5);
    });

    it('min - 1 → 回退到 defaultValue', () => {
      expect(resolveBoundedInt('4', 0, 5, 10, 'X')).toBe(0);
    });

    it('远低于 min → 回退到 defaultValue', () => {
      expect(resolveBoundedInt('-100', 1, 0, 100, 'X')).toBe(1);
    });
  });

  // ============================================================
  // D. 范围上界
  // ============================================================
  describe('D. 范围上界', () => {
    it('等于 max → 通过（闭区间）', () => {
      expect(resolveBoundedInt('100', 0, 1, 100, 'X')).toBe(100);
    });

    it('max + 1 → 回退到 defaultValue', () => {
      expect(resolveBoundedInt('101', 0, 1, 100, 'X')).toBe(0);
    });

    it('远高于 max → 回退到 defaultValue', () => {
      expect(resolveBoundedInt('999999', 50, 1, 100, 'X')).toBe(50);
    });
  });

  // ============================================================
  // E. 合法值
  // ============================================================
  describe('E. 合法值原样返回', () => {
    it.each([
      ['1', 1, 1, 100],
      ['50', 50, 1, 100],
      ['99', 99, 1, 100],
      ['0', 0, 0, 100],
      ['-50', -50, -100, 0],
    ])('parseInt("%s")=合法值落在 [%d, %d] → 原样返回', (raw, _placeholder, min, max) => {
      expect(resolveBoundedInt(raw, 9999, min, max, 'X')).toBe(parseInt(raw, 10));
    });

    it('十进制前后空格可被 parseInt 容忍 → 仍按解析值返回', () => {
      expect(resolveBoundedInt('  7 ', 0, 1, 10, 'X')).toBe(7);
    });

    it('前导 0 / 十六进制不影响 parseInt 结果', () => {
      // parseInt('010', 10) === 10; 不是十六进制，但仍是边界用例。
      expect(resolveBoundedInt('010', 0, 1, 100, 'X')).toBe(10);
    });
  });

  // ============================================================
  // F. defaultValue 自身在范围外时也照样返回（不二次校验）
  // ============================================================
  describe('F. defaultValue 行为', () => {
    it('defaultValue 小于 min：仍原样返回（实现不二次校验 defaultValue）', () => {
      // 这是已记录的实现契约：解析器只负责回退，不为 defaultValue 兜底。
      expect(resolveBoundedInt(undefined, -5, 0, 10, 'X')).toBe(-5);
    });

    it('defaultValue 大于 max：仍原样返回', () => {
      expect(resolveBoundedInt(undefined, 999, 0, 10, 'X')).toBe(999);
    });
  });
});
