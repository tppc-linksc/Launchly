const SCP_STYLE = /^([A-Za-z_][A-Za-z0-9._-]*)@([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?):([^\s]+)$/;
const SAFE_PATH = /^[A-Za-z0-9._~!$&'()+,;=:@/-]+$/;

function hasUnsafePathSegment(pathname: string): boolean {
  return pathname.split('/').some(segment => segment === '.' || segment === '..');
}
/**
 * Accept only repository transports that Git can use without invoking a remote
 * helper chosen by untrusted input. In particular this rejects ext::, file:,
 * local paths, option-looking values, URL credentials, queries and fragments.
 */
export function isSafeGitRepositoryUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.trim() !== value) return false;
  if (/[/\\\0\r\n\t ]/.test(value[0]) || value.startsWith('-')) return false;

  const scp = SCP_STYLE.exec(value);
  if (scp) {
    const repositoryPath = scp[3];
    return SAFE_PATH.test(repositoryPath) && !repositoryPath.startsWith('-') && !hasUnsafePathSegment(repositoryPath);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:') return false;
  if (!url.hostname || url.password || url.search || url.hash) return false;
  if (url.protocol === 'https:' && url.username) return false;
  if (url.protocol === 'ssh:' && !url.username) return false;
  if (!url.pathname || url.pathname === '/' || !SAFE_PATH.test(url.pathname) || hasUnsafePathSegment(url.pathname)) return false;
  return true;
}

export function isSafeGitReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) return false;
  return !value.includes('..') && !value.includes('//') && !value.includes('@{') && !value.endsWith('.lock');
}
