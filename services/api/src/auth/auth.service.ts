import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { webcrypto as crypto } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * 认证 Service（KI-010 / R0-08）。
 *
 * 关键改进：
 * - Access/Refresh Token 使用不同的 audience（`launchly:api` / `launchly:refresh`），
 *   并在 payload 中加入 `typ` 字段做语义区分；即便签名有效，
 *   用 access token 调用 refresh 也会因 aud/typ 校验失败而被拒绝。
 * - Refresh Token 内嵌 jti（128-bit 随机），并支持服务端撤销（in-memory Set）。
 *   实际生产应换成持久化存储（Redis/DB），目前仅用于本地和测试。
 */

const TOKEN_TYPE_ACCESS = 'access';
const TOKEN_TYPE_REFRESH = 'refresh';
const ACCESS_AUDIENCE = 'launchly:api';
const REFRESH_AUDIENCE = 'launchly:refresh';
const REFRESH_TOKEN_TTL = '30d';
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 10_000;

interface AccessTokenPayload {
  uid: string;
  wid?: string;
  role?: string;
  typ: typeof TOKEN_TYPE_ACCESS;
}

interface RefreshTokenPayload {
  uid: string;
  jti: string;
  typ: typeof TOKEN_TYPE_REFRESH;
  aud?: string | string[];
}

@Injectable()
export class AuthService {
  /**
   * 已撤销的 Refresh Token jti 集合。
   * 多实例部署应改为 Redis 或数据库表；目前为单实例内存实现，足以通过 R0 BASE 验收。
   */
  private readonly revokedRefreshJtis = new Set<string>();
  private readonly loginFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(account: string, password: string, clientAddress = 'unknown') {
    const rateLimitKey = `${clientAddress}\u0000${account.toLocaleLowerCase('en-US')}`;
    this.assertLoginAllowed(rateLimitKey);
    const user = await this.prisma.user.findUnique({ where: { account } });
    if (!user) {
      this.recordLoginFailure(rateLimitKey);
      throw new UnauthorizedException('账号或密码错误');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.recordLoginFailure(rateLimitKey);
      throw new UnauthorizedException('账号或密码错误');
    }

    this.loginFailures.delete(rateLimitKey);

    const member = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    return this.issueTokenPair(
      user.id,
      member?.workspaceId,
      member?.role,
      member?.workspace?.name,
      user.account,
      user.displayName,
    );
  }

  async refresh(refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('无效的 Refresh Token');
    }
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, { audience: REFRESH_AUDIENCE });
    } catch {
      throw new UnauthorizedException('无效的 Refresh Token');
    }
    if (payload.typ !== TOKEN_TYPE_REFRESH) {
      throw new UnauthorizedException('Refresh Token 类型或受众错误');
    }
    if (!payload.jti || this.revokedRefreshJtis.has(payload.jti)) {
      throw new UnauthorizedException('Refresh Token 已撤销');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user) throw new UnauthorizedException('用户不存在');

    // 旋转：先撤销本次使用的 refresh，再签发新对。
    this.revokedRefreshJtis.add(payload.jti);

    const member = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    return this.issueTokenPair(
      user.id,
      member?.workspaceId,
      member?.role,
      member?.workspace?.name,
      user.account,
      user.displayName,
    );
  }

  /** 主动登出：尝试撤销提供的 Refresh Token。出错也视为登出成功（幂等）。 */
  async logout(refreshToken: string | undefined | null) {
    if (!refreshToken || typeof refreshToken !== 'string') return { success: true };
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, { audience: REFRESH_AUDIENCE });
      if (payload.typ === TOKEN_TYPE_REFRESH && payload.jti) {
        this.revokedRefreshJtis.add(payload.jti);
      }
    } catch {
      // 已过期或非法，视为已登出。
    }
    return { success: true };
  }

  async getStatus() {
    const count = await this.prisma.user.count();
    return { initialized: count > 0 };
  }

  async createOwner(account: string, password: string, displayName: string | null, workspaceName: string) {
    const passwordHash = await bcrypt.hash(password, 10);

    let result: { user: any; workspace: any };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // The count and writes share a SERIALIZABLE transaction. Concurrent first-owner
        // attempts cannot both commit even when they use different account values.
        if (await tx.user.count() > 0) throw new BadRequestException('系统已初始化');
        const user = await tx.user.create({
          data: {
            account,
            displayName: displayName || account,
            passwordHash,
          },
        });
        const workspace = await tx.workspace.create({
          data: { name: workspaceName },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
        });
        return { user, workspace };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      if (error?.code === 'P2002' || error?.code === 'P2034') {
        throw new BadRequestException('系统已初始化或正在初始化');
      }
      throw error;
    }

    return this.issueTokenPair(
      result.user.id,
      result.workspace.id,
      'OWNER',
      result.workspace.name,
      result.user.account,
      result.user.displayName,
    );
  }

  private async issueTokenPair(
    userId: string,
    workspaceId: string | undefined,
    role: string | undefined,
    workspaceName: string | undefined,
    account: string,
    displayName: string | null,
  ) {
    const accessPayload: AccessTokenPayload = {
      uid: userId,
      ...(workspaceId && { wid: workspaceId }),
      ...(role && { role }),
      typ: TOKEN_TYPE_ACCESS,
    };
    const accessToken = this.jwtService.sign(accessPayload, { audience: ACCESS_AUDIENCE });

    const refreshJti = this.randomJti();
    const refreshPayload: RefreshTokenPayload = {
      uid: userId,
      jti: refreshJti,
      typ: TOKEN_TYPE_REFRESH,
    };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      audience: REFRESH_AUDIENCE,
      expiresIn: REFRESH_TOKEN_TTL,
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, account, displayName, role },
      workspace: workspaceId ? { id: workspaceId, name: workspaceName } : null,
    };
  }

  private randomJti(): string {
    // 128-bit 随机 ID，十六进制编码。
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private assertLoginAllowed(key: string): void {
    const now = Date.now();
    const entry = this.loginFailures.get(key);
    if (!entry) return;
    if (entry.resetAt <= now) {
      this.loginFailures.delete(key);
      return;
    }
    if (entry.count >= LOGIN_FAILURE_LIMIT) {
      throw new HttpException('登录尝试过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordLoginFailure(key: string): void {
    const now = Date.now();
    const current = this.loginFailures.get(key);
    if (!current || current.resetAt <= now) {
      // Bound memory even when an attacker rotates arbitrary account names/IPs.
      if (this.loginFailures.size >= MAX_RATE_LIMIT_KEYS) {
        for (const [candidate, entry] of this.loginFailures) {
          if (entry.resetAt <= now) this.loginFailures.delete(candidate);
        }
        if (this.loginFailures.size >= MAX_RATE_LIMIT_KEYS) {
          this.loginFailures.delete(this.loginFailures.keys().next().value as string);
        }
      }
      this.loginFailures.set(key, { count: 1, resetAt: now + LOGIN_FAILURE_WINDOW_MS });
      return;
    }
    current.count += 1;
  }
}
