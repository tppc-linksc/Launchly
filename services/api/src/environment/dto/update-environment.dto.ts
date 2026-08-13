import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class UpdateEnvironmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  @Matches(DOMAIN_PATTERN, {
    message: '域名格式无效；请填写例如 app.example.com 的主机名，不含协议和路径',
  })
  domain?: string;

  @IsOptional()
  @IsString()
  deployMode?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsString()
  sshUser?: string;

  @IsOptional()
  @IsString()
  deployDir?: string;

  @IsOptional()
  @IsString()
  localWorkRoot?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  externalPort?: number;

  @IsOptional()
  @IsString()
  dataStrategy?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoDeploy?: boolean;

  @IsOptional()
  @IsString()
  branchPattern?: string;

  @IsOptional()
  @IsBoolean()
  requireCi?: boolean;

  @IsOptional()
  @IsString()
  deployTargetId?: string;
}
