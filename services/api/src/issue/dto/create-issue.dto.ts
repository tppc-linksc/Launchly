import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateIssueDto {
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  environmentId?: string;

  @IsOptional()
  @IsString()
  deploymentId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}
