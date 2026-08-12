import { IsOptional, IsInt, Min, Max, Matches } from 'class-validator';

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
  @Matches(/^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/, {
    message: '工作目录必须是由字母、数字、点、下划线或短横线组成的绝对路径',
  })
  workRoot?: string;

  @IsOptional()
  privateKey?: string;

  @IsOptional()
  hostKey?: string;
}
