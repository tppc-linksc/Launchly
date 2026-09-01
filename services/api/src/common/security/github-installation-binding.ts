/**
 * GitHub App installations are security principals, not ordinary project input.
 * The self-hosted MVP requires an operator-owned mapping so a workspace cannot
 * claim another tenant's installation merely by guessing its numeric ID.
 */
export function isGithubInstallationBoundToWorkspace(
  installationId: unknown,
  workspaceId: unknown,
  rawBindings = process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS,
): boolean {
  if (typeof installationId !== 'string' || !installationId) return false;
  if (typeof workspaceId !== 'string' || !workspaceId) return false;
  if (!rawBindings || Buffer.byteLength(rawBindings, 'utf8') > 64 * 1024) return false;
  try {
    const parsed = JSON.parse(rawBindings);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>)[installationId] === workspaceId);
  } catch {
    return false;
  }
}
