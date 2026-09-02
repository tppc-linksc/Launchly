import { BUILD_ROOT, buildContextDir } from './build-context';

describe('buildContextDir', () => {
  it('maps all source/build stages to one task-isolated directory', () => {
    expect(buildContextDir('deploy-123')).toBe(`${BUILD_ROOT}/deploy-123`);
  });

  it.each(['../escape', '/absolute', 'with space', 'bad\nline', ''])(
    'rejects unsafe refId %j before joining a filesystem path',
    (refId) => {
      expect(() => buildContextDir(refId)).toThrow(/refId/);
    },
  );
});
