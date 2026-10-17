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
  AjouterActeDto,
  AnnulerDecisionPreautorisationDto,
  AutoriserRepetitionConsultationDto,
  AutoriserRepetitionDto,
  MarquerActeRealiseDto,
  TraiterParExploitationDto,
  ValiderPreautorisationDto,
} from './dto/acte.dto';
import {
  GenererFactureSelectionDto,
  SoumettreFactureMensuelleEtablissementDto,
  ValiderCodeFacturationDto,
  VerifierFactureMensuelleEtablissementDto,
} from './dto/facture.dto';
import {
  CreerOrdonnanceDto,
  DispensationDto,
  ValiderCodeOrdonnanceDto,
} from './dto/ordonnance.dto';
import {
  GenererCodeConsultationDto,
  ListerMesCodesConsultationQueryDto,
  ListerMesCodesOrdonnanceQueryDto,
  ListerMesFacturesQueryDto,
  ValiderCodeConsultationDto,
} from './dto/preauthorization.dto';
import { PreauthorizationService } from './preauthorization.service';

/**
 * Endpoints REST du module preauthorization — Code de Consultation (v8 §2).
 *
 * `codes-consultation` (POST/GET/confirmer/annuler) : côté ADHÉRENT.
 * `codes-consultation/valider` : côté ÉTABLISSEMENT — c'est la SEULE voie
 * d'ouverture d'un dossier de soins.
 */
@Controller('preauthorization')
@UseGuards(SupabaseAuthGuard)
export class PreauthorizationController {
  constructor(private readonly preauth: PreauthorizationService) {}

