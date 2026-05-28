import { IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreateDeployTargetDto {
  @IsNotEmpty({ message: '名称不能为空' })
  name: string;

  @IsNotEmpty({ message: '主机不能为空' })
  host: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number = 22;

  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsOptional()
  authMethod?: string = 'KEY';

  @IsOptional()
  privateKey?: string;
}
