import { IsString, IsOptional, IsInt } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  projectType?: string;

  @IsString()
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  defaultBranch?: string;

  @IsString()
  @IsOptional()
  gitProvider?: string;

  @IsString()
  @IsOptional()
  installCommand?: string;

  @IsString()
  @IsOptional()
  buildCommand?: string;

  @IsString()
  @IsOptional()
  startCommand?: string;

  @IsString()
  @IsOptional()
  testCommand?: string;

  @IsString()
  @IsOptional()
  healthCheckPath?: string;

  @IsInt()
  @IsOptional()
  defaultPort?: number;
}