  @Post('codes-consultation')
  generer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenererCodeConsultationDto,
  ) {
    return this.preauth.genererCodeConsultation(user, dto);
  }

  /** Côté ADHÉRENT : cumul (nombre, coût, parts) des consultations filtrées. */
  @Get('codes-consultation/recapitulatif')
  recapitulatifMesCodes(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesCodesConsultationQueryDto) {
    return this.preauth.recapitulatifMesCodes(user, dto);
  }

  @Get('codes-consultation')
  listerMesCodes(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesCodesConsultationQueryDto) {
    return this.preauth.listerMesCodes(user, dto);
  }

  @Post('codes-consultation/valider')
  valider(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeConsultationDto,
  ) {
    return this.preauth.validerCodeConsultation(user, dto);
  }

  @Post('codes-consultation/:id/confirmer')
  confirmer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.confirmerPresence(user, id);
  }

  @Post('codes-consultation/:id/annuler')
  annuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.annulerCode(user, id);
  }

  // --- Code Référence d'Ordonnance (v8 §3) --------------------------

  /** Côté MÉDECIN : établit l'ordonnance + génère le code (non renvoyé ici). */
  @Post('ordonnances')
  creerOrdonnance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerOrdonnanceDto,
  ) {
    return this.preauth.creerOrdonnance(user, dto);
  }

  /** Côté ADHÉRENT : cumul (nombre, coût, parts) des ordonnances filtrées. */
  @Get('codes-ordonnance/recapitulatif')
  recapitulatifMesCodesOrdonnance(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesCodesOrdonnanceQueryDto) {
    return this.preauth.recapitulatifMesCodesOrdonnance(user, dto);
  }

  /** Côté ADHÉRENT : ses codes d'ordonnance (avec la valeur du code). */
  @Get('codes-ordonnance')
  mesCodesOrdonnance(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesCodesOrdonnanceQueryDto) {
    return this.preauth.listerMesCodesOrdonnance(user, dto);
  }

  /** Côté PHARMACIE : historique des codes pris en charge par SA pharmacie. */
  @Get('codes-ordonnance/pharmacie')
  mesCodesOrdonnancePharmacie(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerCodesOrdonnancePharmacie(user);
  }

  /** Côté PHARMACIE : saisie du code → révèle le contenu de l'ordonnance. */
  @Post('codes-ordonnance/valider')
  validerOrdonnance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeOrdonnanceDto,
  ) {
    return this.preauth.validerCodeOrdonnance(user, dto);
  }

  /** Côté PHARMACIE : dispensation partielle ou complète, après coup. */
  @Post('codes-ordonnance/:id/dispensation')
  dispensation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispensationDto,
  ) {
    return this.preauth.marquerDispensation(user, id, dto);
  }

  // --- Tâche planifiée (déclenchée à la main) -----------------------

  /** Réservé à ASSUREUR_INFORMATIQUE — même pattern que reverifier-obsoletes (PROMPT 15). */
  @Post('codes-ordonnance/expirer-obsoletes')
  expirerOrdonnancesObsoletes(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.expirerOrdonnancesObsoletes(user);
  }

  // --- Ticket de Soins (v8 §4) -------------------------------------
  // Le ticket est créé / clôturé AUTOMATIQUEMENT avec le dossier de soins ;
  // il n'existe pas de route pour le créer ou le clôturer manuellement.

  @Get('tickets-soins/:id')
  obtenirTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.obtenirTicket(user, id);
  }

  @Post('tickets-soins/:id/actes')
  ajouterActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjouterActeDto,
  ) {
    return this.preauth.ajouterActe(user, id, dto);
  }

  /**
   * Côté MÉDECIN CONSEIL exclusivement : débloque, une seule fois, la règle
   * anti-répétition (14 jours) pour un acte ANALYSES_EXAMENS_MEDICAUX précis
   * sur ce ticket — à réessayer ensuite via `POST tickets-soins/:id/actes`.
   */
  @Post('tickets-soins/:id/actes/autoriser-repetition')
  autoriserRepetition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoriserRepetitionDto,
  ) {
    return this.preauth.autoriserRepetition(user, id, dto);
  }

  /**
   * Côté MÉDECIN CONSEIL exclusivement : débloque, une seule fois, la règle
   * de fréquence des consultations (14 jours) pour un type de visite précis
   * (généraliste ou spécialiste) sur ce ticket — à réessayer ensuite via
   * `POST tickets-soins/:id/actes`.
   */
  @Post('tickets-soins/:id/actes/autoriser-repetition-consultation')
  autoriserRepetitionConsultation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoriserRepetitionConsultationDto,
  ) {
    return this.preauth.autoriserRepetitionConsultation(user, id, dto);
  }

  /**
   * Côté MÉDECIN TRAITANT exclusivement (CENTRE_MEDICAL_MEDECIN) : atteste
   * qu'un acte prescrit a été effectué — condition pour qu'il soit facturable.
   */
  @Post('actes/:id/realiser')
  marquerActeRealise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarquerActeRealiseDto,
  ) {
    return this.preauth.marquerActeRealise(user, id, dto);
  }

  // --- Pré-autorisation obligatoire (analyses/examens médicaux) -----

  /** Côté MÉDECIN CONSEIL : file d'attente des actes à valider. */
  @Get('actes/en-attente-preautorisation')
  listerActesEnAttentePreautorisation(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerActesEnAttentePreautorisation(user);
  }

  /**
   * Côté MÉDECIN CONSEIL exclusivement : second niveau, APPROUVE/REFUSE un
   * acte ESCALADÉ par l'exploitation, avec motif audité.
   */
  @Post('actes/:id/preautorisation')
  validerPreautorisation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValiderPreautorisationDto,
  ) {
    return this.preauth.validerPreautorisation(user, id, dto);
  }

  /**
   * Côté ASSUREUR_EXPLOITATION(_CONJOINTE) : file complète du premier niveau
   * (propositions à traiter, escaladées en lecture seule, déjà tranchées).
   */
  @Get('actes/preautorisation-exploitation')
  listerActesPreautorisationExploitation(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerActesPreautorisationExploitation(user);
  }

  /**
   * Côté ASSUREUR_EXPLOITATION(_CONJOINTE) exclusivement : premier niveau —
   * APPROUVE/REFUSE (avec approbation partielle possible) ou ESCALADE_
   * MEDECIN_CONSEIL.
   */
  @Post('actes/:id/preautorisation-exploitation')
  traiterParExploitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TraiterParExploitationDto,
  ) {
    return this.preauth.traiterParExploitation(user, id, dto);
  }

  /**
   * ASSUREUR_EXPLOITATION(_CONJOINTE) ou MÉDECIN CONSEIL : annule une décision (approuvée / refusée) tant que l'acte n'est pas
   * réalisé ; l'acte revient en attente du niveau de l'appelant. Impossible dès que l'acte est réalisé.
   */
  @Post('actes/:id/annuler-decision-preautorisation')
  annulerDecisionPreautorisation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnulerDecisionPreautorisationDto,
  ) {
    return this.preauth.annulerDecisionPreautorisation(user, id, dto);
  }

  /**
   * Recherche d'un médicament dans la base HOMOLOGUÉE du système (dénomination, nom commercial ou code) — alimente la saisie des lignes
   * d'une ordonnance. **Aucun prix** n'est renvoyé : une prescription ne porte pas de montant.
   */
  @Get('medicaments/catalogue')
  rechercherMedicamentsCatalogue(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) {
    return this.preauth.rechercherMedicamentsCatalogue(user, q ?? '');
  }

  /**
   * Recherche d'un acte dans le référentiel HOMOLOGUÉ du système (libellé ou code) — alimente le champ « libellé de l'acte » du
   * formulaire d'ajout d'un acte de soins. Déclarée avant toute route `actes/:id`.
   */
  @Get('actes/catalogue')
  rechercherActesCatalogue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('categorie') categorie?: string,
    @Query('dossierId', new ParseUUIDPipe({ optional: true })) dossierId?: string,
  ) {
    return this.preauth.rechercherActesCatalogue(user, q ?? '', categorie ?? '', dossierId);
  }

  /** Tarif unitaire reconnu d'un acte du référentiel pour CE dossier (convention de son établissement) ; `null` s'il n'existe pas. */
  @Get('actes/tarif-reference')
  tarifReferenceActe(
    @CurrentUser() user: AuthenticatedUser,
    @Query('dossierId', ParseUUIDPipe) dossierId: string,
    @Query('codeActe') codeActe: string,
    @Query('categorieActe') categorieActe: string,
  ) {
    return this.preauth.tarifReferenceActe(user, dossierId, codeActe, categorieActe);
  }

  /** Côté ASSUREUR_EXPLOITATION(_CONJOINTE) : GrilleCartes de la vue d'ensemble. */
  @Get('actes/statistiques-exploitation')
  statistiquesExploitation(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.statistiquesExploitation(user);
  }

  // --- Code de Facturation (v8 §5) — facturation par sélection d'actes ---

  /**
   * Côté ASSUREUR/COMPTABLE : génère un cycle de facturation pour les actes
   * cochés (+ le code, non renvoyé ici). Plusieurs cycles successifs possibles
   * sur le même dossier — paiement partiel.
   */
  @Post('dossiers/:id/facture-selection')
  genererFactureSelection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenererFactureSelectionDto,
  ) {
    return this.preauth.genererFactureSelection(user, id, dto);
  }

  /** Côté ADHÉRENT : cumul (nombre, coût, parts) du périmètre filtré. */
  @Get('codes-facturation/recapitulatif')
  recapitulatifMesFactures(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesFacturesQueryDto) {
    return this.preauth.recapitulatifMesFactures(user, dto);
  }

  /** Côté ADHÉRENT : ses factures, avec le code de facturation et la synthèse. */
  @Get('codes-facturation')
  mesFactures(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListerMesFacturesQueryDto) {
    return this.preauth.listerMesFactures(user, dto);
  }

  /** Côté ADHÉRENT : valide le code de facturation (condition du règlement). */
  @Post('codes-facturation/valider')
  validerFacturation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeFacturationDto,
  ) {
    return this.preauth.validerCodeFacturation(user, dto);
  }

  @Get('factures/:id')
  obtenirFacture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.obtenirFacture(user, id);
  }

  /** Côté ASSUREUR_COMPTABLE : confirme le paiement — bloqué si code non validé. */
  @Post('factures/:id/confirmer-paiement')
  confirmerPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.confirmerPaiement(user, id);
  }

  // --- Consolidation mensuelle des factures établissement -------------

  /** Côté COMPTABLE/ADMINISTRATIF établissement : « Mes factures » (FactureDossier, filtres multicritères côté client). */
  @Get('factures-dossier/mes-factures')
  facturesDossierEtablissement(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerFacturesDossierEtablissement(user);
  }

  /** Côté COMPTABLE/ADMINISTRATIF établissement : vue d'ensemble des actes du mois en cours. */
  @Get('factures-mensuelles-etablissement/mois-en-cours')
  actesDuMoisEtablissement(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerActesDuMoisEtablissement(user);
  }

  /** Côté COMPTABLE/ADMINISTRATIF établissement : soumet la consolidation du mois précédent. */
  @Post('factures-mensuelles-etablissement')
  soumettreFactureMensuelleEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SoumettreFactureMensuelleEtablissementDto,
  ) {
    return this.preauth.soumettreFactureMensuelleEtablissement(user, dto);
  }

  /** Côté établissement : historique de SES factures mensuelles. */
  @Get('factures-mensuelles-etablissement/mes-factures')
  mesFacturesMensuellesEtablissement(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerMesFacturesMensuellesEtablissement(user);
  }

  /** Côté ASSUREUR_MEDECIN_CONSEIL exclusivement : « à vérifier » (SOUMISE). */
  @Get('factures-mensuelles-etablissement/a-verifier')
  facturesMensuellesEtablissementAVerifier(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerFacturesMensuellesEtablissementAVerifier(user);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : débloquées à partir de VERIFIEE_MEDECIN_CONSEIL. */
  @Get('factures-mensuelles-etablissement/pour-comptable')
  facturesMensuellesEtablissementPourComptable(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerFacturesMensuellesEtablissementPourComptable(user);
  }

  /** Détail ligne-par-ligne — verrou d'accès vérifié explicitement dans le service. */
  @Get('factures-mensuelles-etablissement/:id')
  obtenirFactureMensuelleEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.obtenirFactureMensuelleEtablissement(user, id);
  }

  /** Côté ASSUREUR_MEDECIN_CONSEIL exclusivement : vérification globale de fin de mois (VALIDEE/A_CORRIGER). */
  @Post('factures-mensuelles-etablissement/:id/verifier')
  verifierFactureMensuelleEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifierFactureMensuelleEtablissementDto,
  ) {
    return this.preauth.verifierFactureMensuelleEtablissement(user, id, dto);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : retire une ligne encore en litige. */
  @Post('factures-mensuelles-etablissement/:id/lignes/:ligneId/decocher')
  decocherLigneContesteeEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ligneId', ParseUUIDPipe) ligneId: string,
  ) {
    return this.preauth.decocherLigneContestee(user, id, ligneId);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : valide pour paiement (VERIFIEE_MEDECIN_CONSEIL → PROGRAMMEE_PAIEMENT), aucune ligne en litige non décochée. */
  @Post('factures-mensuelles-etablissement/:id/valider-pour-paiement')
  validerPourPaiementEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.validerPourPaiementEtablissement(user, id);
  }

  // Le paiement RÉEL (débit d'un compte financier) est désormais réservé à
  // `PaymentService.payerFacture` (module payment/, POST payment/payer-facture)
  // — l'ancien `marquerFactureMensuelleEtablissementPayee` (symbolique, ne
  // débitait jamais rien) a été retiré pour ne laisser aucun chemin de
  // paiement fictif actif à côté du paiement réel.
}
