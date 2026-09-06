import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { IdentityService } from './identity.service';
import { IdentityMeResponse } from './identity.types';

@Controller('identity')
@UseGuards(SupabaseAuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  /**
   * GET /api/v1/identity/me
   * Profil complet + permissions effectives de l'utilisateur authentifié.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<IdentityMeResponse> {
    return this.identityService.getMe(user);
  }
}
