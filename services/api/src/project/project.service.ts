import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { SecretValueService } from '../environment/secret-value.service';
import { ResourceCatalogService } from './resource-catalog.service';

const DEPLOYABLE_SOURCES = new Set(['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY', 'OCI_IMAGE']);
const GIT_SOURCES = new Set(['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY']);

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
    private readonly catalog: ResourceCatalogService,
  ) {}

  async create(dto: CreateProjectDto, workspaceId: string, userId: string) {
    const resource = this.normalizeResource(dto);
    const repositoryCredential = this.prepareRepositoryCredential(dto, resource.sourceType);
    const bootstrapAdmin = this.prepareBootstrapAdmin(dto, true);
    const project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description,
          projectType: resource.projectType,
          resourceKind: resource.resourceKind,
          sourceType: resource.sourceType,
          runtimeMode: resource.runtimeMode,
          templateId: resource.templateId,
          imageReference: resource.imageReference,
          resourceConfig: resource.resourceConfig as any,
          repositoryUrl: dto.repositoryUrl,
          defaultBranch: dto.defaultBranch || 'main',
          gitProvider: dto.gitProvider,
          githubInstallationId: dto.githubInstallationId,
          registryRepository: dto.registryRepository,
          installCommand: dto.installCommand,
          buildCommand: dto.buildCommand,
          startCommand: dto.startCommand,
          testCommand: dto.testCommand,
          healthCheckPath: dto.healthCheckPath,
          defaultPort: dto.defaultPort,
          bootstrapAdminEnabled: bootstrapAdmin?.enabled || false,
          bootstrapAdminCommand: bootstrapAdmin?.command || null,
          bootstrapAdminUsername: bootstrapAdmin?.username || null,
          bootstrapAdminEmail: bootstrapAdmin?.email || null,
          createdBy: userId,
        },
      });

      if (repositoryCredential) {
        await tx.repositoryCredential.create({
          data: { projectId: p.id, ...repositoryCredential },
        });
      }
      if (bootstrapAdmin?.encryptedPassword) {
        await tx.projectBootstrapSecret.create({
          data: { projectId: p.id, encryptedPassword: bootstrapAdmin.encryptedPassword, maskedPreview: bootstrapAdmin.maskedPreview },
        });
      }

      // Create default environments
      await tx.environment.createMany({
        data: [
          { projectId: p.id, name: '测试环境', type: 'TEST', externalPort: 3001, deployMode: 'local' },
          { projectId: p.id, name: '预发环境', type: 'STAGING', externalPort: 3002, deployMode: 'local' },
          { projectId: p.id, name: '生产环境', type: 'PRODUCTION', externalPort: 3003, deployMode: 'local' },
        ],
      });

      // Create default component
      await tx.component.create({
        data: {
          projectId: p.id,
          name: dto.name,
          isDefault: true,
        },
      });
      await tx.projectMember.create({ data: { projectId: p.id, userId, role: 'OWNER' } });

      return p;
    });

    return project;
  }

  async listByWorkspace(workspaceId: string, userId?: string) {
    const workspaceMember = userId ? await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } }) : null;
    return this.prisma.project.findMany({
      where: workspaceMember?.role === 'OWNER' || !userId
        ? { workspaceId }
        : { workspaceId, members: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, workspaceId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('项目不存在');
    }
    return project;
  }

  async update(id: string, dto: CreateProjectDto, workspaceId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('项目不存在');
    }

    const resource = this.normalizeResource(dto, project);
    const repositoryCredential = this.prepareRepositoryCredential(dto, resource.sourceType);
    const bootstrapAdmin = this.prepareBootstrapAdmin(dto, false);
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.projectType !== undefined && { projectType: resource.projectType }),
        ...(dto.resourceKind !== undefined && { resourceKind: resource.resourceKind }),
        ...(dto.sourceType !== undefined && { sourceType: resource.sourceType }),
        ...(dto.runtimeMode !== undefined && { runtimeMode: resource.runtimeMode }),
        ...(dto.templateId !== undefined && { templateId: resource.templateId }),
        ...(dto.imageReference !== undefined && { imageReference: resource.imageReference }),
        ...(dto.resourceConfig !== undefined && { resourceConfig: resource.resourceConfig as any }),
        ...(dto.repositoryUrl !== undefined && { repositoryUrl: dto.repositoryUrl }),
        ...(dto.defaultBranch !== undefined && { defaultBranch: dto.defaultBranch }),
        ...(dto.gitProvider !== undefined && { gitProvider: dto.gitProvider }),
        ...(dto.githubInstallationId !== undefined && { githubInstallationId: dto.githubInstallationId }),
        ...(dto.registryRepository !== undefined && { registryRepository: dto.registryRepository }),
        ...(dto.installCommand !== undefined && { installCommand: dto.installCommand }),
        ...(dto.buildCommand !== undefined && { buildCommand: dto.buildCommand }),
        ...(dto.startCommand !== undefined && { startCommand: dto.startCommand }),
        ...(dto.testCommand !== undefined && { testCommand: dto.testCommand }),
        ...(dto.healthCheckPath !== undefined && { healthCheckPath: dto.healthCheckPath }),
        ...(dto.defaultPort !== undefined && { defaultPort: dto.defaultPort }),
        ...(bootstrapAdmin && {
          bootstrapAdminEnabled: bootstrapAdmin.enabled,
          bootstrapAdminCommand: bootstrapAdmin.command,
          bootstrapAdminUsername: bootstrapAdmin.username,
          bootstrapAdminEmail: bootstrapAdmin.email,
        }),
      },
    });
    if (repositoryCredential) {
      await this.prisma.repositoryCredential.upsert({
        where: { projectId: id },
        create: { projectId: id, ...repositoryCredential },
        update: repositoryCredential,
      });
    }
    if (bootstrapAdmin?.encryptedPassword) {
      await this.prisma.projectBootstrapSecret.upsert({
        where: { projectId: id },
        create: { projectId: id, encryptedPassword: bootstrapAdmin.encryptedPassword, maskedPreview: bootstrapAdmin.maskedPreview },
        update: { encryptedPassword: bootstrapAdmin.encryptedPassword, maskedPreview: bootstrapAdmin.maskedPreview },
      });
    }
    return updated;
  }

  private normalizeResource(dto: CreateProjectDto, existing?: any) {
    const sourceType = dto.sourceType || existing?.sourceType || 'GIT_PUBLIC';
    const resourceKind = dto.resourceKind || existing?.resourceKind || 'APPLICATION';
    const runtimeMode = dto.runtimeMode || existing?.runtimeMode || 'BUILDKIT';
    const projectType = dto.projectType || existing?.projectType || 'CUSTOM';
    const templateId = dto.templateId ?? existing?.templateId ?? undefined;
    const imageReference = dto.imageReference ?? existing?.imageReference ?? undefined;
    const resourceConfig = dto.resourceConfig ?? existing?.resourceConfig ?? undefined;

    if (!['APPLICATION', 'STATIC_SITE', 'STACK', 'DATABASE', 'CACHE', 'TEMPLATE'].includes(resourceKind)) {
      throw new BadRequestException('不支持的资源类型');
    }
    if (!['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY', 'OCI_IMAGE', 'COMPOSE', 'CATALOG_IMAGE', 'TEMPLATE'].includes(sourceType)) {
      throw new BadRequestException('不支持的来源类型');
    }
    if (!['BUILDKIT', 'OCI_IMAGE', 'COMPOSE', 'DATABASE'].includes(runtimeMode)) {
      throw new BadRequestException('不支持的运行模式');
    }
    if (GIT_SOURCES.has(sourceType) && !(dto.repositoryUrl ?? existing?.repositoryUrl)) {
      throw new BadRequestException('Git 来源必须配置仓库地址');
    }
    if (sourceType === 'OCI_IMAGE' && !this.isImmutableImage(imageReference)) {
      throw new BadRequestException('OCI 镜像必须使用完整的 @sha256: digest 引用');
    }
    if (sourceType === 'TEMPLATE' && !templateId) {
      throw new BadRequestException('模板资源必须指定模板 ID');
    }
    if (!DEPLOYABLE_SOURCES.has(sourceType) && !this.catalog.list().some(item => item.sourceType === sourceType)) {
      throw new BadRequestException('来源未在资源目录中注册');
    }
    return { sourceType, resourceKind, runtimeMode, projectType, templateId, imageReference, resourceConfig };
  }

  private prepareRepositoryCredential(dto: CreateProjectDto, sourceType: string) {
    if (!dto.repositoryCredential) return null;
    if (sourceType !== 'DEPLOY_KEY') throw new BadRequestException('仅 Deploy Key 来源可以保存仓库私钥');
    const { privateKey, hostKey } = dto.repositoryCredential;
    if (!privateKey.includes('PRIVATE KEY') || !/^(?:ssh-|ecdsa-|sk-)\S+\s+\S+/.test(hostKey.trim())) {
      throw new BadRequestException('Deploy Key 或仓库 Host Key 格式无效');
    }
    return {
      credentialType: 'DEPLOY_KEY',
      encryptedValue: this.secrets.encrypt(privateKey),
      maskedPreview: this.secrets.mask(privateKey),
      hostKey: hostKey.trim(),
    };
  }

  private prepareBootstrapAdmin(dto: CreateProjectDto, isCreate: boolean) {
    if (!dto.bootstrapAdmin) return null;
    const input = dto.bootstrapAdmin;
    if (!input.enabled) return { enabled: false, command: null, username: null, email: null };
    const command = input.command?.trim();
    const username = input.username?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;
    if (!command || command.length > 500 || /[\r\n\0]/.test(command)) {
      throw new BadRequestException('初始化管理员命令不能为空，且只能是一行容器内命令');
    }
    if (!username && !email) throw new BadRequestException('至少填写管理员账号或邮箱');
    if (isCreate && !input.password) throw new BadRequestException('首次启用初始化管理员必须设置密码');
    const encryptedPassword = input.password ? this.secrets.encrypt(input.password) : undefined;
    return {
      enabled: true,
      command,
      username,
      email,
      encryptedPassword,
      maskedPreview: input.password ? this.secrets.mask(input.password) : undefined,
    };
  }

  private isImmutableImage(value?: string): boolean {
    return Boolean(value && /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/i.test(value));
  }
}
