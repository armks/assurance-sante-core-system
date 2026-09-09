import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreerOrganisationDto } from './dto/organisation.dto';
import { IdentityService } from './identity.service';
import { IdentityMeResponse } from './identity.types';
import { OrganisationsService } from './organisations.service';
import { ProvisioningService } from './provisioning.service';
import { CompteOrganisation, RoleProposable } from './provisioning.types';

@Controller('identity')
@UseGuards(SupabaseAuthGuard)
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly provisioningService: ProvisioningService,
    private readonly organisationsService: OrganisationsService,
  ) {}

  /**
   * GET /api/v1/identity/me
   * Profil complet + permissions effectives de l'utilisateur authentifié.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<IdentityMeResponse> {
    return this.identityService.getMe(user);
  }

  /**
   * GET /api/v1/identity/roles-proposables
   * Sous-rôles que l'utilisateur peut créer (CREATION_DIRECTE) ou proposer
   * (PROPOSITION), d'après regles_provisioning. Alimente le formulaire de
   * création de compte. Renvoie [] (jamais une erreur) si l'utilisateur n'a
   * aucun droit de provisioning.
   */
  @Get('roles-proposables')
  rolesProposables(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoleProposable[]> {
    return this.provisioningService.rolesProposables(user);
  }

  /**
   * GET /api/v1/identity/comptes
   * Comptes de l'organisation de l'appelant (page /utilisateurs).
   */
  @Get('comptes')
  comptes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompteOrganisation[]> {
    return this.provisioningService.listerComptesOrganisation(user);
  }

  /**
   * GET /api/v1/identity/organisations — liste des tenants (superadmin).
   */
  @Get('organisations')
  listerOrganisations(@CurrentUser() user: AuthenticatedUser) {
    return this.organisationsService.lister(user);
  }

  /**
   * POST /api/v1/identity/organisations — création d'un tenant (superadmin).
   */
  @Post('organisations')
  creerOrganisation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerOrganisationDto,
  ) {
    return this.organisationsService.creer(user, dto);
  }
}
