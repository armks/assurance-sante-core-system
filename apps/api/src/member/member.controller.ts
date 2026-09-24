import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import {
  ChangerStatutDto,
  CreateAdherentDto,
  CreateBeneficiaireDto,
  ProposerAdherentDto,
  ProposerBeneficiaireDto,
  ProposerSortantsDto,
  UpdateAdherentDto,
  UpdateBeneficiaireDto,
  ValiderSortantsDto,
} from './dto/member.dto';
import { ImportAdherentsService, type FichierTeleverse } from './import-adherents.service';

/**
 * Endpoints REST du module member — fichier des membres (v9 phase 3, PROMPT 12).
 * Lecture ouverte à l'organisation (et à l'adhérent lui-même via RLS) ; écriture
 * réservée au personnel ASSUREUR habilité + SOCIETE_ADMINISTRATION (vérifié dans
 * AdherentService, en plus des policies RLS Postgres).
 */
@Controller('member')
@UseGuards(SupabaseAuthGuard)
export class MemberController {
  constructor(
    private readonly adherents: AdherentService,
    private readonly cartes: MemberCarteService,
    private readonly imports: ImportAdherentsService,
  ) {}

  // --- Identification par numéro de carte (accueil centre médical) -----

  /**
   * ADDITIF au code de consultation (ne le remplace pas) — purement informatif,
   * réservé à CENTRE_MEDICAL_ACCUEIL. N'ouvre aucun dossier, ne crée rien.
   */
  @Get('recherche-carte')
  rechercherParNumeroCarte(
    @CurrentUser() user: AuthenticatedUser,
    @Query('numeroCarte') numeroCarte: string,
  ) {
    return this.adherents.rechercherParNumeroCarte(user, numeroCarte);
  }

  // --- Adhérents ---------------------------------------------------

