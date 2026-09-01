import { isGithubInstallationBoundToWorkspace } from './github-installation-binding';

describe('isGithubInstallationBoundToWorkspace', () => {
  it('accepts only an exact operator-owned installation/workspace mapping', () => {
    const bindings = JSON.stringify({ '123456': 'workspace-a' });
    expect(isGithubInstallationBoundToWorkspace('123456', 'workspace-a', bindings)).toBe(true);
    expect(isGithubInstallationBoundToWorkspace('123456', 'workspace-b', bindings)).toBe(false);
    expect(isGithubInstallationBoundToWorkspace('654321', 'workspace-a', bindings)).toBe(false);
  });

  it('fails closed for absent, malformed, array, and oversized configuration', () => {
    expect(isGithubInstallationBoundToWorkspace('123', 'workspace-a', undefined)).toBe(false);
    expect(isGithubInstallationBoundToWorkspace('123', 'workspace-a', '{bad json')).toBe(false);
    expect(isGithubInstallationBoundToWorkspace('123', 'workspace-a', '["workspace-a"]')).toBe(false);
    expect(isGithubInstallationBoundToWorkspace('123', 'workspace-a', 'x'.repeat(64 * 1024 + 1))).toBe(false);
  });
});
