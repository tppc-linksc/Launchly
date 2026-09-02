import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/** Records every successful HTTP mutation without persisting request bodies or secrets. */
@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<any>();
    const method = String(request.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: (response) => {
          const principal = request.user || {};
          const responseUser = response?.user;
          const responseWorkspace = response?.workspace;
          // Prefer the route template so secret-bearing path params (for example
          // invitation tokens) never enter the audit log as literal values.
          const routeTemplate = request.route?.path;
          const templatedPath =
            typeof routeTemplate === 'string'
              ? `${request.baseUrl || ''}${routeTemplate}`
              : request.originalUrl || request.url || '';
          const path = String(templatedPath).split('?')[0].slice(0, 500);
          const targetType =
            path
              .split('/')
              .filter(Boolean)
              .find((part: string) => part !== 'api')
              ?.toUpperCase()
              .slice(0, 50) || 'HTTP';
          const rawTargetId = request.params?.id || request.params?.projectId || request.params?.environmentId;
          const targetId = typeof rawTargetId === 'string' && rawTargetId.length <= 36 ? rawTargetId : null;
          const forwarded = String(request.headers?.['x-forwarded-for'] || '')
            .split(',')[0]
            .trim();
          const ipAddress = (forwarded || request.ip || request.socket?.remoteAddress || '').slice(0, 45) || null;
          const userAgent = String(request.headers?.['user-agent'] || '').slice(0, 500) || null;
          void this.prisma.auditLog
            .create({
              data: {
                userId: principal.userId || responseUser?.id || null,
                workspaceId: principal.workspaceId || responseWorkspace?.id || null,
                action: `HTTP_${method}`,
                targetType,
                targetId,
                detail: JSON.stringify({ path }),
                ipAddress,
                userAgent,
              },
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}
