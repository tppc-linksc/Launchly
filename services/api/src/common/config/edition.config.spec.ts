import { EditionConfig } from './edition.config';

const ENV_KEY = 'LAUNCHLY_EDITION';

describe('EditionConfig', () => {
  const ORIGINAL_EDITION = process.env[ENV_KEY];

  afterEach(() => {
    if (ORIGINAL_EDITION === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = ORIGINAL_EDITION;
    }
  });

  function freshInstance(): EditionConfig {
    return new EditionConfig();
  }

  it('defaults to selfhost when LAUNCHLY_EDITION is not set', () => {
    delete process.env[ENV_KEY];

    const cfg = freshInstance();

    expect(cfg.getEdition()).toBe('selfhost');
    expect(cfg.isSelfHost()).toBe(true);
    expect(cfg.isCloud()).toBe(false);
  });

  it('reads an explicit selfhost value', () => {
    process.env[ENV_KEY] = 'selfhost';

    const cfg = freshInstance();

    expect(cfg.getEdition()).toBe('selfhost');
    expect(cfg.isSelfHost()).toBe(true);
    expect(cfg.isCloud()).toBe(false);
  });

  it('reads cloud and flips the booleans', () => {
    process.env[ENV_KEY] = 'cloud';

    const cfg = freshInstance();

    expect(cfg.getEdition()).toBe('cloud');
    expect(cfg.isCloud()).toBe(true);
    expect(cfg.isSelfHost()).toBe(false);
  });

  it('does not leak LAUNCHLY_EDITION changes between tests (isolated re-instantiation)', () => {
    // First instance picks up the current env value, whatever it is.
    process.env[ENV_KEY] = 'cloud';
    const cloudCfg = freshInstance();
    expect(cloudCfg.getEdition()).toBe('cloud');

    // Now wipe the env and re-instantiate — old instance must NOT magically flip
    delete process.env[ENV_KEY];
    const defaultCfg = freshInstance();
    expect(defaultCfg.getEdition()).toBe('selfhost');
    expect(defaultCfg.isCloud()).toBe(false);
    expect(defaultCfg.isSelfHost()).toBe(true);

    // The original cloud instance is frozen at construction time
    expect(cloudCfg.getEdition()).toBe('cloud');
    expect(cloudCfg.isCloud()).toBe(true);
  });
});
