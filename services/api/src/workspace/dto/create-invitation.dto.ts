import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateInvitationDto {
  @IsIn(['ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER'])
  role!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUses?: number;
}
