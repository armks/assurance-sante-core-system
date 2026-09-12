import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  DefinirPrixStockDto,
  ListerDispensationsQueryDto,
  PreparerDispensationDto,
  RechercherParCarteQueryDto,
  SubstituerMedicamentDto,
  ValiderCodeDispensationDto,
} from './dto/pharmacy.dto';
import { PharmacyService } from './pharmacy.service';

/**
 * Endpoints REST du module pharmacy/ — révision majeure du flux pharmacie
 * (verrou par ligne de médicament). Coexiste avec `preauthorization/`
 * (codes-ordonnance, PROMPT 19), inchangé.
 */
@Controller('pharmacy')
@UseGuards(SupabaseAuthGuard)
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  /** Côté PHARMACIE (3 sous-rôles) : recherche par numéro de carte — pas un code secret. */
  @Get('prescriptions/rechercher-par-carte')
  rechercherParCarte(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: RechercherParCarteQueryDto,
  ) {
    return this.pharmacy.rechercherPrescriptionsParCarte(user, dto.numeroCarte);
  }

  /** Côté PHARMACIE_PHARMACIEN exclusivement : son stock (prix/disponibilité). */
  @Get('stock')
  listerStock(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerStock(user);
  }

  @Post('stock')
  definirPrixStock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DefinirPrixStockDto,
  ) {
    return this.pharmacy.definirPrixStock(user, dto);
  }

  /** Côté PHARMACIE (3 sous-rôles) : prépare une dispensation par ligne(s) choisie(s). */
  @Post('dispensations')
  preparerDispensation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreparerDispensationDto,
  ) {
    return this.pharmacy.preparerDispensation(user, dto.ordonnanceId, dto.lignes);
  }

  /**
   * Côté PHARMACIE (3 sous-rôles) : liste des dispensations de SA pharmacie,
   * filtre optionnel par statut (`?statut=PAYEE` pour le comptable).
   */
  @Get('dispensations')
  listerDispensations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListerDispensationsQueryDto,
  ) {
    return this.pharmacy.listerDispensationsPharmacie(user, dto);
  }

  /** Côté ADHÉRENT : ses dispensations en attente (avec le code). */
  @Get('dispensations/mes-dispensations')
  mesDispensations(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerMesDispensations(user);
  }

  /** Côté PHARMACIE : détail/statut d'une dispensation de SA pharmacie. */
  @Get('dispensations/:id')
  obtenirDispensation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pharmacy.obtenirDispensation(user, id);
  }

  /** Côté ADHÉRENT : valide le code — passe à VALIDEE (pas encore payée). */
  @Post('dispensations/valider-code')
  validerCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeDispensationDto,
  ) {
    return this.pharmacy.validerCodeDispensation(user, dto);
  }

  /** Côté PHARMACIE : confirme le paiement — bloqué si le code n'est pas validé. */
  @Post('dispensations/:id/confirmer-paiement')
  confirmerPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pharmacy.confirmerPaiementDispensation(user, id);
  }

  /**
   * Côté PHARMACIE_PHARMACIEN exclusivement : substitue/ajuste un médicament
   * sur une ligne de dispensation — jamais la caissière ni le comptable.
   * Impossible une fois le paiement validé par le patient.
   */
  @Post('dispensations/lignes/:id/substituer')
  substituerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubstituerMedicamentDto,
  ) {
    return this.pharmacy.substituerMedicament(user, id, dto);
  }
}
