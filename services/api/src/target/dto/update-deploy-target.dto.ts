import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class UpdateDeployTargetDto {
  @IsOptional()
  name?: string;

  @IsOptional()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  username?: string;

  @IsOptional()
  authMethod?: string;

  @IsOptional()
  privateKey?: string;
}
