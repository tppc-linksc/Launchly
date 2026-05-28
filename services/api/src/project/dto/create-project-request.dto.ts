import { IsNotEmpty, IsOptional, IsInt, IsString } from 'class-validator';

export class CreateProjectRequestDto {
  @IsNotEmpty({ message: '项目名称不能为空' })
  name: string;

  @IsOptional()
  description?: string;

  @IsOptional()
  projectType?: string;

  @IsOptional()
  repositoryUrl?: string;

  @IsOptional()
  defaultBranch?: string;

  @IsOptional()
  gitProvider?: string;

  @IsOptional()
  installCommand?: string;

  @IsOptional()
  buildCommand?: string;

  @IsOptional()
  startCommand?: string;

  @IsOptional()
  testCommand?: string;

  @IsOptional()
  healthCheckPath?: string;

  @IsOptional()
  @IsInt()
  defaultPort?: number;
}
