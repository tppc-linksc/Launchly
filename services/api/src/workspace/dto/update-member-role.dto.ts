import { IsIn, IsString } from 'class-validator';

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER'] as const;

export class UpdateMemberRoleDto {
  @IsString()
  @IsIn(WORKSPACE_ROLES)
  role!: string;
}
