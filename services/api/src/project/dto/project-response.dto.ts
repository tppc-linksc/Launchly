import { Project } from '@prisma/client';

export class ProjectResponse {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  projectType: string;
  repositoryUrl: string | null;
  defaultBranch: string;
  gitProvider: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  testCommand: string | null;
  healthCheckPath: string | null;
  defaultPort: number | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  static from(p: Project): ProjectResponse {
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      name: p.name,
      description: p.description,
      projectType: p.projectType,
      repositoryUrl: p.repositoryUrl,
      defaultBranch: p.defaultBranch,
      gitProvider: p.gitProvider,
      installCommand: p.installCommand,
      buildCommand: p.buildCommand,
      startCommand: p.startCommand,
      testCommand: p.testCommand,
      healthCheckPath: p.healthCheckPath,
      defaultPort: p.defaultPort,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
