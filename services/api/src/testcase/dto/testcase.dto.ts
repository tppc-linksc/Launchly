import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TestCaseRequestDto {
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  title: string;

  @IsOptional()
  @IsString({ message: '描述必须是字符串' })
  description?: string;

  @IsOptional()
  @IsString({ message: '模块名必须是字符串' })
  module?: string;

  @IsOptional()
  @IsString({ message: '步骤必须是字符串' })
  steps?: string;

  @IsOptional()
  @IsString({ message: '期望结果必须是字符串' })
  expectedResult?: string;

  @IsOptional()
  @IsString({ message: '优先级必须是字符串' })
  priority?: string;

  @IsOptional()
  @IsString({ message: '标签必须是字符串' })
  tags?: string;

  @IsOptional()
  @IsString({ message: '负责人 ID 必须是字符串' })
  ownerId?: string;

  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  notes?: string;
}

export class UpdateTestRunCaseDto {
  @IsOptional()
  @IsIn(['PENDING', 'PASSED', 'FAILED', 'SKIPPED'], {
    message: '测试结果必须是 PENDING/PASSED/FAILED/SKIPPED',
  })
  @IsString({ message: '结果必须是字符串' })
  result?: string;

  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  notes?: string;

  @IsOptional()
  @IsString({ message: '执行人 ID 必须是字符串' })
  executedBy?: string;
}
