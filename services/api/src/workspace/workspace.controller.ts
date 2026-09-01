import { Body, Controller, Get, NotFoundException, Post, Put } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { SecretRotationService } from './secret-rotation.service';

@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretRotation: SecretRotationService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthPrincipal) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: user.workspaceId! } });
    if (!workspace) throw new NotFoundException('工作空间不存在');
    return workspace;
  }

  @Roles('OWNER')
  @Put()
  async update(@Body() dto: UpdateWorkspaceDto, @CurrentUser() user: AuthPrincipal) {
    return this.prisma.workspace.update({
      where: { id: user.workspaceId! },
      data: { name: dto.name.trim() },
    });
  }

  @Roles('OWNER')
  @Post('rotate-secrets')
  rotateSecrets(@CurrentUser() user: AuthPrincipal) {
    return this.secretRotation.rotate(user.workspaceId!);
  }
}
