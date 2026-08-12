import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createSign } from 'crypto';

type CachedToken = { token: string; expiresAt: number };

@Injectable()
export class GithubAppService {
  private readonly tokenCache = new Map<string, CachedToken>();

  isConfigured(): boolean {
    return Boolean(process.env.LAUNCHLY_GITHUB_APP_ID && (process.env.LAUNCHLY_GITHUB_APP_PRIVATE_KEY || process.env.LAUNCHLY_GITHUB_APP_PRIVATE_KEY_BASE64));
  }

  async commitChecksPassed(installationId: string, repositoryUrl: string, sha: string): Promise<boolean> {
    const match = this.repositoryCoordinates(repositoryUrl);
    if (!match) return false;
    const token = await this.installationToken(installationId);
    const response = await fetch(`https://api.github.com/repos/${match.owner}/${match.repository}/commits/${sha}/check-runs`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) return false;
    const payload = await response.json() as { total_count?: number; check_runs?: Array<{ status: string; conclusion: string | null }> };
    if (!payload.total_count || !payload.check_runs?.length) return false;
    return payload.check_runs.every(check => check.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion || ''));
  }

  /** Short-lived installation token for a worker checkout. Never persist or log it. */
  async installationToken(installationId: string): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (!this.isConfigured()) throw new ServiceUnavailableException('GitHub App credentials are not configured');
    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.appJwt()}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new ServiceUnavailableException('Unable to obtain GitHub installation token');
    const payload = await response.json() as { token: string; expires_at: string };
    this.tokenCache.set(installationId, { token: payload.token, expiresAt: new Date(payload.expires_at).getTime() });
    return payload.token;
  }

  private appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: 'RS256', typ: 'JWT' });
    const body = this.encode({ iat: now - 60, exp: now + 9 * 60, iss: process.env.LAUNCHLY_GITHUB_APP_ID });
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${body}`);
    signer.end();
    const source = process.env.LAUNCHLY_GITHUB_APP_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.LAUNCHLY_GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
      : String(process.env.LAUNCHLY_GITHUB_APP_PRIVATE_KEY).replace(/\\n/g, '\n');
    return `${header}.${body}.${signer.sign(source, 'base64url')}`;
  }

  private encode(value: object): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
  private repositoryCoordinates(value: string): { owner: string; repository: string } | null {
    const match = value.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    return match ? { owner: match[1], repository: match[2] } : null;
  }
}
