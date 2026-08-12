import { IsNotEmpty, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';

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
  @Matches(/^[a-z_][a-z0-9_-]*$/i, { message: '用户名格式无效' })
  username: string;

  @IsOptional()
  authMethod?: string = 'KEY';

  @IsOptional()
  @Matches(/^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/, {
    message: '工作目录必须是由字母、数字、点、下划线或短横线组成的绝对路径',
  })
  workRoot?: string = '/var/lib/launchly';

  @IsOptional()
  privateKey?: string;

  @IsNotEmpty({ message: '必须提供已验证的 SSH Host Key' })
  hostKey: string;
}
