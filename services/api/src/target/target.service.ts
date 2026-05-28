import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretValueService } from '../environment/secret-value.service';
import { CreateDeployTargetDto, UpdateDeployTargetDto } from './dto';

@Injectable()
export class DeployTargetService {
  private readonly logger = new Logger(DeployTargetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretValueService: SecretValueService,
  ) {}

  async listByProject(projectId: string) {
    const targets = await this.prisma.deployTarget.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return targets.map((t) => this.toDto(t));
  }

  async getById(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found: ' + id);
    return this.toDto(target);
  }

  async create(projectId: string, dto: CreateDeployTargetDto, workspaceId: string) {
    const target = await this.prisma.deployTarget.create({
      data: {
        projectId,
        name: dto.name,
        host: dto.host,
        port: dto.port ?? 22,
        username: dto.username,
        authMethod: dto.authMethod || 'KEY',
        encryptedCredential: dto.privateKey
          ? this.secretValueService.encrypt(dto.privateKey)
          : '',
        status: 'UNVERIFIED',
      },
    });
    return this.toDto(target);
  }

  async update(id: string, dto: UpdateDeployTargetDto) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found: ' + id);

    const data: any = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.host != null) data.host = dto.host;
    if (dto.port != null) data.port = dto.port;
    if (dto.username != null) data.username = dto.username;
    if (dto.authMethod != null) data.authMethod = dto.authMethod;
    if (dto.privateKey != null && dto.privateKey.trim()) {
      data.encryptedCredential = this.secretValueService.encrypt(dto.privateKey);
    }

    const updated = await this.prisma.deployTarget.update({ where: { id }, data });
    return this.toDto(updated);
  }

  async delete(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found: ' + id);

    const refs = await this.prisma.deployment.count({ where: { deployTargetId: id } });
    if (refs > 0) {
      throw new ConflictException(
        `无法删除：仍有 ${refs} 条部署记录引用此部署目标。请先迁移或删除相关部署后再试。`,
      );
    }

    await this.prisma.deployTarget.delete({ where: { id } });
  }

  /**
   * Verify SSH connection to the deploy target.
   * In Node.js, we use the ssh2 library (or fallback to child_process ssh command).
   * For now, we perform a simplified check using the native ssh command.
   */
  async verify(id: string) {
    const target = await this.prisma.deployTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Deploy target not found: ' + id);

    if (!target.encryptedCredential) {
      await this.prisma.deployTarget.update({
        where: { id },
        data: { status: 'FAILED', lastVerifiedAt: new Date() },
      });
      return { status: 'FAILED', dockerVersion: null, error: 'No credential configured' };
    }

    const credential = this.secretValueService.decrypt(target.encryptedCredential);

    try {
      const dockerVersion = await this.verifySshConnection(target, credential!);
      await this.prisma.deployTarget.update({
        where: { id },
        data: { status: 'CONNECTED', lastVerifiedAt: new Date() },
      });
      return { status: 'CONNECTED', dockerVersion, error: null };
    } catch (e: any) {
      const errorMsg = this.buildVerifyErrorMessage(e);
      this.logger.warn(`Deploy target verification failed: id=${id}, host=${target.host}, error=${errorMsg}`);
      await this.prisma.deployTarget.update({
        where: { id },
        data: { status: 'FAILED', lastVerifiedAt: new Date() },
      });
      return { status: 'FAILED', dockerVersion: null, error: errorMsg };
    }
  }

  /**
   * Attempt SSH connection verification.
   * Uses child_process to run ssh command for verification.
   * In production, ssh2 library would be preferred.
   */
  private async verifySshConnection(target: any, credential: string): Promise<string> {
    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const isPassword = target.authMethod === 'PASSWORD';
    let tmpKeyPath: string | null = null;

    try {
      let sshCmd: string;

      if (isPassword) {
        // For password auth, use sshpass if available
        sshCmd = `sshpass -p '${credential.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${target.username}@${target.host} -p ${target.port}`;
      } else {
        // Write private key to temp file
        tmpKeyPath = join(tmpdir(), `launchly-key-${Date.now()}.pem`);
        writeFileSync(tmpKeyPath, credential, { mode: 0o600 });
        sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i ${tmpKeyPath} ${target.username}@${target.host} -p ${target.port}`;
      }

      const dockerCmd = `${sshCmd} "sh -lc 'export PATH=\\\"\\$PATH:/usr/local/bin:/opt/homebrew/bin\\\"; docker version --format \\\"{{.Server.Version}}\\\"'"`;
      const result = execSync(dockerCmd, { timeout: 15000, encoding: 'utf8' });
      return result.trim();
    } finally {
      if (tmpKeyPath) {
        try { unlinkSync(tmpKeyPath); } catch {}
      }
    }
  }

  private buildVerifyErrorMessage(exception: Error): string {
    const msg = exception.message || '';
    if (!msg.trim()) return '连接失败：未知错误';
    if (msg.toLowerCase().includes('auth fail')) return 'SSH 认证失败：请检查用户名与凭据（密码或私钥）';
    if (msg.toLowerCase().includes('connection is closed by foreign host'))
      return 'SSH 连接被远端主动关闭：请检查 SSH 策略、认证方式或账号登录权限';
    if (msg.includes('docker: not found') || msg.includes('docker command not found'))
      return '目标主机未找到 Docker 命令，请先安装 Docker 或修正 PATH';
    return msg;
  }

  private toDto(target: any) {
    let maskedCredential: string | null = null;
    if (target.encryptedCredential && target.encryptedCredential.length > 8) {
      maskedCredential =
        target.encryptedCredential.substring(0, 4) +
        '***' +
        target.encryptedCredential.substring(target.encryptedCredential.length - 4);
    }
    return {
      id: target.id,
      projectId: target.projectId,
      name: target.name,
      type: target.type || 'SSH',
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      maskedCredential,
      status: target.status,
      lastVerifiedAt: target.lastVerifiedAt,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    };
  }
}
