import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuditService } from './audit.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.list(
      user.workspaceId!,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
  }

  @Get('export')
  async export(@CurrentUser() user: AuthPrincipal, @Res() res: Response) {
    const logs = await this.auditService.listForExport(user.workspaceId!);

    const header = '时间,用户ID,操作,目标类型,目标ID,详情\n';
    const rows = logs.map(l =>
      `${l.createdAt.toISOString()},${l.userId || ''},${l.action},${l.targetType || ''},${l.targetId || ''},${(l.detail || '').replace(/,/g, ';')}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.send('\uFEFF' + header + rows);
  }
}
