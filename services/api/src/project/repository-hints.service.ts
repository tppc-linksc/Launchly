import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RepositoryHintsResponse } from './dto';

type PackageManager = 'NPM' | 'PNPM' | 'YARN';

const GITHUB_HTTPS = /https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const GITHUB_SSH = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?/i;
const GITLAB_HTTPS = /https?:\/\/gitlab\.com\/(.+?)(?:\.git)?\/?$/i;
const GITEE_HTTPS = /https?:\/\/gitee\.com\/(.+?)(?:\.git)?\/?$/i;
const PORT_IN_SCRIPT = /(?:--port|-p)\s+(\d{2,5})\b|\bPORT\s*=\s*(\d{2,5})\b/;
const README_INSTALL_LINE = /^\s*((?:npm|pnpm|yarn)\s+\S+(?:\s+\S+)*)\s*$/;

@Injectable()
export class RepositoryHintsService {
  private readonly logger = new Logger(RepositoryHintsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Merge inferred values into project fields that are still blank.
   */
  async fillBlanksFromRepository(project: {
    repositoryUrl?: string | null;
    defaultBranch?: string;
    installCommand?: string | null;
    buildCommand?: string | null;
    startCommand?: string | null;
    testCommand?: string | null;
    defaultPort?: number | null;
    healthCheckPath?: string | null;
  }): Promise<void> {
    if (!project.repositoryUrl) return;
    const branch = project.defaultBranch || 'main';
    const hints = await this.infer(project.repositoryUrl.trim(), branch);
    if (!hints) return;
    if (!project.installCommand && hints.installCommand) project.installCommand = hints.installCommand;
    if (!project.buildCommand && hints.buildCommand) project.buildCommand = hints.buildCommand;
    if (!project.startCommand && hints.startCommand) project.startCommand = hints.startCommand;
    if (!project.testCommand && hints.testCommand) project.testCommand = hints.testCommand;
    if (project.defaultPort == null && hints.defaultPort != null) project.defaultPort = hints.defaultPort;
    if (!project.healthCheckPath && hints.healthCheckPath) project.healthCheckPath = hints.healthCheckPath;
  }

  async infer(repositoryUrl: string, branch: string): Promise<RepositoryHintsResponse | null> {
    if (!repositoryUrl || !branch) return null;
    const refEnc = branch.replace(/\//g, '%2F');
    const pkgUrl = this.rawPackageJsonUrl(repositoryUrl, refEnc);
    if (!pkgUrl) return null;

    const jsonBody = await this.httpGetString(pkgUrl);
    if (!jsonBody) return null;

    try {
      const root = JSON.parse(jsonBody);
      const pm = await this.detectPackageManager(root, repositoryUrl, refEnc);
      const scripts = root.scripts || {};
      const startScript: string | undefined = scripts.start;
      const buildScript: string | undefined = scripts.build;
      const testScript: string | undefined = scripts.test;

      let install = this.installCommand(pm);
      const build = buildScript ? this.runScript(pm, 'build') : null;
      const start = this.startCommand(pm);
      const test = testScript ? this.runScript(pm, 'test') : null;
      let port = this.parsePortFromStart(startScript) ?? 3000;

      let source = 'package.json';
      const readmeLine = await this.readmeInstallLine(repositoryUrl, refEnc);
      if (readmeLine && pm === 'NPM' && (readmeLine.includes('pnpm') || readmeLine.includes('yarn'))) {
        install = readmeLine;
        source = 'package.json+readme';
      }

      return { installCommand: install, buildCommand: build, startCommand: start, testCommand: test, defaultPort: port, healthCheckPath: null, source };
    } catch {
      return null;
    }
  }

  private async readmeInstallLine(repositoryUrl: string, refEnc: string): Promise<string | null> {
    const readmeUrl = this.rawReadmeUrl(repositoryUrl, refEnc);
    if (!readmeUrl) return null;
    const body = await this.httpGetString(readmeUrl);
    if (!body) return null;
    for (const line of body.split('\n')) {
      const m = line.match(README_INSTALL_LINE);
      if (m) return m[1].trim();
    }
    return null;
  }

  private rawReadmeUrl(repositoryUrl: string, refEnc: string): string | null {
    let m = GITHUB_HTTPS.exec(repositoryUrl);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${refEnc}/README.md`;
    m = GITHUB_SSH.exec(repositoryUrl);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${refEnc}/README.md`;
    m = GITLAB_HTTPS.exec(repositoryUrl);
    if (m) return `https://gitlab.com/${m[1]}/-/raw/${refEnc}/README.md`;
    m = GITEE_HTTPS.exec(repositoryUrl);
    if (m) return `https://gitee.com/${m[1]}/raw/${refEnc}/README.md`;
    return null;
  }

  private rawPackageJsonUrl(repositoryUrl: string, refEnc: string): string | null {
    let m = GITHUB_HTTPS.exec(repositoryUrl);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${refEnc}/package.json`;
    m = GITHUB_SSH.exec(repositoryUrl);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${refEnc}/package.json`;
    m = GITLAB_HTTPS.exec(repositoryUrl);
    if (m) return `https://gitlab.com/${m[1]}/-/raw/${refEnc}/package.json`;
    m = GITEE_HTTPS.exec(repositoryUrl);
    if (m) return `https://gitee.com/${m[1]}/raw/${refEnc}/package.json`;
    return null;
  }

  private async detectPackageManager(root: any, repositoryUrl: string, refEnc: string): Promise<PackageManager> {
    const pmField: string | undefined = root.packageManager;
    if (pmField) {
      if (pmField.startsWith('pnpm')) return 'PNPM';
      if (pmField.startsWith('yarn')) return 'YARN';
    }
    const base = this.rawPackageJsonUrl(repositoryUrl, refEnc);
    if (base) {
      const slash = base.lastIndexOf('/');
      const prefix = base.substring(0, slash + 1);
      if (await this.resourceExists(prefix + 'pnpm-lock.yaml')) return 'PNPM';
      if (await this.resourceExists(prefix + 'yarn.lock')) return 'YARN';
    }
    return 'NPM';
  }

  private async resourceExists(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      if (res.ok) return true;
      if (res.status === 405 || res.status === 404) {
        const body = await this.httpGetString(url);
        return !!body && body.trim().length > 0;
      }
    } catch {
      const body = await this.httpGetString(url);
      return !!body && body.trim().length > 0;
    }
    return false;
  }

  private installCommand(pm: PackageManager): string {
    switch (pm) {
      case 'PNPM': return 'corepack enable && pnpm install --frozen-lockfile';
      case 'YARN': return 'corepack enable && yarn install --immutable';
      case 'NPM': return 'npm ci --omit=dev || npm install --omit=dev';
    }
  }

  private runScript(pm: PackageManager, script: string): string {
    switch (pm) {
      case 'PNPM': return `pnpm run ${script}`;
      case 'YARN': return `yarn ${script}`;
      case 'NPM': return `npm run ${script}`;
    }
  }

  private startCommand(pm: PackageManager): string {
    switch (pm) {
      case 'PNPM': return 'pnpm start';
      case 'YARN': return 'yarn start';
      case 'NPM': return 'npm start';
    }
  }

  private parsePortFromStart(startScript?: string): number | null {
    if (!startScript) return null;
    const m = startScript.match(PORT_IN_SCRIPT);
    if (m) {
      const g = m[1] ?? m[2];
      const n = parseInt(g, 10);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  private async httpGetString(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Launchly-RepositoryHints/1.0' },
      });
      if (res.ok) {
        const body = await res.text();
        if (body.length > 2_000_000) return null;
        return body;
      }
    } catch {
      return null;
    }
    return null;
  }
}
