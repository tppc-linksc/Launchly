export class RepositoryHintsResponse {
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  testCommand: string | null;
  defaultPort: number | null;
  healthCheckPath: string | null;
  source: string;

  static defaults(): RepositoryHintsResponse {
    return {
      installCommand: 'npm ci --omit=dev || npm install --omit=dev',
      buildCommand: null,
      startCommand: 'npm start',
      testCommand: null,
      defaultPort: 3000,
      healthCheckPath: null,
      source: 'defaults',
    };
  }
}
