import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(account: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { account } });
    if (!user) throw new UnauthorizedException('账号或密码错误');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('账号或密码错误');

    // Get workspace membership
    const member = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    const workspaceId = member?.workspaceId;
    const role = member?.role;
    const workspaceName = member?.workspace?.name;

    const accessToken = this.jwtService.sign({
      uid: user.id,
      ...(workspaceId && { wid: workspaceId }),
      ...(role && { role }),
    });

    const refreshToken = this.jwtService.sign(
      { uid: user.id },
      { expiresIn: '30d' },
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        account: user.account,
        displayName: user.displayName,
        role,
      },
      workspace: workspaceId ? { id: workspaceId, name: workspaceName } : null,
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.prisma.user.findUnique({ where: { id: payload.uid } });
      if (!user) throw new UnauthorizedException('User not found');

      const member = await this.prisma.workspaceMember.findFirst({
        where: { userId: user.id },
        include: { workspace: true },
      });

      const workspaceId = member?.workspaceId;
      const role = member?.role;
      const workspaceName = member?.workspace?.name;

      const newAccessToken = this.jwtService.sign({
        uid: user.id,
        ...(workspaceId && { wid: workspaceId }),
        ...(role && { role }),
      });

      const newRefreshToken = this.jwtService.sign(
        { uid: user.id },
        { expiresIn: '30d' },
      );

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          account: user.account,
          displayName: user.displayName,
          role,
        },
        workspace: workspaceId ? { id: workspaceId, name: workspaceName } : null,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getStatus() {
    const count = await this.prisma.user.count();
    return { initialized: count > 0 };
  }

  async createOwner(account: string, password: string, displayName: string | null, workspaceName: string) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new BadRequestException('系统已初始化');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
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
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      return { user, workspace };
    });

    const accessToken = this.jwtService.sign({
      uid: result.user.id,
      wid: result.workspace.id,
      role: 'OWNER',
    });

    const refreshToken = this.jwtService.sign(
      { uid: result.user.id },
      { expiresIn: '30d' },
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: result.user.id,
        account: result.user.account,
        displayName: result.user.displayName,
        role: 'OWNER',
      },
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
      },
    };
  }
}
