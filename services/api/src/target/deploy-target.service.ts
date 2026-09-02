import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from '../environment/secret-value.service';
import { Client } from 'ssh2';
import { canonicalSshHostKey, parseSshHostKey } from '../common/security/ssh-host-key';

/**
 * 部署目标 Service（KI-023 / KI-024 / R0-08 / R1-02）。
 *
 * 关键约束：
 * - 仅允许 KEY 认证、非 root 用户、合法 Host Key、合法 workRoot。
 * - create/update 都做"合并后校验"，防止遗留/部分更新到不安全状态。
 * - verify() 在 ready/error/exec 异常路径上保证 Client 只关闭一次、
 *   Promise 一定 settle，不会因 ready 回调内同步抛错而悬挂。
 */

const DEFAULT_WORK_ROOT = '/var/lib/launchly';
const SAFE_WORK_ROOT = /^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
/** host：字母数字 + . + -，或 IPv6 字面量。 */
const SAFE_HOST =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|\[(?:[0-9a-fA-F:]+\])|(?:\d{1,3}\.){3}\d{1,3})$/;
/** SSH 用户：必须以字母或下划线开头，长度 1-32。 */
const SAFE_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
/** name：字母/数字/点/下划线/连字符/空格，1-255。 */
const SAFE_NAME = /^[A-Za-z0-9._ -]{1,255}$/;
/** port：1-65535 整数。 */
const SAFE_PORT_RANGE = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;
export interface TargetView {
  id: string;
  projectId: string;
  name: string;
  type: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  workRoot: string;
  status: string;
  lastVerifiedAt?: string;
  createdAt: string;
}

interface RawDeployTarget {
  id: string;
  projectId: string;
  name: string;
  type: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  encryptedCredential: string;
  hostKey: string | null;
  workRoot: string;
  status: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

function viewOf(t: RawDeployTarget): TargetView {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    type: t.type,
    host: t.host,
    port: t.port,
    username: t.username,
    authMethod: t.authMethod,
    workRoot: t.workRoot,
    status: t.status ?? 'PENDING',
    lastVerifiedAt: t.lastVerifiedAt?.toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class DeployTargetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretValueService,
  ) {}

  async listByProject(projectId: string): Promise<TargetView[]> {
    const targets = await this.prisma.deployTarget.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map((t) => viewOf(t));
  }

