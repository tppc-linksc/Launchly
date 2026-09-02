import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const ACCESS_AUDIENCE = 'launchly:api';
const ACCESS_TOKEN_TYPE = 'access';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    try {
      const token = authHeader.substring(7);
      const payload = this.jwtService.verify(token, { audience: ACCESS_AUDIENCE });
      if (
        payload?.typ !== ACCESS_TOKEN_TYPE ||
        typeof payload?.uid !== 'string' ||
        !payload.uid ||
        typeof payload?.wid !== 'string' ||
        !payload.wid
      ) {
        throw new UnauthorizedException('Invalid access token');
      }
      const membership = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: payload.wid, userId: payload.uid },
        select: { role: true },
      });
      if (!membership) throw new UnauthorizedException('工作空间成员关系已失效');
      (request as any).user = {
        userId: payload.uid,
        workspaceId: payload.wid,
        // 使用数据库中的实时角色，确保降级/提权立即生效；项目级角色由访问策略实时读取。
        role: membership.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
