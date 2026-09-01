import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AUDIT_EXPORT_LIMIT, AuditService } from './audit.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('audit-logs')
@Roles('ADMIN')
export class AuditLogController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.list(this.workspaceId(user), this.boundedInt(limit, 50, 1, 500, 'limit'), this.boundedInt(offset, 0, 0, 10_000_000, 'offset'));
  }

  @Get('export')
  async export(@CurrentUser() user: AuthPrincipal, @Res() res: Response) {
    const fetchedLogs = await this.auditService.listForExport(this.workspaceId(user));
    const truncated = fetchedLogs.length > AUDIT_EXPORT_LIMIT;
    const logs = truncated ? fetchedLogs.slice(0, AUDIT_EXPORT_LIMIT) : fetchedLogs;

    const header = '时间,用户ID,操作,目标类型,目标ID,详情\n';
    const rows = logs.map(l => [
      l.createdAt.toISOString(),
      l.userId,
      l.action,
      l.targetType,
      l.targetId,
      l.detail,
    ].map(value => this.csvCell(value)).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    if (truncated) res.setHeader('X-Launchly-Export-Truncated', 'true');
    res.send('\uFEFF' + header + rows);
  }

  private workspaceId(user: AuthPrincipal): string {
    if (!user?.workspaceId) throw new BadRequestException('工作空间身份缺失');
    return user.workspaceId;
  }

  private boundedInt(raw: string | undefined, fallback: number, min: number, max: number, label: string): number {
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) throw new BadRequestException(`${label} 必须是整数`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${label} 必须在 ${min}-${max} 之间`);
    }
    return value;
  }

  /** RFC 4180 escaping plus spreadsheet-formula neutralisation. */
  private csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
