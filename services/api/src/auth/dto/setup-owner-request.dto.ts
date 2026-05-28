import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';

export class SetupOwnerRequestDto {
  @IsString()
  @IsNotEmpty()
  account!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, { message: '密码必须包含字母和数字' })
  password!: string;

  @IsString()
  displayName?: string;

  @IsString()
  @IsNotEmpty()
  workspaceName!: string;
}
