import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

interface AuditClassification {
  action: string;
  targetType: string;
}

const DOMAIN_MUTATIONS: Readonly<Record<string, AuditClassification>> = {
  'POST /workspace/rotate-secrets': { action: 'WORKSPACE_SECRET_ROTATE', targetType: 'WORKSPACE' },
  'POST /environments/:environmentId/variables': {
    action: 'ENVIRONMENT_VARIABLE_CREATE',
    targetType: 'ENVIRONMENT_VARIABLE',
  },
  'PUT /environments/:environmentId/variables/:variableId': {
    action: 'ENVIRONMENT_VARIABLE_UPDATE',
    targetType: 'ENVIRONMENT_VARIABLE',
  },
  'DELETE /environments/:environmentId/variables/:variableId': {
    action: 'ENVIRONMENT_VARIABLE_DELETE',
    targetType: 'ENVIRONMENT_VARIABLE',
  },
  'POST /invitations': { action: 'INVITATION_CREATE', targetType: 'MEMBER' },
  'POST /invitations/:token/accept': { action: 'INVITATION_ACCEPT', targetType: 'MEMBER' },
  'PUT /members/:id/role': { action: 'MEMBER_ROLE_UPDATE', targetType: 'MEMBER' },
  'DELETE /members/:id': { action: 'MEMBER_REMOVE', targetType: 'MEMBER' },
  'POST /projects/:projectId/deploy-targets': { action: 'DEPLOY_TARGET_CREATE', targetType: 'DEPLOY_TARGET' },
  'PATCH /deploy-targets/:id': { action: 'DEPLOY_TARGET_UPDATE', targetType: 'DEPLOY_TARGET' },
  'DELETE /deploy-targets/:id': { action: 'DEPLOY_TARGET_DELETE', targetType: 'DEPLOY_TARGET' },
  'POST /deploy-targets/:id/verify': { action: 'DEPLOY_TARGET_VERIFY', targetType: 'DEPLOY_TARGET' },
  'POST /projects/:projectId/releases': { action: 'RELEASE_CREATE', targetType: 'RELEASE' },
  'PUT /projects/:projectId/releases/:id/publish': { action: 'RELEASE_PUBLISH', targetType: 'RELEASE' },
  'POST /projects/:projectId/releases/:id/gates/:gateName/exempt': {
    action: 'RELEASE_GATE_EXEMPT',
    targetType: 'RELEASE',
  },
};

function normalizeAuditPath(path: string): string {
  const withoutQuery = path.split('?')[0].slice(0, 500);
  const withoutPrefix = withoutQuery.replace(/^\/api(?=\/|$)/, '') || '/';
  return withoutPrefix.length > 1 ? withoutPrefix.replace(/\/$/, '') : withoutPrefix;
}

export function classifyAuditMutation(method: string, path: string): AuditClassification {
  const normalizedPath = normalizeAuditPath(path);
  const domain = DOMAIN_MUTATIONS[`${method} ${normalizedPath}`];
  if (domain) return domain;

  const targetType =
    normalizedPath.split('/').filter(Boolean)[0]?.replace(/-/g, '_').toUpperCase().slice(0, 50) || 'HTTP';
  return { action: `HTTP_${method}`, targetType };
}

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
          const classification = classifyAuditMutation(method, path);
          const rawTargetId =
            response?.id ||
            request.params?.id ||
            request.params?.variableId ||
            request.params?.caseId ||
            request.params?.testRunId ||
            request.params?.deploymentId ||
            request.params?.projectId ||
            request.params?.environmentId;
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
                action: classification.action,
                targetType: classification.targetType,
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
