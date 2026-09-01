import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  refreshToken!: string;
}
