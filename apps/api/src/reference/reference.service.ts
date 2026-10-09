import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from './categories-acte.service';
import { DependancesService } from '../dependances/dependances.service';
import {
  HomologuerMedicamentDto,
  ProposerActeDto,
  ProposerMedicamentDto,
} from './dto/reference.dto';
import {
  ContexteAppelant,
  ROLE_HOMOLOGATION_ACTE,
  ROLE_HOMOLOGATION_MEDICAMENT,
  ROLE_PROPOSITION,
} from './reference.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * ReferenceService — référentiels médicaux : actes et médicaments, avec la
 * gouvernance d'homologation PROPOSE → HOMOLOGUE → SUSPENDU/RETIRE (v8 §10).
 *
 * RÈGLE CENTRALE (v8 §10.2) — le croisement doit rester étanche :
 *  - proposition / modification en PROPOSE : ASSUREUR_INFORMATIQUE ;
 *  - `HOMOLOGUE` d'un ACTE       : EXCLUSIVEMENT ASSUREUR_MEDECIN_CONSEIL ;
 *  - `HOMOLOGUE` d'un MÉDICAMENT : EXCLUSIVEMENT ASSUREUR_PHARMACIEN_CONSEIL.
 *  Aucun autre rôle (ni le mauvais rôle conseil) ne peut homologuer.
 *
 * Machine à états : on n'homologue QUE depuis PROPOSE (pas de saut d'étape —
 * un élément SUSPENDU/RETIRE doit d'abord être re-proposé). Même logique que la
 * machine à états des polices (PROMPT 9).
 *
 * Défense en profondeur : ces gardes doublent les policies RLS (prisma/sql/010)
 * — NestJS passe par `postgres` (pooler) et contourne la RLS.
 */
