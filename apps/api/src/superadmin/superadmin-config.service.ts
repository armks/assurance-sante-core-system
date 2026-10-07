import {
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
import { CategoriesActeService } from '../reference/categories-acte.service';
import {
  CreerActeNationalDto,
  CreerMedicamentNationalDto,
  DefinirParametreDto,
} from './dto/superadmin-config.dto';
import { ROLE_SUPERADMIN } from './superadmin.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * SuperadminConfigService — panneau de configuration du SUPERADMIN_PRINCIPAL
 * (v1 §10.4, PROMPT 23) :
 *   1. `parametres_plateforme` (devises, pays/villes, taux de taxe, langues) ;
 *   2. tableau de bord santé du système (agrégations) ;
 *   3. catalogue national partagé (`referentiel_national_*`) — maintenu ici,
 *      importé côté `reference/` par ASSUREUR_INFORMATIQUE au statut PROPOSE.
 *
 * Toutes les méthodes exigent le rôle SUPERADMIN_PRINCIPAL (défense en
 * profondeur : les policies RLS l'exigent déjà).
 */
@Injectable()
export class SuperadminConfigService {
  private readonly logger = new Logger(SuperadminConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly categoriesActe: CategoriesActeService,
  ) {}

  // --- 1. Paramètres plateforme -------------------------------------

  async listerParametres(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    return this.prisma.parametrePlateforme.findMany({ orderBy: { cle: 'asc' } });
  }

  async obtenirParametre(user: AuthenticatedUser, cle: string) {
    await this.assertSuperadmin(user);
    const p = await this.prisma.parametrePlateforme.findUnique({ where: { cle } });
    if (!p) {
      throw new NotFoundException(`Paramètre « ${cle} » introuvable.`);
    }
    return p;
  }

  async definirParametre(
    user: AuthenticatedUser,
    cle: string,
    dto: DefinirParametreDto,
  ) {
    const { userId } = await this.assertSuperadmin(user);
    const existant = await this.prisma.parametrePlateforme.findUnique({
      where: { cle },
    });

    const valeur = dto.valeur as Prisma.InputJsonValue;
    const p = await this.prisma.$transaction(async (tx) => {
      const maj = await tx.parametrePlateforme.upsert({
        where: { cle },
        create: {
          cle,
          valeur,
          description: dto.description ?? null,
        },
        update: {
          valeur,
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
        },
      });
      await this.audit(
        tx,
        userId,
        existant ? 'MODIFICATION_PARAMETRE_PLATEFORME' : 'CREATION_PARAMETRE_PLATEFORME',
        maj.id,
        { cle },
        'parametres_plateforme',
      );
      return maj;
    });
    return p;
  }

  // --- 2. Santé du système ----------------------------------------

  async santeSysteme(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);

    const organisations = await this.prisma.organisation.findMany({
      where: { deletedAt: null },
      include: { licence: true },
      orderBy: { nom: 'asc' },
    });

    // adhérents rattachés à un compte, par organisation
    const adherentsParOrg = await this.prisma.profil.groupBy({
      by: ['organisationId'],
      where: { adherentId: { not: null }, deletedAt: null },
      _count: { _all: true },
    });
    const compteAdherents = new Map(
      adherentsParOrg.map((r) => [r.organisationId, r._count._all]),
    );

    // dernière écriture d'audit, par organisation
    const activiteParOrg = await this.prisma.auditLog.groupBy({
      by: ['organisationId'],
      _max: { createdAt: true },
    });
    const derniereActivite = new Map(
      activiteParOrg.map((r) => [r.organisationId, r._max.createdAt]),
    );

    const parStatutOrganisation: Record<string, number> = {};
    const parStatutLicence: Record<string, number> = {};

    const lignes = organisations.map((org) => {
      parStatutOrganisation[org.statut] =
        (parStatutOrganisation[org.statut] ?? 0) + 1;
      const statutLicence = org.licence?.statut ?? 'SANS_LICENCE';
      parStatutLicence[statutLicence] =
        (parStatutLicence[statutLicence] ?? 0) + 1;

      const adherents = compteAdherents.get(org.id) ?? 0;
      const limite = org.licence?.limiteAdherents ?? null;
      return {
        id: org.id,
        nom: org.nom,
        type: org.type,
        pays: org.pays,
        statut: org.statut,
        licence: org.licence
          ? {
              plan: org.licence.plan,
              statut: org.licence.statut,
              dateFin: org.licence.dateFin,
              limiteAdherents: org.licence.limiteAdherents,
            }
          : null,
        adherentsRattaches: adherents,
        limiteAdherents: limite,
        tauxUtilisationAdherents:
          limite && limite > 0
            ? new Decimal(adherents).div(limite).mul(100).toDecimalPlaces(1).toNumber()
            : null,
        quotaDepasse: limite != null && adherents > limite,
        derniereActivite: derniereActivite.get(org.id) ?? null,
      };
    });

    return {
      genereLe: new Date().toISOString(),
      resume: {
        totalOrganisations: organisations.length,
        totalAdherentsRattaches: lignes.reduce(
          (s, l) => s + l.adherentsRattaches,
          0,
        ),
        organisationsQuotaDepasse: lignes.filter((l) => l.quotaDepasse).length,
        parStatutOrganisation,
        parStatutLicence,
      },
      organisations: lignes,
    };
  }

  // --- 3. Catalogue national partagé -----------------------------

  async listerActesNational(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    await this.assertSuperadmin(user);
    return this.prisma.referentielNationalActe.findMany({
      where: {
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
      },
      orderBy: [{ categorie: 'asc' }, { libelle: 'asc' }],
    });
  }

  async creerActeNational(user: AuthenticatedUser, dto: CreerActeNationalDto) {
    const { userId } = await this.assertSuperadmin(user);
    const existe = await this.prisma.referentielNationalActe.findUnique({
      where: { code: dto.code },
    });
    if (existe) {
      throw new ForbiddenException(
        `Un acte national de code « ${dto.code} » existe déjà.`,
      );
    }
    // code ou libellé du référentiel unique des catégories (prisma/sql/067)
    const categorie = await this.categoriesActe.normaliser(dto.categorie);
    return this.prisma.$transaction(async (tx) => {
      const acte = await tx.referentielNationalActe.create({
        data: {
          code: dto.code,
          libelle: dto.libelle,
          categorie,
          versionNomenclature: dto.versionNomenclature ?? null,
          statut: dto.statut ?? 'HOMOLOGUE',
        },
      });
      await this.audit(
        tx,
        userId,
        'CREATION_ACTE_CATALOGUE_NATIONAL',
        acte.id,
        { code: dto.code },
        'referentiel_national_actes',
      );
      return acte;
    });
  }

  async supprimerActeNational(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertSuperadmin(user);
    const acte = await this.prisma.referentielNationalActe.findFirst({
      where: { id, deletedAt: null },
    });
    if (!acte) {
      throw new NotFoundException('Acte national introuvable.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.referentielNationalActe.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        userId,
        'RETRAIT_ACTE_CATALOGUE_NATIONAL',
        id,
        { code: acte.code },
        'referentiel_national_actes',
      );
    });
    return { id, retire: true };
  }

  async listerMedicamentsNational(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    await this.assertSuperadmin(user);
    return this.prisma.referentielNationalMedicament.findMany({
      where: {
        deletedAt: null,
        ...(filtres.statut ? { statutHomologation: filtres.statut } : {}),
      },
      orderBy: [{ classeTherapeutique: 'asc' }, { denominationCommune: 'asc' }],
    });
  }

  async creerMedicamentNational(
    user: AuthenticatedUser,
    dto: CreerMedicamentNationalDto,
  ) {
    const { userId } = await this.assertSuperadmin(user);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.referentielNationalMedicament.create({
        data: {
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
          statutHomologation: dto.statut ?? 'HOMOLOGUE',
        },
      });
      await this.audit(
        tx,
        userId,
        'CREATION_MEDICAMENT_CATALOGUE_NATIONAL',
        m.id,
        { dci: dto.denominationCommune },
        'referentiel_national_medicaments',
      );
      return m;
    });
  }

  async supprimerMedicamentNational(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertSuperadmin(user);
    const m = await this.prisma.referentielNationalMedicament.findFirst({
      where: { id, deletedAt: null },
    });
    if (!m) {
      throw new NotFoundException('Médicament national introuvable.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.referentielNationalMedicament.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        userId,
        'RETRAIT_MEDICAMENT_CATALOGUE_NATIONAL',
        id,
        { dci: m.denominationCommune },
        'referentiel_national_medicaments',
      );
    });
    return { id, retire: true };
  }

  // --- Helpers -------------------------------------------------

  private async assertSuperadmin(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!(permissions?.roleChain ?? []).includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException(
        'Action réservée au superadministrateur (SUPERADMIN_PRINCIPAL).',
      );
    }
    return { userId: profil.id };
  }

  private dec(v: number | undefined): string | null {
    return v === undefined || v === null ? null : new Decimal(v).toFixed(2);
  }

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
