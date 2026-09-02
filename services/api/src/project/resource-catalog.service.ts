import { Injectable } from '@nestjs/common';

export type ResourceCatalogItem = {
  id: string;
  category: 'APPLICATION' | 'DATABASE' | 'CACHE' | 'TEMPLATE';
  title: string;
  description: string;
  resourceKind: string;
  sourceType: string;
  runtimeMode: string;
  projectType: string;
  templateId?: string;
  availability: 'DEPLOYABLE' | 'CONFIGURATION_ONLY';
  requirements?: string[];
};

/**
 * Product catalog, deliberately separate from the deployment runners.  A card is
 * only marked DEPLOYABLE when the current worker can actually execute it.
 */
@Injectable()
export class ResourceCatalogService {
  list(): ResourceCatalogItem[] {
    return [
      {
        id: 'git-public',
        category: 'APPLICATION',
        title: '公开 Git 仓库',
        description: '从 GitHub、GitLab 或任意公开 Git 地址构建不可变 OCI 镜像。',
        resourceKind: 'APPLICATION',
        sourceType: 'GIT_PUBLIC',
        runtimeMode: 'BUILDKIT',
        projectType: 'CUSTOM',
        availability: 'DEPLOYABLE',
      },
      {
        id: 'github-app',
        category: 'APPLICATION',
        title: 'GitHub App 私有仓库',
        description: '使用 GitHub App 安装令牌检出私有仓库，并可接收已验证的 webhook。',
        resourceKind: 'APPLICATION',
        sourceType: 'GITHUB_APP',
        runtimeMode: 'BUILDKIT',
        projectType: 'CUSTOM',
        availability: 'DEPLOYABLE',
        requirements: ['配置 GitHub App', '填写 Installation ID'],
      },
      {
        id: 'deploy-key',
        category: 'APPLICATION',
        title: 'Deploy Key 私有仓库',
        description: '使用项目专属 SSH Deploy Key 和固定的仓库 Host Key 检出代码。',
        resourceKind: 'APPLICATION',
        sourceType: 'DEPLOY_KEY',
        runtimeMode: 'BUILDKIT',
        projectType: 'CUSTOM',
        availability: 'DEPLOYABLE',
        requirements: ['SSH 仓库地址', 'Deploy Key', '仓库 Host Key'],
      },
      {
        id: 'dockerfile',
        category: 'APPLICATION',
        title: 'Dockerfile 应用',
        description: '从 Git 源码中的 Dockerfile 使用隔离 BuildKit 构建。',
        resourceKind: 'APPLICATION',
        sourceType: 'GIT_PUBLIC',
        runtimeMode: 'BUILDKIT',
        projectType: 'DOCKERFILE',
        availability: 'DEPLOYABLE',
      },
      {
        id: 'static-site',
        category: 'APPLICATION',
        title: '静态站点',
        description: '从 Git 构建静态站点；可为 Vue、React、Hugo 等配置构建和启动命令。',
        resourceKind: 'STATIC_SITE',
        sourceType: 'GIT_PUBLIC',
        runtimeMode: 'BUILDKIT',
        projectType: 'STATIC_SITE',
        availability: 'DEPLOYABLE',
      },
      {
        id: 'oci-image',
        category: 'APPLICATION',
        title: '现有 OCI 镜像',
        description: '直接拉取指定不可变 digest 的 GHCR、Docker Hub 或私有 Registry 镜像。',
        resourceKind: 'APPLICATION',
        sourceType: 'OCI_IMAGE',
        runtimeMode: 'OCI_IMAGE',
        projectType: 'OCI_IMAGE',
        availability: 'DEPLOYABLE',
        requirements: ['镜像必须使用 @sha256: digest'],
      },
      {
        id: 'compose-stack',
        category: 'APPLICATION',
        title: 'Docker Compose / 多服务栈',
        description: '为 API、Worker、数据库等协同服务保存拓扑与 Compose 配置。',
        resourceKind: 'STACK',
        sourceType: 'COMPOSE',
        runtimeMode: 'COMPOSE',
        projectType: 'DOCKER_COMPOSE',
        availability: 'CONFIGURATION_ONLY',
        requirements: ['执行器尚未支持 Compose 清单发布'],
      },
      {
        id: 'postgres',
        category: 'DATABASE',
        title: 'PostgreSQL',
        description: '独立、持久化的 PostgreSQL 数据库资源。',
        resourceKind: 'DATABASE',
        sourceType: 'CATALOG_IMAGE',
        runtimeMode: 'DATABASE',
        projectType: 'POSTGRESQL',
        availability: 'CONFIGURATION_ONLY',
        requirements: ['执行器尚未支持有状态资源生命周期'],
      },
      {
        id: 'mysql',
        category: 'DATABASE',
        title: 'MySQL',
        description: '独立、持久化的 MySQL 数据库资源。',
        resourceKind: 'DATABASE',
        sourceType: 'CATALOG_IMAGE',
        runtimeMode: 'DATABASE',
        projectType: 'MYSQL',
        availability: 'CONFIGURATION_ONLY',
      },
      {
        id: 'mariadb',
        category: 'DATABASE',
        title: 'MariaDB',
        description: '独立、持久化的 MariaDB 数据库资源。',
        resourceKind: 'DATABASE',
        sourceType: 'CATALOG_IMAGE',
        runtimeMode: 'DATABASE',
        projectType: 'MARIADB',
        availability: 'CONFIGURATION_ONLY',
      },
      {
        id: 'redis',
        category: 'CACHE',
        title: 'Redis',
        description: '独立的 Redis 缓存或队列资源。',
        resourceKind: 'CACHE',
        sourceType: 'CATALOG_IMAGE',
        runtimeMode: 'DATABASE',
        projectType: 'REDIS',
        availability: 'CONFIGURATION_ONLY',
      },
      {
        id: 'static-blog',
        category: 'TEMPLATE',
        title: '静态博客',
        description: '无需 Git 的单页静态博客，使用 BuildKit 构建并以不可变 OCI 镜像部署。',
        resourceKind: 'TEMPLATE',
        sourceType: 'TEMPLATE',
        runtimeMode: 'BUILDKIT',
        projectType: 'STATIC_SITE',
        templateId: 'static-blog',
        availability: 'DEPLOYABLE',
        requirements: ['配置 OCI Registry 仓库'],
      },
      {
        id: 'wordpress',
        category: 'TEMPLATE',
        title: 'WordPress 博客',
        description: 'WordPress 与 MariaDB 的一键博客拓扑。',
        resourceKind: 'TEMPLATE',
        sourceType: 'TEMPLATE',
        runtimeMode: 'COMPOSE',
        projectType: 'WORDPRESS',
        templateId: 'wordpress-mariadb',
        availability: 'CONFIGURATION_ONLY',
        requirements: ['执行器尚未支持模板数据库初始化、备份与升级'],
      },
      {
        id: 'ghost',
        category: 'TEMPLATE',
        title: 'Ghost 博客',
        description: 'Ghost 与 MySQL 的一键博客拓扑。',
        resourceKind: 'TEMPLATE',
        sourceType: 'TEMPLATE',
        runtimeMode: 'COMPOSE',
        projectType: 'GHOST',
        templateId: 'ghost-mysql',
        availability: 'CONFIGURATION_ONLY',
        requirements: ['执行器尚未支持模板数据库初始化、备份与升级'],
      },
    ];
  }

  find(id: string) {
    return this.list().find((item) => item.id === id);
  }
}
