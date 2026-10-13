import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_ACTIVATION_REFERENTIEL } from './reference.types';

export type TypeCatalogue = 'actes' | 'medicaments';
type Db = PrismaService | Prisma.TransactionClient;

interface Ctx {
  userId: string;
  organisationId: string;
  roleChain: string[];
}

/** Plafond d'une activation / désactivation par liste d'identifiants (« tout » passe par une seule requête SQL). */
export const LIMITE_ACTIVATION_MASSE = 200;

/**
 * CatalogueActivationService — le référentiel médical de l'assureur EST le catalogue national (ADR-009).
 *
 * Le contenu (acte : code, libellé, catégorie, cotation ; médicament : dénomination, dosage, forme…) vient du catalogue national, maintenu
 * par le superadmin ; l'assureur ne fait que l'ACTIVER ou le DÉSACTIVER pour son organisation — ASSUREUR_INFORMATIQUE, ASSUREUR_MEDECIN_CONSEIL
 * et ASSUREUR_PHARMACIEN_CONSEIL, pour les actes comme pour les médicaments. Seul un élément HOMOLOGUÉ au catalogue national s'active.
 *
 * La ligne de l'organisation (`referentiel_actes` / `medicaments`) est l'« activation » : statut HOMOLOGUE = actif, SUSPENDU = désactivé
 * (réversible), aucune ligne = jamais activé. Elle reste le point d'ancrage des conventions, tarifs, actes de soins et du registre des
 * dépendances (ADR-007) : rien n'est migré, seule l'origine du contenu change.
 */
