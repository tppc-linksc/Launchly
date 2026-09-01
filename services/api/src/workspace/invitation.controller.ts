import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationService } from './invitation.service';

@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Roles('OWNER')
  @Post()
  create(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthPrincipal) {
    return this.invitations.create(user.workspaceId!, dto);
  }

  @Roles('OWNER')
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.invitations.list(user.workspaceId!);
  }

  @Public()
  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(token, dto);
  }
}
