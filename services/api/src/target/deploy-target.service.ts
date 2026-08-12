import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from '../environment/secret-value.service';
import { Client } from 'ssh2';

const DEFAULT_WORK_ROOT = '/var/lib/launchly';
const SAFE_WORK_ROOT = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

@Injectable()
export class DeployTargetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
  ) {}

  async listByProject(projectId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map(t => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      type: t.type,
      host: t.host,
      port: t.port,
      username: t.username,
      authMethod: t.authMethod,
      workRoot: t.workRoot,
      status: t.status,
      lastVerifiedAt: t.lastVerifiedAt?.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listAll(workspaceId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { project: { workspaceId } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map(t => ({
      id: t.id,
      projectId: t.projectId,
      projectName: t.project.name,
      name: t.name,
      type: t.type,
      host: t.host,
      port: t.port,
      username: t.username,
      authMethod: t.authMethod,
      workRoot: t.workRoot,
      status: t.status,
      lastVerifiedAt: t.lastVerifiedAt?.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async create(projectId: string, data: any) {
    if (data.authMethod !== 'KEY' || data.username === 'root' || !data.credential || !data.hostKey) {
      throw new BadRequestException('部署目标必须使用非 root 用户、SSH 密钥和固定 Host Key');
    }
    const workRoot = this.normalizeWorkRoot(data.workRoot);
    const encryptedCredential = this.secrets.encrypt(data.credential);

    const target = await this.prisma.deployTarget.create({
      data: {
        projectId,
        name: data.name,
        type: data.type || 'SSH',
        host: data.host,
        port: data.port || 22,
        username: data.username,
        authMethod: data.authMethod || 'KEY',
        encryptedCredential,
        hostKey: data.hostKey,
        workRoot,
      },
    });

    return {
      id: target.id,
      projectId: target.projectId,
      name: target.name,
      type: target.type,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      workRoot: target.workRoot,
      status: target.status,
      createdAt: target.createdAt.toISOString(),
    };
  }

  async getById(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');
    return {
      id: target.id,
      projectId: target.projectId,
      name: target.name,
      type: target.type,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      workRoot: target.workRoot,
      status: target.status,
      lastVerifiedAt: target.lastVerifiedAt?.toISOString(),
      createdAt: target.createdAt.toISOString(),
    };
  }

  async update(id: string, data: any) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.host !== undefined) updateData.host = data.host;
    if (data.port !== undefined) updateData.port = data.port;
    if (data.username !== undefined) updateData.username = data.username;
    if (data.authMethod !== undefined) updateData.authMethod = data.authMethod;
    if (data.credential !== undefined) updateData.encryptedCredential = this.secrets.encrypt(data.credential);
    if (data.hostKey !== undefined) updateData.hostKey = data.hostKey;
    if (data.workRoot !== undefined) updateData.workRoot = this.normalizeWorkRoot(data.workRoot);
    if (updateData.username === 'root' || updateData.authMethod === 'PASSWORD') {
      throw new BadRequestException('部署目标必须使用非 root 的 SSH 密钥认证');
    }

    const updated = await this.prisma.deployTarget.update({
      where: { id },
      data: updateData,
    });

    return {
      id: updated.id,
      projectId: updated.projectId,
      name: updated.name,
      type: updated.type,
      host: updated.host,
      port: updated.port,
      username: updated.username,
      authMethod: updated.authMethod,
      workRoot: updated.workRoot,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async delete(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    // Check if any deployments reference this target
    const deployCount = await this.prisma.deployment.count({
      where: { deployTargetId: id },
    });
    if (deployCount > 0) {
      throw new ForbiddenException('该部署目标已被部署记录引用，无法删除');
    }

    await this.prisma.deployTarget.delete({ where: { id } });
  }

  async verify(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found');

    if (target.authMethod !== 'KEY' || !target.hostKey) {
      return { success: false, message: '仅支持带固定 Host Key 的密钥认证' };
    }
    const expectedHostKey = target.hostKey.trim().split(/\s+/)[1];
    if (!expectedHostKey) return { success: false, message: 'Host Key 格式无效' };
    try {
      const runtime = await new Promise<{ dockerVersion: string; composeVersion: string; architecture: string; freeKb: string; httpPort: string }>((resolve, reject) => {
        const client = new Client();
        client.on('ready', () => {
          const root = this.normalizeWorkRoot(target.workRoot);
          const command = `set -eu; command -v docker >/dev/null; docker version --format '{{.Server.Version}}'; docker compose version --short; docker info --format '{{.Architecture}}'; mkdir -p '${root}'; chmod 700 '${root}'; test -w '${root}'; df -Pk '${root}' | awk 'NR == 2 { print $4 }'; if command -v ss >/dev/null 2>&1; then if ss -ltn | grep -Eq '[:.]80([[:space:]]|$)'; then echo OCCUPIED; else echo AVAILABLE; fi; else echo UNKNOWN; fi`;
          client.exec(command, (execError, stream) => {
            if (execError) { client.end(); reject(execError); return; }
            let stdout = '';
            let stderr = '';
            stream.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
            stream.on('close', (code: number | null) => {
              client.end();
              if (code !== 0) { reject(new Error(stderr.trim() || 'Docker、Docker Compose 或工作目录不可用')); return; }
              const [dockerVersion, composeVersion, architecture, freeKb, httpPort] = stdout.trim().split(/\r?\n/);
              if (!dockerVersion || !composeVersion || !architecture || !freeKb || !httpPort) { reject(new Error('目标机预检输出不完整')); return; }
              resolve({ dockerVersion, composeVersion, architecture, freeKb, httpPort });
            });
          });
        });
        client.on('error', reject);
        client.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: this.secrets.decrypt(target.encryptedCredential),
          readyTimeout: 15_000,
          hostVerifier: (key: Buffer) => key.toString('base64') === expectedHostKey,
        });
      });
      await this.prisma.deployTarget.update({ where: { id }, data: { status: 'VERIFIED', lastVerifiedAt: new Date() } });
      const portNote = runtime.httpPort === 'OCCUPIED'
        ? '；80 端口已占用，当前不能自动启用域名 Nginx 路由'
        : runtime.httpPort === 'AVAILABLE'
          ? '；80 端口可用于自动域名 Nginx 路由'
          : '；未检测到 ss，80 端口状态需在 NAS 上手动确认';
      return { success: true, message: `验证通过：Docker ${runtime.dockerVersion}，Compose ${runtime.composeVersion}，${runtime.architecture}，工作目录可写（可用 ${this.formatFreeSpace(runtime.freeKb)}）${portNote}` };
    } catch (error: any) {
      await this.prisma.deployTarget.update({ where: { id }, data: { status: 'FAILED' } });
      return { success: false, message: `SSH 验证失败: ${error?.message || '未知错误'}` };
    }
  }

  private normalizeWorkRoot(value: unknown): string {
    const root = typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : DEFAULT_WORK_ROOT;
    if (!SAFE_WORK_ROOT.test(root) || root === '/') throw new BadRequestException('工作目录必须是安全的非根目录绝对路径');
    return root;
  }

  private formatFreeSpace(value: string): string {
    const kb = Number(value);
    if (!Number.isFinite(kb) || kb < 0) return '未知空间';
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  }
}