@Injectable()
export class CatalogueActivationService {
  private readonly logger = new Logger(CatalogueActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Liste : catalogue national + état d'activation de l'organisation ----------------------------

  /** Éléments du catalogue national (hors retirés), chacun avec `activation` pour l'organisation de l'appelant. */
  async lister(user: AuthenticatedUser, type: TypeCatalogue, filtres: { statut?: string } = {}) {
    const ctx = await this.contexte(user);
    if (type === 'actes') {
      const [nationaux, locaux] = await Promise.all([
        this.prisma.referentielNationalActe.findMany({
          where: { deletedAt: null, ...(filtres.statut ? { statut: filtres.statut } : { statut: { not: 'RETIRE' } }) },
          orderBy: [{ categorie: 'asc' }, { libelle: 'asc' }],
        }),
        this.prisma.referentielActe.findMany({
          where: { organisationId: ctx.organisationId, deletedAt: null },
          select: { id: true, code: true, statut: true, catalogueNationalId: true, dateHomologation: true },
        }),
      ]);
      const parNational = new Map(locaux.filter((l) => l.catalogueNationalId).map((l) => [l.catalogueNationalId as string, l]));
      const parCode = new Map(locaux.map((l) => [l.code, l]));
      return nationaux.map((n) => {
        const l = parNational.get(n.id) ?? parCode.get(n.code) ?? null;
        return { ...n, activation: { actif: l?.statut === 'HOMOLOGUE', statut: l?.statut ?? null, localId: l?.id ?? null, depuis: l?.dateHomologation ?? null } };
      });
    }
    const [nationaux, locaux] = await Promise.all([
      this.prisma.referentielNationalMedicament.findMany({
        where: { deletedAt: null, ...(filtres.statut ? { statutHomologation: filtres.statut } : { statutHomologation: { not: 'RETIRE' } }) },
        orderBy: [{ classeTherapeutique: 'asc' }, { denominationCommune: 'asc' }],
      }),
      this.prisma.medicament.findMany({
        where: { organisationId: ctx.organisationId, deletedAt: null },
        select: { id: true, statutHomologation: true, catalogueNationalId: true, dateHomologation: true, denominationCommune: true, dosage: true },
      }),
    ]);
    const parNational = new Map(locaux.filter((l) => l.catalogueNationalId).map((l) => [l.catalogueNationalId as string, l]));
    return nationaux.map((n) => {
      const l = parNational.get(n.id) ?? null;
      return {
        ...n,
        activation: { actif: l?.statutHomologation === 'HOMOLOGUE', statut: l?.statutHomologation ?? null, localId: l?.id ?? null, depuis: l?.dateHomologation ?? null },
      };
    });
  }

  // --- Activer / désactiver un élément -----------------------------------------------------------

  async activer(user: AuthenticatedUser, type: TypeCatalogue, itemId: string) {
    const ctx = await this.contexte(user);
    this.assertRole(ctx);
    return type === 'actes' ? this.activerActe(user, ctx, itemId) : this.activerMedicament(user, ctx, itemId);
  }

  async desactiver(user: AuthenticatedUser, type: TypeCatalogue, itemId: string, motif?: string) {
    const ctx = await this.contexte(user);
    this.assertRole(ctx);
    return type === 'actes' ? this.desactiverActe(ctx, itemId, motif) : this.desactiverMedicament(ctx, itemId, motif);
  }

  private async activerActe(user: AuthenticatedUser, ctx: Ctx, itemId: string) {
    const n = await this.prisma.referentielNationalActe.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!n) throw new NotFoundException('Acte introuvable dans le catalogue national.');
    if (n.statut !== 'HOMOLOGUE') {
      throw new ConflictException(`Seul un acte HOMOLOGUÉ au catalogue national peut être activé (statut national : ${n.statut}).`);
    }
    const existant =
      (await this.prisma.referentielActe.findFirst({ where: { organisationId: ctx.organisationId, catalogueNationalId: n.id, deletedAt: null } })) ??
      (await this.prisma.referentielActe.findFirst({ where: { organisationId: ctx.organisationId, code: n.code, deletedAt: null } }));
    if (existant?.statut === 'HOMOLOGUE') throw new ConflictException(`L'acte « ${n.code} » est déjà actif.`);
    if (existant?.statut === 'RETIRE') await this.dependances.assertPossible(user, 'referentielActe', existant.id, 'desarchiver');

    const contenu = {
      code: n.code,
      libelle: n.libelle,
      categorie: n.categorie,
      versionNomenclature: n.versionNomenclature,
      lettreCleCode: n.lettreCleCode,
      coefficient: n.coefficient,
      modeCotation: n.modeCotation,
      categorieGarantie: n.categorieGarantie,
      groupeCode: n.groupeCode,
      catalogueNationalId: n.id,
      statut: 'HOMOLOGUE',
      homologuePar: ctx.userId,
      dateHomologation: new Date(),
      dateRetrait: null,
    };
    const id = await this.prisma.$transaction(async (tx) => {
      const ligne = existant
        ? await tx.referentielActe.update({ where: { id: existant.id }, data: contenu })
        : await tx.referentielActe.create({ data: { organisationId: ctx.organisationId, ...contenu } });
      await this.audit(tx, ctx.userId, 'ACTIVATION_ACTE_CATALOGUE_NATIONAL', ligne.id, { code: n.code, catalogueNationalId: n.id }, 'referentiel_actes');
      return ligne.id;
    });
    return { type: 'actes' as const, localId: id, actif: true };
  }

  private async desactiverActe(ctx: Ctx, itemId: string, motif?: string) {
    const ligne = await this.prisma.referentielActe.findFirst({
      where: { organisationId: ctx.organisationId, catalogueNationalId: itemId, deletedAt: null },
    });
    if (!ligne || ligne.statut !== 'HOMOLOGUE') throw new ConflictException("Cet acte n'est pas actif : rien à désactiver.");
    await this.prisma.$transaction(async (tx) => {
      await tx.referentielActe.update({ where: { id: ligne.id }, data: { statut: 'SUSPENDU' } });
      await this.audit(tx, ctx.userId, 'DESACTIVATION_ACTE_CATALOGUE_NATIONAL', ligne.id, { code: ligne.code, motif: motif ?? null }, 'referentiel_actes');
    });
    return { type: 'actes' as const, localId: ligne.id, actif: false };
  }

