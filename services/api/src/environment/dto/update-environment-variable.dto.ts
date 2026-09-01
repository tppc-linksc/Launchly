import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateEnvironmentVariableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  value?: string;

  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
