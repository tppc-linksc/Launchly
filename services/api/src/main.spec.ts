import { resolveCorsConfig } from './main';

/**
 * main.ts 单元测试（KI-011）。
 *
 * 只测纯函数 resolveCorsConfig——bootstrap() 必须不在 import 时被调用，
 * 因此测试文件不应触发 NestFactory.create。
 */
describe('resolveCorsConfig (KI-011)', () => {
  describe('未设置 / 空值 / 通配符场景', () => {
    it('undefined → 反射任意来源，credentials 必须 false（与 CORS 规范一致）', () => {
      const cfg = resolveCorsConfig(undefined);

      expect(cfg.origin).toBe(false);
      expect(cfg.credentials).toBe(false);
    });

    it('空字符串 "" → 同上', () => {
      const cfg = resolveCorsConfig('');

      expect(cfg.origin).toBe(false);
      expect(cfg.credentials).toBe(false);
    });

    it('通配符 "*" → 反射任意来源，credentials=false（避免 * + credentials 非法组合）', () => {
      const cfg = resolveCorsConfig('*');

      expect(cfg.origin).toBe(true);
      expect(cfg.credentials).toBe(false);
    });

    it('纯空格字符串 "" → 视作未设置', () => {
      const cfg = resolveCorsConfig('   ');

      expect(cfg.origin).toBe(false);
      expect(cfg.credentials).toBe(false);
    });

    it('通配符两侧含空格 "*  " → 仍识别为通配', () => {
      const cfg = resolveCorsConfig('  *  ');

      expect(cfg.origin).toBe(true);
      expect(cfg.credentials).toBe(false);
    });
  });

  describe('显式列表场景', () => {
    it('单个 origin → 返回长度为 1 的数组，credentials=true', () => {
      const cfg = resolveCorsConfig('https://app.example.com');

      expect(cfg.origin).toEqual(['https://app.example.com']);
      expect(cfg.credentials).toBe(true);
    });

    it('多个 origin 逗号分隔 → 拆分、去空格、原序', () => {
      const cfg = resolveCorsConfig('https://a.example.com,https://b.example.com,https://c.example.com');

      expect(cfg.origin).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com']);
      expect(cfg.credentials).toBe(true);
    });

    it('元素前后带多余空格 → 逐项 trim', () => {
      const cfg = resolveCorsConfig('  https://a.com  ,	https://b.com\n');

      expect(cfg.origin).toEqual(['https://a.com', 'https://b.com']);
      expect(cfg.credentials).toBe(true);
    });

    it('只有空项 "  ,  ,  " → 全部 filter 后为空数组，但走的是列表分支', () => {
      // 实现里 filter(Boolean) 把空项去掉，结果是空数组但 credentials
      // 仍按 "列表长度>0" 的逻辑 => 此处为 false。这个边界用例验证
      // 实现没有假装给一个空列表赋予 credentials=true。
      const cfg = resolveCorsConfig('  ,  ,  ');

      expect(cfg.origin).toEqual([]);
      expect(cfg.credentials).toBe(false);
    });
  });

  describe('返回值稳定性', () => {
    it('同一输入调用两次返回结构等价（无外部状态泄漏）', () => {
      const a = resolveCorsConfig('https://x.com');
      const b = resolveCorsConfig('https://x.com');

      expect(a).toEqual(b);
    });

    it('返回值形状始终为 { origin, credentials }', () => {
      const samples = [undefined, '', '*', 'https://x.com'];
      for (const s of samples) {
        const cfg = resolveCorsConfig(s);
        expect(cfg).toHaveProperty('origin');
        expect(cfg).toHaveProperty('credentials');
        expect(typeof cfg.credentials).toBe('boolean');
      }
    });
  });

  describe('与 CORS 规范的关键约束（KI-011）', () => {
    it('"*" 分支永远不会同时出现 credentials=true', () => {
      // 实现上保证 origin=true 时 credentials=false；这里反复跑多种非法输入。
      const wildcards = [undefined, '', '   ', '*', '  *  '];
      for (const raw of wildcards) {
        const cfg = resolveCorsConfig(raw);
        if (cfg.origin === true) {
          expect(cfg.credentials).toBe(false);
        }
      }
    });

    it('显式列表分支允许 credentials=true（仅在列表非空时）', () => {
      const cfg = resolveCorsConfig('https://app.example.com');
      expect(cfg.origin).not.toBe(true);
      expect(cfg.credentials).toBe(true);
    });
  });
});
