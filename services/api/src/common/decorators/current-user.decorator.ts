import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthPrincipal {
  userId: string;
  workspaceId?: string;
  role?: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthPrincipal | undefined, ctx: ExecutionContext): AuthPrincipal | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthPrincipal;
    return data ? user?.[data] : user;
  },
);
