export class UpdateEnvironmentDto {
  name?: string;
  url?: string;
  deployMode?: string;
  host?: string;
  sshUser?: string;
  deployDir?: string;
  localWorkRoot?: string;
  externalPort?: number;
  dataStrategy?: string;
  enabled?: boolean;
}