  @Post('adherents')
  creerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdherentDto,
  ) {
    return this.adherents.creerAdherent(user, dto);
  }

  @Get('adherents')
  listerAdherents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('souscripteurId') souscripteurId?: string,
    @Query('q') q?: string,
  ) {
    return this.adherents.listerAdherents(user, { statut, souscripteurId, q });
  }

  @Get('adherents/:id')
  obtenirAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.obtenirAdherent(user, id);
  }

  @Patch('adherents/:id')
  modifierAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdherentDto,
  ) {
    return this.adherents.modifierAdherent(user, id, dto);
  }

  @Patch('adherents/:id/statut')
  changerStatutAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangerStatutDto,
  ) {
    return this.adherents.changerStatutAdherent(user, id, dto);
  }

  /** Réservé EXCLUSIVEMENT à ASSUREUR_EXPLOITATION — gouverne la coupure de
   * facturation mensuelle (billing/). */
  @Post('adherents/:id/valider')
  validerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.validerAdherent(user, id);
  }

  @Delete('adherents/:id')
  @HttpCode(204)
  supprimerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.supprimerAdherent(user, id);
  }

  // --- Cartes de membre (PROMPT 13) -----------------------------

  @Post('adherents/:id/carte')
  genererCarteAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cartes.genererCarteAdherent(user, id);
  }

  @Post('souscripteurs/:souscripteurId/cartes')
  genererCartesSouscripteur(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
  ) {
    return this.cartes.genererCartesSouscripteur(user, souscripteurId);
  }

  // --- Bénéficiaires ----------------------------------------------

  @Post('adherents/:id/beneficiaires')
  ajouterBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBeneficiaireDto,
  ) {
    return this.adherents.ajouterBeneficiaire(user, id, dto);
  }

  @Get('adherents/:id/beneficiaires')
  listerBeneficiaires(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.listerBeneficiaires(user, id);
  }

  @Patch('adherents/:id/beneficiaires/:beneficiaireId')
  modifierBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @Body() dto: UpdateBeneficiaireDto,
  ) {
    return this.adherents.modifierBeneficiaire(user, id, beneficiaireId, dto);
  }

  @Patch('adherents/:id/beneficiaires/:beneficiaireId/statut')
  changerStatutBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @Body() dto: ChangerStatutDto,
  ) {
    return this.adherents.changerStatutBeneficiaire(
      user,
      id,
      beneficiaireId,
      dto,
    );
  }

  @Post('adherents/:id/beneficiaires/:beneficiaireId/carte')
  genererCarteBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.cartes.genererCarteBeneficiaire(user, id, beneficiaireId);
  }

  @Delete('adherents/:id/beneficiaires/:beneficiaireId')
  @HttpCode(204)
  supprimerBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.adherents.supprimerBeneficiaire(user, id, beneficiaireId);
  }

  // --- Import en masse depuis Excel (réservé ASSUREUR_INFORMATIQUE/
  // ASSUREUR_COMPTABLE ; validation réservée ASSUREUR_INFORMATIQUE/
  // ASSUREUR_EXPLOITATION) ------------------------------------------

  @Post('souscripteurs/:souscripteurId/imports-adherents')
  @UseInterceptors(FileInterceptor('fichier'))
  importerAdherentsExcel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.imports.importerAdherentsExcel(user, souscripteurId, fichier);
  }

  @Get('imports-adherents')
  listerImportsAdherents(@CurrentUser() user: AuthenticatedUser) {
    return this.imports.listerImportsAdherents(user);
  }

  @Post('imports-adherents/:id/valider')
  validerImportAdherents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.validerImportAdherents(user, id);
  }

  // --- Propositions collaboratives société (réservé SOCIETE_ASSUREE/
  // SOCIETE_ADMINISTRATION, pour leur propre société) — même circuit de
  // validation que l'import Excel une fois soumises. ------------------

  @Get('souscripteurs/:souscripteurId/brouillon-adherents')
  obtenirBrouillonSociete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
  ) {
    return this.imports.obtenirBrouillonSociete(user, souscripteurId);
  }

  @Post('souscripteurs/:souscripteurId/propositions/adherent')
  proposerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @Body() dto: ProposerAdherentDto,
  ) {
    return this.imports.proposerAdherent(user, souscripteurId, dto);
  }

  @Post('souscripteurs/:souscripteurId/propositions/beneficiaire')
  proposerBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @Body() dto: ProposerBeneficiaireDto,
  ) {
    return this.imports.proposerBeneficiaire(user, souscripteurId, dto);
  }

  @Patch('imports-adherents/:id/propositions/adherent/:index')
  modifierPropositionAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index') index: string,
    @Body() dto: ProposerAdherentDto,
  ) {
    return this.imports.modifierPropositionAdherent(user, id, Number(index), dto);
  }

  @Patch('imports-adherents/:id/propositions/beneficiaire/:index')
  modifierPropositionBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index') index: string,
    @Body() dto: ProposerBeneficiaireDto,
  ) {
    return this.imports.modifierPropositionBeneficiaire(user, id, Number(index), dto);
  }

  @Delete('imports-adherents/:id/propositions/:index')
  supprimerProposition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index') index: string,
  ) {
    return this.imports.supprimerProposition(user, id, Number(index));
  }

  @Post('imports-adherents/:id/soumettre')
  soumettrePourValidation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.soumettrePourValidation(user, id);
  }

  // --- Bénéficiaires proposés par l'ADHÉRENT lui-même (double validation
  // SOCIETE_ADMINISTRATION puis ASSUREUR_INFORMATIQUE/EXPLOITATION avant
  // génération du numero_carte) + photo de profil (sans validation). --------

  @Post('adherents/:id/beneficiaires/proposition')
  proposerMonBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBeneficiaireDto,
  ) {
    return this.adherents.proposerMonBeneficiaire(user, dto);
  }

  @Patch('adherents/:id/beneficiaires/:beneficiaireId/proposition')
  modifierMonBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @Body() dto: UpdateBeneficiaireDto,
  ) {
    return this.adherents.modifierMonBeneficiaire(user, beneficiaireId, dto);
  }

  @Post('beneficiaires/:beneficiaireId/valider-societe')
  validerBeneficiaireSociete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.adherents.validerBeneficiaireSociete(user, beneficiaireId);
  }

  @Post('beneficiaires/:beneficiaireId/valider-assureur')
  validerBeneficiaireAssureur(
    @CurrentUser() user: AuthenticatedUser,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.adherents.validerBeneficiaireAssureur(user, beneficiaireId);
  }

  @Post('adherents/:id/photo')
  @UseInterceptors(FileInterceptor('photo'))
  televerserPhotoAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.adherents.televerserPhotoAdherent(user, id, fichier);
  }

  @Get('adherents/:id/photo')
  obtenirPhotoAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.obtenirPhotoAdherent(user, id);
  }

  @Post('adherents/:id/beneficiaires/:beneficiaireId/photo')
  @UseInterceptors(FileInterceptor('photo'))
  televerserPhotoBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.adherents.televerserPhotoBeneficiaire(user, id, beneficiaireId, fichier);
  }

  @Get('adherents/:id/beneficiaires/:beneficiaireId/photo')
  obtenirPhotoBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.adherents.obtenirPhotoBeneficiaire(user, id, beneficiaireId);
  }

  // --- Mouvements de personnel — sortants (réservé SOCIETE_ADMINISTRATION
  // pour la proposition, ASSUREUR_INFORMATIQUE/EXPLOITATION pour la
  // validation) et entrants à effet différé (imports-entrants ci-dessous).
  // Chemin top-level `sortants/...` (jamais `adherents/sortants/...`) : ce
  // dernier serait masqué par le pattern générique `adherents/:id/valider`
  // déjà enregistré plus haut (Express/Nest matchent dans l'ordre
  // d'enregistrement — `:id` capturerait littéralement "sortants"). ---------

  @Post('sortants/proposer')
  proposerSortants(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposerSortantsDto,
  ) {
    return this.adherents.proposerSortants(user, dto);
  }

  @Post('sortants/valider')
  validerSortants(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderSortantsDto,
  ) {
    return this.adherents.validerSortants(user, dto);
  }

  @Post('souscripteurs/:souscripteurId/imports-sortants')
  @UseInterceptors(FileInterceptor('fichier'))
  importerSortantsExcel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.imports.importerSortantsExcel(user, souscripteurId, fichier);
  }

  @Post('souscripteurs/:souscripteurId/imports-entrants')
  @UseInterceptors(FileInterceptor('fichier'))
  importerEntrantsExcel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @UploadedFile() fichier: FichierTeleverse,
    @Body('moisEffet') moisEffet?: string,
  ) {
    return this.imports.importerEntrantsExcel(user, souscripteurId, fichier, moisEffet);
  }
}