  async listAll(workspaceId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { project: { workspaceId } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map((t) => ({ ...viewOf(t), projectName: (t as any).project?.name }));
  }

  async create(
    projectId: string,
    data: {
      name: string;
      host: string;
      port?: number;
      username: string;
      authMethod?: string;
      credential?: string;
      hostKey?: string;
      workRoot?: string;
      type?: string;
    },
  ) {
    this.assertSafeTargetInput(data);
    // 工作目录必须在加密前校验：避免在无效输入上执行昂贵的 secrets.encrypt 调用。
    const workRoot = this.normalizeWorkRoot(data.workRoot);
    const encryptedCredential = this.secrets.encrypt(data.credential!);
    const target = await this.prisma.deployTarget.create({
      data: {
        projectId,
        name: data.name,
        type: data.type || 'SSH',
        host: data.host,
        port: data.port ?? 22,
        username: data.username,
        authMethod: 'KEY',
        encryptedCredential,
        hostKey: canonicalSshHostKey(data.hostKey)!,
        workRoot,
      },
    });
    return viewOf(target);
  }

  async getById(id: string): Promise<TargetView> {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('部署目标不存在');
    return viewOf(target);
  }

  /**
   * 部分更新：必须把"现有 + 改动"合并后再做一次完整校验，
   * 保证哪怕只改一个字段，结果行也满足 KEY/非 root/合法 Host/合法 workRoot。
   */
  async update(
    id: string,
    data: Partial<{
      name: string;
      host: string;
      port: number;
      username: string;
      authMethod: string;
      credential: string;
      hostKey: string;
      workRoot: string;
    }>,
  ) {
    const existing = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('部署目标不存在');

    // 合并：未知字段不传入。
    const merged: any = {
      name: data.name ?? existing.name,
      host: data.host ?? existing.host,
      port: data.port ?? existing.port,
      username: data.username ?? existing.username,
      authMethod: data.authMethod ?? 'KEY', // 默认 KEY；下面统一校验会拒绝任何非 KEY 值
      credential: data.credential ?? this.secrets.decrypt(existing.encryptedCredential),
      hostKey: data.hostKey ?? existing.hostKey,
      workRoot: data.workRoot ?? existing.workRoot,
    };
    // 完整校验合并后的目标。
    this.assertSafeTargetInput(merged);

    const updateData: any = {
      name: merged.name,
      host: merged.host,
      port: merged.port,
      username: merged.username,
      authMethod: 'KEY',
      hostKey: canonicalSshHostKey(merged.hostKey)!,
      workRoot: this.normalizeWorkRoot(merged.workRoot),
    };
    if (data.credential !== undefined) {
      updateData.encryptedCredential = this.secrets.encrypt(data.credential);
    }
    const updated = await this.prisma.deployTarget.update({ where: { id }, data: updateData });
    return viewOf(updated);
  }

  async delete(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('部署目标不存在');
    const deployCount = await this.prisma.deployment.count({ where: { deployTargetId: id } });
    if (deployCount > 0) {
      throw new ForbiddenException('该部署目标已被部署记录引用，无法删除');
    }
    await this.prisma.deployTarget.delete({ where: { id } });
  }

  /**
   * SSH 验证：检查 Docker / Docker Compose / 架构 / 工作目录可写 / 80 端口状态。
   * 关键修复（KI-024）：
   * - ready 回调内同步抛错要 reject 并确保 client.end()。
   * - error/close 路径上 Client 只关闭一次；Promise 一定 settle。
   */
  async verify(id: string): Promise<{ success: boolean; message: string }> {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('部署目标不存在');
    if (target.authMethod !== 'KEY' || !target.hostKey) {
      return { success: false, message: '仅支持带固定 Host Key 的密钥认证' };
    }
    const parsedHostKey = parseSshHostKey(target.hostKey);
    if (!parsedHostKey) return { success: false, message: 'Host Key 格式无效' };

    let settled = false;
    const client = new Client();
    const safeEnd = () => {
      try {
        client.end();
      } catch {
        /* already ended */
      }
    };

    try {
      const runtime = await new Promise<{
        dockerVersion: string;
        composeVersion: string;
        architecture: string;
        freeKb: string;
        httpPort: string;
      }>((resolve, reject) => {
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          safeEnd();
          fn();
        };

        client.on('ready', () => {
          if (settled) return;
          try {
            const root = this.normalizeWorkRoot(target.workRoot);
            const command = `set -eu; command -v docker >/dev/null; docker version --format '{{.Server.Version}}'; docker compose version --short; docker info --format '{{.Architecture}}'; mkdir -p '${root}'; chmod 700 '${root}'; test -w '${root}'; df -Pk '${root}' | awk 'NR == 2 { print $4 }'; if command -v ss >/dev/null 2>&1; then if ss -ltn | grep -Eq '[:.]80([[:space:]]|$)'; then echo OCCUPIED; else echo AVAILABLE; fi; else echo UNKNOWN; fi`;
            client.exec(command, (execError, stream) => {
              if (execError) {
                settle(() => reject(execError));
                return;
              }
              let stdout = '';
              let stderr = '';
              stream.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
              });
              stream.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
              });
              stream.on('close', (code: number | null) => {
                if (code !== 0) {
                  settle(() => reject(new Error(stderr.trim() || 'Docker / Docker Compose / 工作目录检查失败')));
                  return;
                }
                const [dockerVersion, composeVersion, architecture, freeKb, httpPort] = stdout.trim().split(/\r?\n/);
                if (!dockerVersion || !composeVersion || !architecture || !freeKb || !httpPort) {
                  settle(() => reject(new Error('目标机预检输出不完整')));
                  return;
                }
                settle(() => resolve({ dockerVersion, composeVersion, architecture, freeKb, httpPort }));
              });
              stream.on('error', (err: Error) => settle(() => reject(err)));
            });
          } catch (e: any) {
            // KI-024: ready 回调内抛错不能逃逸事件循环，必须 settle。
            settle(() => reject(e));
          }
        });
        client.on('error', (err: Error) => settle(() => reject(err)));
        client.on('close', () => {
          if (!settled) settle(() => reject(new Error('SSH 连接在完成预检前已关闭')));
        });
        client.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: this.secrets.decrypt(target.encryptedCredential),
          readyTimeout: 15_000,
          hostVerifier: (key: Buffer) => key.toString('base64') === parsedHostKey.key,
        });
      });

      await this.prisma.deployTarget.update({
        where: { id },
        data: { status: 'VERIFIED', lastVerifiedAt: new Date() },
      });
      const portNote =
        runtime.httpPort === 'OCCUPIED'
          ? '；80 端口已占用，当前不能自动启用域名 Nginx 路由'
          : runtime.httpPort === 'AVAILABLE'
            ? '；80 端口可用于自动域名 Nginx 路由'
            : '；未检测到 ss，80 端口状态需在 NAS 上手动确认';
      return {
        success: true,
        message: `验证通过：Docker ${runtime.dockerVersion}，Compose ${runtime.composeVersion}，${runtime.architecture}，工作目录可写（可用 ${this.formatFreeSpace(runtime.freeKb)}）${portNote}`,
      };
    } catch (error: any) {
      if (!settled) safeEnd();
      await this.prisma.deployTarget.update({ where: { id }, data: { status: 'FAILED' } });
      return { success: false, message: `SSH 验证失败: ${error?.message || '未知错误'}` };
    }
  }

  /** 完整校验一个目标的所有字段。 */
  private assertSafeTargetInput(input: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    authMethod?: string;
    credential?: string;
    hostKey?: string;
    workRoot?: string;
  }) {
    if (typeof input.name !== 'string' || !SAFE_NAME.test(input.name)) {
      throw new BadRequestException('name 必须是 1-255 字符，仅允许字母/数字/点/下划线/连字符/空格');
    }
    if (typeof input.host !== 'string' || !SAFE_HOST.test(input.host)) {
      throw new BadRequestException('host 必须是合法 hostname / IPv4 / IPv6 字面量');
    }
    if (!SAFE_PORT_RANGE(input.port ?? 22)) {
      throw new BadRequestException('port 必须是 1-65535 整数');
    }
    if (typeof input.username !== 'string' || !SAFE_USER.test(input.username) || input.username === 'root') {
      throw new BadRequestException('username 必须是非 root 的合法 SSH 用户名');
    }
    if (input.authMethod !== undefined && input.authMethod !== 'KEY') {
      throw new BadRequestException('authMethod 仅支持 KEY');
    }
    if (typeof input.credential !== 'string' || !input.credential.trim()) {
      throw new BadRequestException('credential（私钥）不能为空');
    }
    if (!parseSshHostKey(input.hostKey)) {
      throw new BadRequestException('hostKey 必须是合法的 known_hosts 行');
    }
  }

  private normalizeWorkRoot(value: unknown): string {
    const root = typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : DEFAULT_WORK_ROOT;
    if (!SAFE_WORK_ROOT.test(root) || root === '/') {
      throw new BadRequestException('工作目录必须是安全的非根绝对路径');
    }
    return root;
  }

  private formatFreeSpace(value: string): string {
    const kb = Number(value);
    if (!Number.isFinite(kb) || kb < 0) return '未知空间';
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  }
}
