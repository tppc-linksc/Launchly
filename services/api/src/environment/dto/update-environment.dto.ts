export class UpdateEnvironmentDto {
  name?: string;
  url?: string;
  domain?: string;
  deployMode?: string;
  host?: string;
  sshUser?: string;
  deployDir?: string;
  localWorkRoot?: string;
  externalPort?: number;
  dataStrategy?: string;
  enabled?: boolean;
  autoDeploy?: boolean;
  branchPattern?: string;
  requireCi?: boolean;
  deployTargetId?: string;
}
