import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
