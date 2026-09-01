import { Module } from '@nestjs/common';
import { MemberController } from './member.controller';
import { WorkspaceController } from './workspace.controller';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { EnvironmentModule } from '../environment/environment.module';
import { SecretRotationService } from './secret-rotation.service';

@Module({
  imports: [EnvironmentModule],
  controllers: [MemberController, WorkspaceController, InvitationController],
  providers: [InvitationService, SecretRotationService],
})
export class WorkspaceModule {}
