import { ResourceCatalogService } from './resource-catalog.service';

describe('ResourceCatalogService', () => {
  let service: ResourceCatalogService;

  beforeEach(() => {
    service = new ResourceCatalogService();
  });

  describe('list()', () => {
    it('returns 14 catalog items', () => {
      expect(service.list()).toHaveLength(14);
    });

    it('all ids are unique', () => {
      const ids = service.list().map(i => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every item carries the required core fields', () => {
      for (const item of service.list()) {
        expect(typeof item.id).toBe('string');
        expect(item.id.length).toBeGreaterThan(0);
        expect(typeof item.category).toBe('string');
        expect(item.category.length).toBeGreaterThan(0);
        expect(typeof item.title).toBe('string');
        expect(item.title.length).toBeGreaterThan(0);
        expect(typeof item.description).toBe('string');
        expect(item.description.length).toBeGreaterThan(0);
        expect(typeof item.resourceKind).toBe('string');
        expect(item.resourceKind.length).toBeGreaterThan(0);
        expect(typeof item.sourceType).toBe('string');
        expect(item.sourceType.length).toBeGreaterThan(0);
        expect(typeof item.runtimeMode).toBe('string');
        expect(item.runtimeMode.length).toBeGreaterThan(0);
        expect(typeof item.projectType).toBe('string');
        expect(item.projectType.length).toBeGreaterThan(0);
        expect(['DEPLOYABLE', 'CONFIGURATION_ONLY']).toContain(item.availability);
      }
    });

    it.each([
      'git-public',
      'github-app',
      'deploy-key',
      'dockerfile',
      'static-site',
      'oci-image',
      'static-blog',
    ])('exactly lists %s as DEPLOYABLE', (id) => {
      const item = service.list().find(i => i.id === id);
      expect(item).toBeDefined();
      expect(item!.availability).toBe('DEPLOYABLE');
    });

    it.each([
      'compose-stack',
      'postgres',
      'mysql',
      'mariadb',
      'redis',
      'wordpress',
      'ghost',
    ])('exactly lists %s as CONFIGURATION_ONLY', (id) => {
      const item = service.list().find(i => i.id === id);
      expect(item).toBeDefined();
      expect(item!.availability).toBe('CONFIGURATION_ONLY');
    });

    it('requirements (when present) is a non-empty array of non-empty strings', () => {
      for (const item of service.list()) {
        if (item.requirements !== undefined) {
          expect(Array.isArray(item.requirements)).toBe(true);
          expect(item.requirements.length).toBeGreaterThan(0);
          for (const r of item.requirements) {
            expect(typeof r).toBe('string');
            expect(r.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it.each([
      ['github-app',    ['配置 GitHub App', '填写 Installation ID']],
      ['deploy-key',    ['SSH 仓库地址', 'Deploy Key', '仓库 Host Key']],
      ['oci-image',     ['镜像必须使用 @sha256: digest']],
      ['compose-stack', ['执行器尚未支持 Compose 清单发布']],
      ['postgres',      ['执行器尚未支持有状态资源生命周期']],
      ['static-blog',   ['配置 OCI Registry 仓库']],
      ['wordpress',     ['执行器尚未支持模板数据库初始化、备份与升级']],
      ['ghost',         ['执行器尚未支持模板数据库初始化、备份与升级']],
    ])('%s has the expected requirements list', (id, expected) => {
      const item = service.list().find(i => i.id === id);
      expect(item).toBeDefined();
      expect(item!.requirements).toEqual(expected);
    });
  });

  describe('find()', () => {
    it('returns the matching item for a known id', () => {
      const item = service.find('postgres');
      expect(item).toBeDefined();
      expect(item!.id).toBe('postgres');
      expect(item!.availability).toBe('CONFIGURATION_ONLY');
    });

    it('returns undefined for an unknown id', () => {
      expect(service.find('does-not-exist')).toBeUndefined();
    });
  });

  describe('isolation from caller-side mutation', () => {
    it('mutating the list array, an item, or nested requirements does not bleed into subsequent calls', () => {
      const first = service.list();
      const firstStaticBlog = first.find(i => i.id === 'static-blog')!;

      // Mutate the returned array
      first.pop();
      first.length = 0;
      first.push({ id: 'INJECTED' } as any);

      // Mutate an item
      firstStaticBlog.title = 'PWNED';
      firstStaticBlog.availability = 'CONFIGURATION_ONLY' as any;

      // Mutate the nested requirements array
      (firstStaticBlog.requirements as string[]).length = 0;
      (firstStaticBlog.requirements as string[]).push('INJECTED');

      // Subsequent list() must still return the original catalog
      const second = service.list();
      expect(second).toHaveLength(14);
      expect(second.find(i => i.id === 'INJECTED')).toBeUndefined();

      const secondStaticBlog = second.find(i => i.id === 'static-blog')!;
      expect(secondStaticBlog.title).not.toBe('PWNED');
      expect(secondStaticBlog.availability).toBe('DEPLOYABLE');
      expect(secondStaticBlog.requirements).toEqual(['配置 OCI Registry 仓库']);

      // find() must also return the untouched item
      const foundStaticBlog = service.find('static-blog')!;
      expect(foundStaticBlog.title).not.toBe('PWNED');
      expect(foundStaticBlog.availability).toBe('DEPLOYABLE');
      expect(foundStaticBlog.requirements).toEqual(['配置 OCI Registry 仓库']);
    });
  });
});
