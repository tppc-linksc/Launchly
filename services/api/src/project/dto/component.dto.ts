import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 组件（Service）的创建/更新 DTO（KI-005）。
 *
 * 全部字段受限：
 * - name：1-255 字符，仅允许字母数字、点、下划线、连字符、空格。
 * - repositoryUrl：必须是合法 http(s) URL。
 * - healthCheckPath：以 `/` 开头，不允许 shell 元字符。
 * - defaultPort：1-65535 整数。
 */

const SAFE_NAME = /^[A-Za-z0-9._ -]{1,255}$/;
const SAFE_URL = /^https?:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?(\/[\S]*)?$/;
const SAFE_PATH = /^\/[A-Za-z0-9._\-\/]*$/;

export class CreateComponentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SAFE_NAME, { message: 'name 必须是 1-255 字符，仅允许字母/数字/点/下划线/连字符/空格' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_URL, { message: 'repositoryUrl 必须是合法的 http(s) URL' })
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  buildCommand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  startCommand?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_PATH, { message: 'healthCheckPath 必须以 / 开头，不允许 shell 元字符' })
  healthCheckPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  defaultPort?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateComponentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SAFE_NAME, { message: 'name 必须是 1-255 字符，仅允许字母/数字/点/下划线/连字符/空格' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_URL, { message: 'repositoryUrl 必须是合法的 http(s) URL' })
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  buildCommand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  startCommand?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_PATH, { message: 'healthCheckPath 必须以 / 开头，不允许 shell 元字符' })
  healthCheckPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  defaultPort?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