@Injectable()
export class ReferenceService {
  private readonly logger = new Logger(ReferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly categoriesActe: CategoriesActeService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Actes -------------------------------------------------------

  async proposerActe(user: AuthenticatedUser, dto: ProposerActeDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(ctx, ROLE_PROPOSITION, 'proposer un acte');
    await this.assertCodeActeLibre(ctx.organisationId, dto.code);
    // code ou libellé du référentiel unique (prisma/sql/067), jamais du texte libre
    const categorie = await this.categoriesActe.normaliser(dto.categorie);

    const id = await this.prisma.$transaction(async (tx) => {
      const acte = await tx.referentielActe.create({
        data: {
          organisationId: ctx.organisationId,
          code: dto.code,
          libelle: dto.libelle,
          categorie,
          categorieGarantie: categorie, // la catégorie validée est aussi la catégorie de garantie (prisma/sql/080)
          versionNomenclature: dto.versionNomenclature ?? null,
          statut: 'PROPOSE',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'PROPOSITION_ACTE',
        acte.id,
        { code: dto.code },
        'referentiel_actes',
      );
      return acte.id;
    });
    return this.chargerActe(ctx.organisationId, id);
  }

  async homologuerActe(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    // GARDE STRICTE : seul le médecin conseil homologue un acte.
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_ACTE,
      "Seul ASSUREUR_MEDECIN_CONSEIL peut homologuer un acte du référentiel.",
    );

    const acte = await this.chargerActe(ctx.organisationId, id);
    this.assertTransitionVersHomologue(acte.statut);

    await this.prisma.$transaction(async (tx) => {
      await tx.referentielActe.update({
        where: { id },
        data: {
          statut: 'HOMOLOGUE',
          homologuePar: ctx.userId,
          dateHomologation: new Date(),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'HOMOLOGATION_ACTE',
        id,
        { code: acte.code },
        'referentiel_actes',
      );
    });
    return this.chargerActe(ctx.organisationId, id);
  }

  async suspendreActe(user: AuthenticatedUser, id: string, motif?: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_ACTE,
      'Seul ASSUREUR_MEDECIN_CONSEIL peut suspendre un acte homologué.',
    );
    const acte = await this.chargerActe(ctx.organisationId, id);
    if (acte.statut !== 'HOMOLOGUE') {
      throw new ConflictException(
        `Seul un acte HOMOLOGUE peut être suspendu (statut actuel : ${acte.statut}).`,
      );
    }
    return this.changerStatutActe(ctx, id, 'SUSPENDU', 'SUSPENSION_ACTE', motif);
  }

  async retirerActe(user: AuthenticatedUser, id: string, motif?: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_ACTE,
      'Seul ASSUREUR_MEDECIN_CONSEIL peut retirer un acte.',
    );
    const acte = await this.chargerActe(ctx.organisationId, id);
    if (acte.statut === 'RETIRE') {
      throw new ConflictException('Cet acte est déjà retiré.');
    }
    await this.dependances.assertPossible(user, 'referentielActe', id, 'archiver');
    return this.changerStatutActe(ctx, id, 'RETIRE', 'RETRAIT_ACTE', motif, true);
  }

  /** Re-proposition d'un acte SUSPENDU/RETIRE → PROPOSE (préalable à ré-homologation). */
  async reproposerActe(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(ctx, ROLE_PROPOSITION, 'reproposer un acte');
    const acte = await this.chargerActe(ctx.organisationId, id);
    if (!['SUSPENDU', 'RETIRE'].includes(acte.statut)) {
      throw new ConflictException(
        `Seul un acte SUSPENDU ou RETIRE peut être re-proposé (statut actuel : ${acte.statut}).`,
      );
    }
    if (acte.statut === 'RETIRE') {
      await this.dependances.assertPossible(user, 'referentielActe', id, 'desarchiver');
    }
    return this.changerStatutActe(
      ctx,
      id,
      'PROPOSE',
      'REPROPOSITION_ACTE',
      undefined,
    );
  }

  /**
   * Suppression (logique) d'un acte jamais homologué et sans aucun lien (ADR-007) ;
   * réservée au service informatique (registre des dépendances). Le code redevient libre.
   */
  async supprimerActe(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    const acte = await this.chargerActe(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'referentielActe', id, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      await tx.referentielActe.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_ACTE', id, { code: acte.code, libelle: acte.libelle }, 'referentiel_actes');
    });
  }

  async listerActes(user: AuthenticatedUser, filtres: { statut?: string }) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.referentielActe.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
      },
      orderBy: [{ statut: 'asc' }, { libelle: 'asc' }],
    });
  }

  async obtenirActe(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerActe(ctx.organisationId, id);
  }

  // --- Médicaments ----------------------------------------------

  async proposerMedicament(
    user: AuthenticatedUser,
    dto: ProposerMedicamentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(ctx, ROLE_PROPOSITION, 'proposer un médicament');

    const id = await this.prisma.$transaction(async (tx) => {
      const m = await tx.medicament.create({
        data: {
          organisationId: ctx.organisationId,
          denominationCommune: dto.denominationCommune,
          nomCommercial: dto.nomCommercial ?? null,
          codeEan: dto.codeEan ?? null,
          forme: dto.forme ?? null,
          dosage: dto.dosage ?? null,
          conditionnement: dto.conditionnement ?? null,
          classeTherapeutique: dto.classeTherapeutique ?? null,
          remboursable: dto.remboursable ?? false,
          tauxRemboursementStd: this.dec(dto.tauxRemboursementStd),
          prixReferenceXof: this.dec(dto.prixReferenceXof),
          prixMaxRemboursable: this.dec(dto.prixMaxRemboursable),
          medicamentEssentiel: dto.medicamentEssentiel ?? false,
          generiqueDisponible: dto.generiqueDisponible ?? null,
          ordonnanceObligatoire: dto.ordonnanceObligatoire ?? true,
          medicamentControle: dto.medicamentControle ?? false,
          usage: dto.usage ?? null,
          statutHomologation: 'PROPOSE',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'PROPOSITION_MEDICAMENT',
        m.id,
        { dci: dto.denominationCommune },
        'medicaments',
      );
      return m.id;
    });
    return this.chargerMedicament(ctx.organisationId, id);
  }

  async homologuerMedicament(
    user: AuthenticatedUser,
    id: string,
    dto: HomologuerMedicamentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    // GARDE STRICTE : seul le pharmacien conseil homologue un médicament.
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_MEDICAMENT,
      'Seul ASSUREUR_PHARMACIEN_CONSEIL peut homologuer un médicament du référentiel.',
    );

    const m = await this.chargerMedicament(ctx.organisationId, id);
    this.assertTransitionVersHomologue(m.statutHomologation);

    await this.prisma.$transaction(async (tx) => {
      await tx.medicament.update({
        where: { id },
        data: {
          statutHomologation: 'HOMOLOGUE',
          homologuePar: ctx.userId,
          dateHomologation: new Date(),
          ...(dto.remboursable !== undefined
            ? { remboursable: dto.remboursable }
            : {}),
          ...(dto.tauxRemboursementStd !== undefined
            ? { tauxRemboursementStd: this.dec(dto.tauxRemboursementStd) }
            : {}),
          ...(dto.prixReferenceXof !== undefined
            ? { prixReferenceXof: this.dec(dto.prixReferenceXof) }
            : {}),
          ...(dto.prixMaxRemboursable !== undefined
            ? { prixMaxRemboursable: this.dec(dto.prixMaxRemboursable) }
            : {}),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'HOMOLOGATION_MEDICAMENT',
        id,
        { dci: m.denominationCommune, remboursable: dto.remboursable ?? m.remboursable },
        'medicaments',
      );
    });
    return this.chargerMedicament(ctx.organisationId, id);
  }

  async suspendreMedicament(
    user: AuthenticatedUser,
    id: string,
    motif?: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_MEDICAMENT,
      'Seul ASSUREUR_PHARMACIEN_CONSEIL peut suspendre un médicament homologué.',
    );
    const m = await this.chargerMedicament(ctx.organisationId, id);
    if (m.statutHomologation !== 'HOMOLOGUE') {
      throw new ConflictException(
        `Seul un médicament HOMOLOGUE peut être suspendu (statut actuel : ${m.statutHomologation}).`,
      );
    }
    return this.changerStatutMedicament(
      ctx,
      id,
      'SUSPENDU',
      'SUSPENSION_MEDICAMENT',
      motif,
    );
  }

  async retirerMedicament(user: AuthenticatedUser, id: string, motif?: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertRoleExclusif(
      ctx,
      ROLE_HOMOLOGATION_MEDICAMENT,
      'Seul ASSUREUR_PHARMACIEN_CONSEIL peut retirer un médicament.',
    );
    const m = await this.chargerMedicament(ctx.organisationId, id);
    if (m.statutHomologation === 'RETIRE') {
      throw new ConflictException('Ce médicament est déjà retiré.');
    }
    await this.dependances.assertPossible(user, 'medicament', id, 'archiver');
    return this.changerStatutMedicament(
      ctx,
      id,
      'RETIRE',
      'RETRAIT_MEDICAMENT',
      motif,
      true,
    );
  }

  async reproposerMedicament(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(ctx, ROLE_PROPOSITION, 'reproposer un médicament');
    const m = await this.chargerMedicament(ctx.organisationId, id);
    if (!['SUSPENDU', 'RETIRE'].includes(m.statutHomologation)) {
      throw new ConflictException(
        `Seul un médicament SUSPENDU ou RETIRE peut être re-proposé (statut actuel : ${m.statutHomologation}).`,
      );
    }
    if (m.statutHomologation === 'RETIRE') {
      await this.dependances.assertPossible(user, 'medicament', id, 'desarchiver');
    }
    return this.changerStatutMedicament(
      ctx,
      id,
      'PROPOSE',
      'REPROPOSITION_MEDICAMENT',
      undefined,
    );
  }

  /** Suppression (logique) d'un médicament jamais homologué et sans aucun lien (ADR-007). */
  async supprimerMedicament(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    const m = await this.chargerMedicament(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'medicament', id, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      await tx.medicament.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_MEDICAMENT', id, { denominationCommune: m.denominationCommune }, 'medicaments');
    });
  }

  async listerMedicaments(
    user: AuthenticatedUser,
    filtres: { statut?: string; essentiel?: boolean },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.medicament.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statutHomologation: filtres.statut } : {}),
        ...(filtres.essentiel !== undefined
          ? { medicamentEssentiel: filtres.essentiel }
          : {}),
      },
      orderBy: [{ statutHomologation: 'asc' }, { denominationCommune: 'asc' }],
    });
  }

  async obtenirMedicament(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerMedicament(ctx.organisationId, id);
  }

  // --- Catalogue national partagé (v1 §10.4, PROMPT 23) ---------

  /**
   * Import d'un acte du catalogue national vers le référentiel de l'organisation
   * de l'appelant, AU STATUT PROPOSE. Réservé à ASSUREUR_INFORMATIQUE — la règle
   * d'homologation reste inchangée : seul ASSUREUR_MEDECIN_CONSEIL de cette
   * organisation pourra ensuite l'homologuer.
   */
  async importerActeDepuisCatalogueNational(
    user: AuthenticatedUser,
    itemId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(ctx, ROLE_PROPOSITION, 'importer un acte du catalogue national');

    const national = await this.prisma.referentielNationalActe.findFirst({
      // un acte retiré (archivé) du catalogue national ne s'importe plus (ADR-007)
      where: { id: itemId, deletedAt: null, statut: { not: 'RETIRE' } },
    });
    if (!national) {
      throw new NotFoundException('Acte introuvable dans le catalogue national.');
    }
    const existe = await this.prisma.referentielActe.findFirst({
      where: { organisationId: ctx.organisationId, code: national.code, deletedAt: null },
    });
    if (existe) {
      throw new ConflictException(
        `L'acte « ${national.code} » est déjà présent dans votre référentiel (statut ${existe.statut}).`,
      );
    }
    // code unique PAR ORGANISATION (prisma/sql/080)
    await this.assertCodeActeLibre(ctx.organisationId, national.code);

    const id = await this.prisma.$transaction(async (tx) => {
      const acte = await tx.referentielActe.create({
        data: {
          organisationId: ctx.organisationId,
          code: national.code,
          libelle: national.libelle,
          categorie: national.categorie,
          versionNomenclature: national.versionNomenclature,
          statut: 'PROPOSE',
          // cotation du catalogue national (prisma/sql/080) : lettre-clé, coefficient, mode, garantie, groupe
          lettreCleCode: national.lettreCleCode,
          coefficient: national.coefficient,
          modeCotation: national.modeCotation,
          categorieGarantie: national.categorieGarantie,
          groupeCode: national.groupeCode,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'IMPORT_ACTE_CATALOGUE_NATIONAL',
        acte.id,
        { code: national.code, catalogueNationalId: national.id },
        'referentiel_actes',
      );
      return acte.id;
    });
    return this.chargerActe(ctx.organisationId, id);
  }

  /** Import d'un médicament du catalogue national → référentiel de l'organisation, statut PROPOSE. */
  async importerMedicamentDepuisCatalogueNational(
    user: AuthenticatedUser,
    itemId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertRole(
      ctx,
      ROLE_PROPOSITION,
      'importer un médicament du catalogue national',
    );

    const national = await this.prisma.referentielNationalMedicament.findFirst({
      where: { id: itemId, deletedAt: null, statutHomologation: { not: 'RETIRE' } },
    });
    if (!national) {
      throw new NotFoundException(
        'Médicament introuvable dans le catalogue national.',
      );
    }
    const existe = await this.prisma.medicament.findFirst({
      where: {
        organisationId: ctx.organisationId,
        denominationCommune: national.denominationCommune,
        dosage: national.dosage,
        deletedAt: null,
      },
    });
    if (existe) {
      throw new ConflictException(
        `« ${national.denominationCommune}${national.dosage ? ` ${national.dosage}` : ''} » est déjà présent dans votre référentiel (statut ${existe.statutHomologation}).`,
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const m = await tx.medicament.create({
        data: {
          organisationId: ctx.organisationId,
          denominationCommune: national.denominationCommune,
          nomCommercial: national.nomCommercial,
          codeEan: national.codeEan,
          forme: national.forme,
          dosage: national.dosage,
          conditionnement: national.conditionnement,
          classeTherapeutique: national.classeTherapeutique,
          remboursable: national.remboursable,
          tauxRemboursementStd: national.tauxRemboursementStd,
          prixReferenceXof: national.prixReferenceXof,
          prixMaxRemboursable: national.prixMaxRemboursable,
          medicamentEssentiel: national.medicamentEssentiel,
          generiqueDisponible: national.generiqueDisponible,
          ordonnanceObligatoire: national.ordonnanceObligatoire,
          medicamentControle: national.medicamentControle,
          usage: national.usage,
          statutHomologation: 'PROPOSE',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'IMPORT_MEDICAMENT_CATALOGUE_NATIONAL',
        m.id,
        {
          dci: national.denominationCommune,
          catalogueNationalId: national.id,
        },
        'medicaments',
      );
      return m.id;
    });
    return this.chargerMedicament(ctx.organisationId, id);
  }

  async listerCatalogueNationalActes(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    await this.contexteAppelant(user); // exige un profil rattaché à une organisation
    return this.prisma.referentielNationalActe.findMany({
      where: {
        deletedAt: null,
        // vue ORGANISATION : jamais les éléments retirés (archivés) du catalogue
        ...(filtres.statut ? { statut: filtres.statut } : { statut: { not: 'RETIRE' } }),
      },
      orderBy: [{ categorie: 'asc' }, { libelle: 'asc' }],
    });
  }

  async listerCatalogueNationalMedicaments(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    await this.contexteAppelant(user);
    return this.prisma.referentielNationalMedicament.findMany({
      where: {
        deletedAt: null,
        ...(filtres.statut ? { statutHomologation: filtres.statut } : { statutHomologation: { not: 'RETIRE' } }),
      },
      orderBy: [{ classeTherapeutique: 'asc' }, { denominationCommune: 'asc' }],
    });
  }

  // --- Gardes / helpers ----------------------------------------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucune organisation.",
      );
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertRole(
    ctx: ContexteAppelant,
    role: string,
    action: string,
  ): void {
    if (!ctx.roleChain.includes(role)) {
      throw new ForbiddenException(
        `Rôle insuffisant pour ${action} : ${role} requis.`,
      );
    }
  }

  /**
   * Garde d'homologation : le rôle attendu doit être présent. C'est ici que le
   * croisement est bloqué — un ASSUREUR_PHARMACIEN_CONSEIL sur un acte, ou un
   * ASSUREUR_MEDECIN_CONSEIL sur un médicament, échoue (403).
   */
  private assertRoleExclusif(
    ctx: ContexteAppelant,
    roleAttendu: string,
    message: string,
  ): void {
    if (!ctx.roleChain.includes(roleAttendu)) {
      throw new ForbiddenException(message);
    }
  }

  /** On n'homologue QUE depuis PROPOSE (pas de saut d'étape, v8 §10). */
  private assertTransitionVersHomologue(statutActuel: string): void {
    if (statutActuel === 'HOMOLOGUE') {
      throw new ConflictException('Cet élément est déjà homologué.');
    }
    if (statutActuel !== 'PROPOSE') {
      throw new ConflictException(
        `Impossible d'homologuer depuis le statut ${statutActuel} : il faut d'abord repasser par PROPOSE (re-proposition).`,
      );
    }
  }

  private async changerStatutActe(
    ctx: ContexteAppelant,
    id: string,
    statut: string,
    action: string,
    motif?: string,
    avecDateRetrait = false,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.referentielActe.update({
        where: { id },
        data: {
          statut,
          ...(avecDateRetrait ? { dateRetrait: new Date() } : {}),
          ...(statut === 'PROPOSE'
            ? { homologuePar: null, dateHomologation: null, dateRetrait: null }
            : {}),
        },
      });
      await this.audit(tx, ctx.userId, action, id, { motif: motif ?? null }, 'referentiel_actes');
    });
    return this.chargerActe(ctx.organisationId, id);
  }

  private async changerStatutMedicament(
    ctx: ContexteAppelant,
    id: string,
    statut: string,
    action: string,
    motif?: string,
    avecDateRetrait = false,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.medicament.update({
        where: { id },
        data: {
          statutHomologation: statut,
          ...(avecDateRetrait ? { dateRetrait: new Date() } : {}),
          ...(statut === 'PROPOSE'
            ? { homologuePar: null, dateHomologation: null, dateRetrait: null }
            : {}),
        },
      });
      await this.audit(tx, ctx.userId, action, id, { motif: motif ?? null }, 'medicaments');
    });
    return this.chargerMedicament(ctx.organisationId, id);
  }

  private async assertCodeActeLibre(organisationId: string, code: string): Promise<void> {
    // unique PAR ORGANISATION parmi les NON supprimés (index partiel, prisma/sql/080)
    const existe = (await this.prisma.referentielActe.count({ where: { organisationId, code, deletedAt: null } })) > 0;
    if (existe) {
      throw new ConflictException(`Le code d'acte « ${code} » existe déjà.`);
    }
  }

  private async chargerActe(organisationId: string, id: string) {
    const acte = await this.prisma.referentielActe.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!acte) {
      throw new NotFoundException('Acte introuvable.');
    }
    return acte;
  }

  private async chargerMedicament(organisationId: string, id: string) {
    const m = await this.prisma.medicament.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!m) {
      throw new NotFoundException('Médicament introuvable.');
    }
    return m;
  }

  private dec(v: number | undefined): string | null {
    return v === undefined || v === null ? null : new Decimal(v).toFixed(2);
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible: string,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${tableCible}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(
        `Échec log_audit(${action}, ${enregistrementId}) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      throw error;
    }
  }
}
