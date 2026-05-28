import { IsNotEmpty, IsOptional } from 'class-validator';

export class TestCaseRequestDto {
  @IsNotEmpty({ message: '标题不能为空' })
  title: string;

  @IsOptional()
  module?: string;

  @IsOptional()
  steps?: string;

  @IsOptional()
  expectedResult?: string;

  @IsOptional()
  priority?: string;

  @IsOptional()
  tags?: string;

  @IsOptional()
  ownerId?: string;
}

export class UpdateTestRunCaseDto {
  @IsOptional()
  result?: string;

  @IsOptional()
  notes?: string;

  @IsOptional()
  executedBy?: string;
}
