import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  account!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
