import { IsOptional, IsString } from 'class-validator';

export class UpdateIssueDto {
  @IsOptional()
  @IsString({ message: '标题必须是字符串' })
  title?: string;

  @IsOptional()
  @IsString({ message: '描述必须是字符串' })
  description?: string;

  @IsOptional()
  @IsString({ message: '优先级必须是字符串' })
  priority?: string;

  @IsOptional()
  @IsString({ message: '负责人 ID 必须是字符串' })
  assigneeId?: string;

  @IsOptional()
  @IsString({ message: '修复提交 SHA 必须是字符串' })
  fixedCommitSha?: string;
}

export class IssueTransitionDto {
  @IsString({ message: '目标状态必须是字符串' })
  toStatus: string;
}
