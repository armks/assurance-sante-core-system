import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  DefinirPrixStockDto,
  CreerMedicamentCatalogueDto,
  ListerDispensationsQueryDto,
  ListerMesDispensationsQueryDto,
  ModifierMedicamentListeDto,
  PreparerDispensationDto,
  RechercherParCarteQueryDto,
  SoumettreFactureMensuelleDto,
  SubstituerMedicamentDto,
  ValiderCodeDispensationDto,
  ValiderFactureMensuelleDto,
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

  /** Côté PHARMACIE (3 rôles) : médicaments remboursables = catalogue national activé par l'assureur, avec « ma liste ». */
  @Get('medicaments-remboursables')
  listerMedicamentsRemboursables(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerMedicamentsRemboursables(user);
  }

  /** Côté PHARMACIE_PHARMACIEN exclusivement : ajoute un NOUVEAU médicament au catalogue national, avec son prix national. */
  @Post('catalogue-national/medicaments')
  creerMedicamentCatalogue(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerMedicamentCatalogueDto) {
    return this.pharmacy.creerMedicamentCatalogue(user, dto);
  }

  /** Côté PHARMACIE_PHARMACIEN exclusivement : ajoute un médicament du catalogue à sa liste. */
  @Post('medicaments-remboursables/:id/ajouter')
  ajouterMedicamentAMaListe(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.pharmacy.ajouterMedicamentAMaListe(user, id);
  }

  /** Côté PHARMACIE_PHARMACIEN exclusivement : disponibilité / note d'un médicament de sa liste (jamais un tarif). */
  @Patch('medicaments-remboursables/:id')
  modifierMedicamentDeMaListe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierMedicamentListeDto,
  ) {
    return this.pharmacy.modifierMedicamentDeMaListe(user, id, dto);
  }

  @Delete('medicaments-remboursables/:id')
  retirerMedicamentDeMaListe(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.pharmacy.retirerMedicamentDeMaListe(user, id);
  }

  /** Recherche d'un médicament dans la base (pharmacien ou pharmacien conseil) — le médicament se CHOISIT, il ne se saisit pas. */
  @Get('medicaments/recherche')
  rechercherMedicaments(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) {
    return this.pharmacy.rechercherMedicaments(user, q ?? '');
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
    return this.pharmacy.preparerDispensation(user, dto.ordonnanceId, dto.lignes, dto.canal);
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
  mesDispensations(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesDispensationsQueryDto) {
    return this.pharmacy.listerMesDispensations(user, dto);
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

  /** Côté PHARMACIE : saisit le code communiqué par le patient — passe à VALIDEE. */
  @Post('dispensations/:id/valider-code-pharmacie')
  validerCodeParPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValiderCodeDispensationDto,
  ) {
    return this.pharmacy.validerCodeParPharmacie(user, id, dto.code);
  }

  /** Côté PHARMACIE : supprime (annule) une facture d'ordonnance non réglée de SA pharmacie. */
  @Post('dispensations/:id/annuler')
  annuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pharmacy.annulerDispensation(user, id);
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
   * Côté PHARMACIE_PHARMACIEN ou ASSUREUR_PHARMACIEN_CONSEIL : substitue/
   * ajuste un médicament sur une ligne de dispensation — jamais la caissière
   * ni le comptable pharmacie, ni aucun autre rôle ASSUREUR. Impossible une
   * fois le paiement validé par le patient.
   */
  @Post('dispensations/lignes/:id/substituer')
  substituerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubstituerMedicamentDto,
  ) {
    return this.pharmacy.substituerMedicament(user, id, dto);
  }

  // --- Consolidation mensuelle des factures pharmacie ------------------

  /** Côté PHARMACIE_PHARMACIEN/PHARMACIE_COMPTABLE : soumet la consolidation du mois précédent. */
  @Post('factures-mensuelles')
  soumettreFactureMensuelle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SoumettreFactureMensuelleDto,
  ) {
    return this.pharmacy.soumettreFactureMensuelle(user, dto);
  }

  /** Côté PHARMACIE : historique de SES factures mensuelles. */
  @Get('factures-mensuelles/mes-factures')
  mesFacturesMensuelles(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerMesFacturesMensuelles(user);
  }

  /** Côté ASSUREUR_PHARMACIEN_CONSEIL exclusivement : « à valider » (SOUMISE). */
  @Get('factures-mensuelles/a-valider')
  facturesMensuellesAValider(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerFacturesMensuellesAValider(user);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : débloquées à partir de VALIDEE_PHARMACIEN_CONSEIL. */
  @Get('factures-mensuelles/pour-comptable')
  facturesMensuellesPourComptable(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacy.listerFacturesMensuellesPourComptable(user);
  }

  /** Détail ligne-par-ligne — verrou d'accès vérifié explicitement dans le service. */
  @Get('factures-mensuelles/:id')
  obtenirFactureMensuelle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pharmacy.obtenirFactureMensuelle(user, id);
  }

  /** Côté ASSUREUR_PHARMACIEN_CONSEIL exclusivement : double vérification anti-litige puis validation (VALIDEE/A_CORRIGER). */
  @Post('factures-mensuelles/:id/valider')
  validerFactureMensuelle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValiderFactureMensuelleDto,
  ) {
    return this.pharmacy.validerFactureMensuelle(user, id, dto);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : retire une ligne encore en litige. */
  @Post('factures-mensuelles/:id/lignes/:ligneId/decocher')
  decocherLigneContestee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ligneId', ParseUUIDPipe) ligneId: string,
  ) {
    return this.pharmacy.decocherLigneContestee(user, id, ligneId);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : valide pour paiement (VALIDEE_PHARMACIEN_CONSEIL → PROGRAMMEE_PAIEMENT), aucune ligne en litige non décochée. */
  @Post('factures-mensuelles/:id/valider-pour-paiement')
  validerPourPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pharmacy.validerPourPaiement(user, id);
  }

  // Le paiement RÉEL (débit d'un compte financier) est désormais réservé à
  // `PaymentService.payerFacture` (module payment/, POST payment/payer-facture)
  // — l'ancien `marquerFactureMensuellePayee` (symbolique) a été retiré.
}
