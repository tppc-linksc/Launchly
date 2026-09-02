import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { composeTemplate } from '../config.js';

const repositoryCompose = fs.readFileSync(path.resolve(process.cwd(), '../deploy/compose/docker-compose.yml'), 'utf-8');

const expectedServices = [
  'launchly-postgres',
  'launchly-migrate',
  'launchly-api',
  'launchly-worker',
  'launchly-buildkit',
];

function serviceNames(compose: string): string[] {
  const section = compose.split(/^services:\s*$/m)[1]?.split(/^networks:\s*$/m)[0] ?? '';
  return [...section.matchAll(/^  ([a-z0-9-]+):\s*$/gm)].map((match) => match[1]);
}

describe('CLI and repository Compose topology', () => {
  it('uses the same fixed project and service names', () => {
    expect(composeTemplate()).toMatch(/^name: launchly$/m);
    expect(repositoryCompose).toMatch(/^name: launchly$/m);
    expect(serviceNames(composeTemplate())).toEqual(expectedServices);
    expect(serviceNames(repositoryCompose)).toEqual(expectedServices);
  });

  it('uses the same persistent volume names', () => {
    for (const volume of ['launchly-postgres-data', 'launchly-data', 'launchly-worker-data']) {
      expect(composeTemplate()).toContain(`${volume}:`);
      expect(repositoryCompose).toContain(`${volume}:`);
    }
  });

  it('keeps BuildKit isolated and exposes worker liveness in both variants', () => {
    for (const compose of [composeTemplate(), repositoryCompose]) {
      expect(compose).toContain('launchly-builder-net:');
      expect(compose).toContain('internal: true');
      expect(compose).toContain('LAUNCHLY_WORKER_HEALTH_FILE: /tmp/launchly-worker-heartbeat');
      expect(compose).toContain('healthcheck:');
    }
  });
});
