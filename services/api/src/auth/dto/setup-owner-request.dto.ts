import { IsString, IsNotEmpty, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';

export class SetupOwnerRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  account!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(1024)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, { message: '密码必须包含字母和数字' })
  password!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  workspaceName!: string;
}
