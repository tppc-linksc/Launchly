import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateReleaseDto {
  @IsString()
  @IsNotEmpty({ message: '环境不能为空' })
  environmentId!: string;

  @IsString()
  @IsNotEmpty({ message: '发布部署不能为空' })
  deploymentId!: string;

  @IsString()
  @IsNotEmpty({ message: '版本不能为空' })
  version!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
