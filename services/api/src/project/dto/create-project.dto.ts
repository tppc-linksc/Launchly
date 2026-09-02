import {
  IsString,
  IsOptional,
  IsInt,
  IsObject,
  IsBoolean,
  ValidateNested,
  MinLength,
  IsEmail,
  IsNotEmpty,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RepositoryCredentialDto {
  @IsString()
  privateKey!: string;

  @IsString()
  hostKey!: string;
}

export class BootstrapAdminDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @IsOptional()
  command?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  /** Accepted only to encrypt; it is never returned in a project response. */
  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  projectType?: string;

  @IsString()
  @IsOptional()
  resourceKind?: string;

  @IsString()
  @IsOptional()
  sourceType?: string;

  @IsString()
  @IsOptional()
  runtimeMode?: string;

  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  imageReference?: string;

  @IsObject()
  @IsOptional()
  resourceConfig?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  defaultBranch?: string;

  @IsString()
  @IsOptional()
  gitProvider?: string;

  @IsString()
  @IsOptional()
  githubInstallationId?: string;

  @IsString()
  @IsOptional()
  githubRepositoryId?: string;

  @IsString()
  @IsOptional()
  registryRepository?: string;

  @IsString()
  @IsOptional()
  installCommand?: string;

  @IsString()
  @IsOptional()
  buildCommand?: string;

  @IsString()
  @IsOptional()
  startCommand?: string;

  @IsString()
  @IsOptional()
  testCommand?: string;

  @IsString()
  @IsOptional()
  healthCheckPath?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(65535)
  defaultPort?: number;

  /** Only accepted for an SSH deploy-key source and encrypted before persistence. */
  @ValidateNested()
  @Type(() => RepositoryCredentialDto)
  @IsOptional()
  repositoryCredential?: RepositoryCredentialDto;

  @ValidateNested()
  @Type(() => BootstrapAdminDto)
  @IsOptional()
  bootstrapAdmin?: BootstrapAdminDto;
}