  private async activerMedicament(user: AuthenticatedUser, ctx: Ctx, itemId: string) {
    const n = await this.prisma.referentielNationalMedicament.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!n) throw new NotFoundException('Médicament introuvable dans le catalogue national.');
    if (n.statutHomologation !== 'HOMOLOGUE') {
      throw new ConflictException(`Seul un médicament HOMOLOGUÉ au catalogue national peut être activé (statut national : ${n.statutHomologation}).`);
    }
    const existant = await this.prisma.medicament.findFirst({
      where: { organisationId: ctx.organisationId, catalogueNationalId: n.id, deletedAt: null },
    });
    if (existant?.statutHomologation === 'HOMOLOGUE') {
      throw new ConflictException(`« ${n.denominationCommune}${n.dosage ? ` ${n.dosage}` : ''} » est déjà actif.`);
    }
    if (existant?.statutHomologation === 'RETIRE') await this.dependances.assertPossible(user, 'medicament', existant.id, 'desarchiver');

    const contenu = {
      denominationCommune: n.denominationCommune,
      nomCommercial: n.nomCommercial,
      codeEan: n.codeEan,
      forme: n.forme,
      dosage: n.dosage,
      conditionnement: n.conditionnement,
      classeTherapeutique: n.classeTherapeutique,
      remboursable: n.remboursable,
      tauxRemboursementStd: n.tauxRemboursementStd,
      prixReferenceXof: n.prixReferenceXof,
      prixMaxRemboursable: n.prixMaxRemboursable,
      medicamentEssentiel: n.medicamentEssentiel,
      generiqueDisponible: n.generiqueDisponible,
      ordonnanceObligatoire: n.ordonnanceObligatoire,
      medicamentControle: n.medicamentControle,
      usage: n.usage,
      catalogueNationalId: n.id,
      statutHomologation: 'HOMOLOGUE',
      homologuePar: ctx.userId,
      dateHomologation: new Date(),
      dateRetrait: null,
    };
    const id = await this.prisma.$transaction(async (tx) => {
      const ligne = existant
        ? await tx.medicament.update({ where: { id: existant.id }, data: contenu })
        : await tx.medicament.create({ data: { organisationId: ctx.organisationId, ...contenu } });
      await this.audit(tx, ctx.userId, 'ACTIVATION_MEDICAMENT_CATALOGUE_NATIONAL', ligne.id, { dci: n.denominationCommune, catalogueNationalId: n.id }, 'medicaments');
      return ligne.id;
    });
    return { type: 'medicaments' as const, localId: id, actif: true };
  }

  private async desactiverMedicament(ctx: Ctx, itemId: string, motif?: string) {
    const ligne = await this.prisma.medicament.findFirst({
      where: { organisationId: ctx.organisationId, catalogueNationalId: itemId, deletedAt: null },
    });
    if (!ligne || ligne.statutHomologation !== 'HOMOLOGUE') throw new ConflictException("Ce médicament n'est pas actif : rien à désactiver.");
    await this.prisma.$transaction(async (tx) => {
      await tx.medicament.update({ where: { id: ligne.id }, data: { statutHomologation: 'SUSPENDU' } });
      await this.audit(tx, ctx.userId, 'DESACTIVATION_MEDICAMENT_CATALOGUE_NATIONAL', ligne.id, { dci: ligne.denominationCommune, motif: motif ?? null }, 'medicaments');
    });
    return { type: 'medicaments' as const, localId: ligne.id, actif: false };
  }

  // --- Activation / désactivation en masse -------------------------------------------------------

  /**
   * `ids` (au plus {@link LIMITE_ACTIVATION_MASSE}) : élément par élément, résultat partiel détaillé (un refus n'arrête pas le lot).
   * `tous` : TOUT le catalogue homologué en une seule transaction SQL (activer) ou tout ce qui est actif (désactiver) — indispensable pour un
   * catalogue de plusieurs centaines d'éléments. Les éléments RETIRÉS (archivés, ADR-007) ne sont jamais réactivés en bloc.
   */
  async activationMasse(user: AuthenticatedUser, type: TypeCatalogue, dto: { ids?: string[]; tous?: boolean; actif: boolean }) {
    const ctx = await this.contexte(user);
    this.assertRole(ctx);
    if (dto.tous && dto.ids?.length) throw new BadRequestException('Indiquez des identifiants OU « tous », pas les deux.');
    if (!dto.tous && !dto.ids?.length) throw new BadRequestException('Aucun élément sélectionné.');

    if (dto.tous) {
      const nb = await this.prisma.$transaction(async (tx) => (type === 'actes' ? this.toutActes(tx, ctx, dto.actif) : this.toutMedicaments(tx, ctx, dto.actif)));
      await this.audit(
        this.prisma,
        ctx.userId,
        dto.actif ? 'ACTIVATION_MASSE_CATALOGUE_NATIONAL' : 'DESACTIVATION_MASSE_CATALOGUE_NATIONAL',
        ctx.organisationId,
        { type, nombre: nb, tous: true },
        type === 'actes' ? 'referentiel_actes' : 'medicaments',
      );
      return { reussis: nb, refuses: [] as { id: string; raison: string }[] };
    }

    const ids = [...new Set(dto.ids)];
    if (ids.length > LIMITE_ACTIVATION_MASSE) {
      throw new BadRequestException(`Au plus ${LIMITE_ACTIVATION_MASSE} éléments par lot (reçu : ${ids.length}).`);
    }
    const refuses: { id: string; raison: string }[] = [];
    let reussis = 0;
    for (const id of ids) {
      try {
        if (dto.actif) await this.activer(user, type, id);
        else await this.desactiver(user, type, id);
        reussis++;
      } catch (e) {
        refuses.push({ id, raison: e instanceof Error ? e.message : 'Erreur technique.' });
      }
    }
    return { reussis, refuses };
  }

  private async toutActes(tx: Prisma.TransactionClient, ctx: Ctx, actif: boolean): Promise<number> {
    if (!actif) {
      return tx.$executeRaw`
        UPDATE referentiel_actes SET statut = 'SUSPENDU', updated_at = now()
         WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL AND statut = 'HOMOLOGUE' AND catalogue_national_id IS NOT NULL`;
    }
    // 1) rattache les lignes d'avant le lien (même code), 2) réactive les lignes liées non retirées, 3) crée les lignes manquantes
    await tx.$executeRaw`
      UPDATE referentiel_actes r SET catalogue_national_id = n.id
        FROM referentiel_national_actes n
       WHERE r.organisation_id = ${ctx.organisationId}::uuid AND r.deleted_at IS NULL AND r.catalogue_national_id IS NULL
         AND n.deleted_at IS NULL AND n.code = r.code`;
    const reactives = await tx.$executeRaw`
      UPDATE referentiel_actes r
         SET statut = 'HOMOLOGUE', homologue_par = ${ctx.userId}::uuid, date_homologation = now(), date_retrait = NULL, updated_at = now()
        FROM referentiel_national_actes n
       WHERE r.organisation_id = ${ctx.organisationId}::uuid AND r.deleted_at IS NULL AND r.catalogue_national_id = n.id
         AND n.deleted_at IS NULL AND n.statut = 'HOMOLOGUE' AND r.statut IN ('SUSPENDU', 'PROPOSE')`;
    const crees = await tx.$executeRaw`
      INSERT INTO referentiel_actes (organisation_id, code, libelle, categorie, version_nomenclature, statut, homologue_par, date_homologation,
                                     lettre_cle_code, coefficient, mode_cotation, categorie_garantie, groupe_code, catalogue_national_id)
      SELECT ${ctx.organisationId}::uuid, n.code, n.libelle, n.categorie, n.version_nomenclature, 'HOMOLOGUE', ${ctx.userId}::uuid, now(),
             n.lettre_cle_code, n.coefficient, n.mode_cotation, n.categorie_garantie, n.groupe_code, n.id
        FROM referentiel_national_actes n
       WHERE n.deleted_at IS NULL AND n.statut = 'HOMOLOGUE'
         AND NOT EXISTS (SELECT 1 FROM referentiel_actes r
                          WHERE r.organisation_id = ${ctx.organisationId}::uuid AND r.deleted_at IS NULL
                            AND (r.catalogue_national_id = n.id OR r.code = n.code))`;
    return reactives + crees;
  }

  private async toutMedicaments(tx: Prisma.TransactionClient, ctx: Ctx, actif: boolean): Promise<number> {
    if (!actif) {
      return tx.$executeRaw`
        UPDATE medicaments SET statut_homologation = 'SUSPENDU', updated_at = now()
         WHERE organisation_id = ${ctx.organisationId}::uuid AND deleted_at IS NULL AND statut_homologation = 'HOMOLOGUE' AND catalogue_national_id IS NOT NULL`;
    }
    const reactives = await tx.$executeRaw`
      UPDATE medicaments m
         SET statut_homologation = 'HOMOLOGUE', homologue_par = ${ctx.userId}::uuid, date_homologation = now(), date_retrait = NULL, updated_at = now()
        FROM referentiel_national_medicaments n
       WHERE m.organisation_id = ${ctx.organisationId}::uuid AND m.deleted_at IS NULL AND m.catalogue_national_id = n.id
         AND n.deleted_at IS NULL AND n.statut_homologation = 'HOMOLOGUE' AND m.statut_homologation IN ('SUSPENDU', 'PROPOSE')`;
    const crees = await tx.$executeRaw`
      INSERT INTO medicaments (organisation_id, denomination_commune, nom_commercial, code_ean, forme, dosage, conditionnement, classe_therapeutique,
                               remboursable, taux_remboursement_std, prix_reference_xof, prix_max_remboursable, medicament_essentiel,
                               generique_disponible, ordonnance_obligatoire, medicament_controle, usage, statut_homologation, homologue_par,
                               date_homologation, catalogue_national_id)
      SELECT ${ctx.organisationId}::uuid, n.denomination_commune, n.nom_commercial, n.code_ean, n.forme, n.dosage, n.conditionnement, n.classe_therapeutique,
             n.remboursable, n.taux_remboursement_std, n.prix_reference_xof, n.prix_max_remboursable, n.medicament_essentiel,
             n.generique_disponible, n.ordonnance_obligatoire, n.medicament_controle, n.usage, 'HOMOLOGUE', ${ctx.userId}::uuid,
             now(), n.id
        FROM referentiel_national_medicaments n
       WHERE n.deleted_at IS NULL AND n.statut_homologation = 'HOMOLOGUE'
         AND NOT EXISTS (SELECT 1 FROM medicaments m
                          WHERE m.organisation_id = ${ctx.organisationId}::uuid AND m.deleted_at IS NULL AND m.catalogue_national_id = n.id)`;
    return reactives + crees;
  }

  // --- Gardes / aides ----------------------------------------------------------------------------

  private assertRole(ctx: Ctx): void {
    if (!ctx.roleChain.some((r) => (ROLES_ACTIVATION_REFERENTIEL as readonly string[]).includes(r))) {
      throw new ForbiddenException(
        'L’activation du référentiel médical est réservée à l’assureur : informatique, médecin conseil ou pharmacien conseil.',
      );
    }
  }

  private async contexte(user: AuthenticatedUser): Promise<Ctx> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    return { userId: profil.id, organisationId: profil.organisationId, roleChain: permissions?.roleChain ?? [] };
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(db: Db, userId: string, action: string, enregistrementId: string, details: Prisma.InputJsonValue, tableCible: string): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(${action}::text, ${tableCible}::text, ${enregistrementId}::uuid, ${userId}::uuid, ${JSON.stringify(details)}::jsonb)`;
    } catch (error) {
      this.logger.error(`Échec log_audit(${action}, ${enregistrementId}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    }
  }
}
