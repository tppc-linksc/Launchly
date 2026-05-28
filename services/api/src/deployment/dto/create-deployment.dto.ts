import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateDeploymentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  deployTargetId!: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  commitSha?: string;
}
