import { IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateEnvironmentVariableDto {
  @IsNotEmpty({ message: '变量名不能为空' })
  key: string;

  @IsNotEmpty({ message: '变量值不能为空' })
  value: string;

  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  @IsOptional()
  description?: string;
}
