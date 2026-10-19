import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { versPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { FORMAT_CODE_LETTRE_CLE, LettresClesService } from '../reference/lettres-cles.service';
import { SanteService } from '../sante/sante.service';
import {
  CreerActeNationalDto,
  CreerLettreCleDto,
  CreerMedicamentNationalDto,
  ModifierMedicamentNationalDto,
  DefinirParametreDto,
  ModifierActeNationalDto,
  ModifierLettreCleDto,
} from './dto/superadmin-config.dto';
import {
  ROLE_SUPERADMIN,
  ROLES_GESTION_CATALOGUE_NATIONAL,
  MAX_ELEMENTS_ACTION_MASSE,
  type ActionMasseCatalogue,
  type ResultatActionMasse,
  type ResultatElementMasse,
  type TypeCatalogue,
} from './superadmin.types';
import { DependancesService } from '../dependances/dependances.service';

type Db = PrismaService | Prisma.TransactionClient;

/** Message lisible d'une exception HTTP (chaîne, liste de messages ou objet `{ message }`). */
function raisonDe(e: HttpException): string {
  const r = e.getResponse();
  const m = typeof r === 'string' ? r : (r as { message?: string | string[] }).message;
  return Array.isArray(m) ? m.join(' ') : (m ?? e.message);
}

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
    private readonly sante: SanteService,
    private readonly dependances: DependancesService,
    private readonly lettresCles: LettresClesService,
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
      // API, base et microservice d'adjudication (indispensable depuis ADR-005)
      plateforme: await this.sante.etat(),
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

  /**
   * Catalogue national des actes. Sans `page` : liste complète (compatibilité). Avec `page` : liste PAGINÉE côté serveur, avec recherche
   * (`q` : code, libellé ou chapitre) — indispensable depuis le chargement de la nomenclature officielle (plus de 9 000 actes).
   */
  async listerActesNational(
    user: AuthenticatedUser,
    filtres: { statut?: string; q?: string; page?: number; limite?: number } = {},
  ) {
    await this.assertGestionCatalogue(user);
    const q = filtres.q?.trim();
    const where: Prisma.ReferentielNationalActeWhereInput = {
      deletedAt: null,
      ...(filtres.statut ? { statut: filtres.statut } : {}),
      ...(q
        ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { libelle: { contains: q, mode: 'insensitive' } }, { categorie: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };
    const orderBy: Prisma.ReferentielNationalActeOrderByWithRelationInput[] = [{ categorie: 'asc' }, { code: 'asc' }];
    if (!filtres.page) return this.prisma.referentielNationalActe.findMany({ where, orderBy: [{ categorie: 'asc' }, { libelle: 'asc' }] });
    const limite = Math.min(Math.max(filtres.limite ?? 25, 1), 100);
    const page = Math.max(filtres.page, 1);
    const [items, total] = await Promise.all([
      this.prisma.referentielNationalActe.findMany({ where, orderBy, skip: (page - 1) * limite, take: limite }),
      this.prisma.referentielNationalActe.count({ where }),
    ]);
    return versPage(items, total, page, limite);
  }

  async creerActeNational(user: AuthenticatedUser, dto: CreerActeNationalDto) {
    const { userId } = await this.assertGestionCatalogue(user);
    const existe = await this.prisma.referentielNationalActe.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (existe) {
      throw new ForbiddenException(
        `Un acte national de code « ${dto.code} » existe déjà.`,
      );
    }
    // `categorie` = CHAPITRE de la nomenclature (texte libre) ; la catégorie de GARANTIE est distincte
    // (prisma/sql/080). Compatibilité : sans catégorie de garantie, un chapitre qui est un code ou un
    // libellé du référentiel des catégories (prisma/sql/067) en tient lieu.
    const categorie = dto.categorie?.trim() || null;
    const cotation = await this.lettresCles.valider({
      ...dto,
      categorieGarantie: dto.categorieGarantie ?? (await this.categorieSiConnue(categorie)),
    });
    return this.prisma.$transaction(async (tx) => {
      const acte = await tx.referentielNationalActe.create({
        data: {
          code: dto.code,
          libelle: dto.libelle,
          categorie,
          versionNomenclature: dto.versionNomenclature ?? null,
          statut: dto.statut ?? 'HOMOLOGUE',
          ...cotation,
        },
      });
      await this.audit(
        tx,
        userId,
        'CREATION_ACTE_CATALOGUE_NATIONAL',
        acte.id,
        { code: dto.code, cotation: { ...cotation } },
        'referentiel_national_actes',
      );
      return acte;
    });
  }

  /** Modification d'un acte du catalogue national : libellé, chapitre, version, cotation (tracée avant / après). */
  async modifierActeNational(user: AuthenticatedUser, id: string, dto: ModifierActeNationalDto) {
    const { userId } = await this.assertGestionCatalogue(user);
    const avant = await this.prisma.referentielNationalActe.findFirst({ where: { id, deletedAt: null } });
    if (!avant) throw new NotFoundException('Acte national introuvable.');
    await this.dependances.assertPossible(user, 'acteNational', id, 'modifier');

    const cle = <K extends keyof ModifierActeNationalDto>(k: K) => (k in dto ? dto[k] : undefined);
    const fusion = {
      lettreCleCode: cle('lettreCleCode') !== undefined ? dto.lettreCleCode : avant.lettreCleCode,
      coefficient: cle('coefficient') !== undefined ? dto.coefficient : avant.coefficient?.toString() ?? null,
      modeCotation: cle('modeCotation') !== undefined ? dto.modeCotation : avant.modeCotation,
      categorieGarantie: cle('categorieGarantie') !== undefined ? dto.categorieGarantie : avant.categorieGarantie,
      groupeCode: cle('groupeCode') !== undefined ? dto.groupeCode : avant.groupeCode,
    };
    const cotation = await this.lettresCles.valider(fusion);
    const categorie = dto.categorie === undefined ? avant.categorie : dto.categorie?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      const acte = await tx.referentielNationalActe.update({
        where: { id },
        data: {
          ...(dto.libelle !== undefined ? { libelle: dto.libelle } : {}),
          categorie,
          ...(dto.versionNomenclature !== undefined ? { versionNomenclature: dto.versionNomenclature } : {}),
          ...cotation,
        },
      });
      await this.audit(
        tx,
        userId,
        'MODIFICATION_ACTE_CATALOGUE_NATIONAL',
        id,
        {
          code: avant.code,
          avant: {
            lettreCleCode: avant.lettreCleCode,
            coefficient: avant.coefficient?.toString() ?? null,
            modeCotation: avant.modeCotation,
            categorieGarantie: avant.categorieGarantie,
            groupeCode: avant.groupeCode,
          },
          apres: { ...cotation },
        },
        'referentiel_national_actes',
      );
      return acte;
    });
  }

  // --- Lettres-clés (prisma/sql/080) : paramétrables, sans valeur chiffrée ------------------

  async listerLettresCles(user: AuthenticatedUser) {
    await this.assertGestionCatalogue(user);
    const [lettres, nationaux, organisations] = await Promise.all([
      this.lettresCles.lister(),
      this.prisma.referentielNationalActe.groupBy({ by: ['lettreCleCode'], where: { deletedAt: null, lettreCleCode: { not: null } }, _count: true }),
      this.prisma.referentielActe.groupBy({ by: ['lettreCleCode'], where: { deletedAt: null, lettreCleCode: { not: null } }, _count: true }),
    ]);
    const n = new Map(nationaux.map((x) => [x.lettreCleCode, x._count]));
    const o = new Map(organisations.map((x) => [x.lettreCleCode, x._count]));
    return lettres.map((l) => ({ ...l, nbActesNationaux: n.get(l.code) ?? 0, nbActesOrganisations: o.get(l.code) ?? 0 }));
  }

  async creerLettreCle(user: AuthenticatedUser, dto: CreerLettreCleDto) {
    const { userId } = await this.assertSuperadmin(user);
    const code = dto.code.trim().toUpperCase();
    if (!FORMAT_CODE_LETTRE_CLE.test(code)) {
      throw new BadRequestException('Le code d’une lettre-clé comporte 1 à 6 lettres majuscules (ex. B, KC, AMI, CNPSY).');
    }
    if (await this.prisma.lettreCle.findUnique({ where: { code } })) {
      throw new ConflictException(`La lettre-clé « ${code} » existe déjà.`);
    }
    const libelle = dto.libelle.trim();
    if (await this.libelleLettrePris(libelle)) {
      throw new ConflictException(`Une lettre-clé porte déjà le libellé « ${libelle} ».`);
    }
    return this.prisma.$transaction(async (tx) => {
      const l = await tx.lettreCle.create({ data: { code, libelle, ordre: dto.ordre ?? 0 } });
      await this.audit(tx, userId, 'CREATION_LETTRE_CLE', userId, { code, libelle }, 'lettres_cles');
      return l;
    });
  }

  async modifierLettreCle(user: AuthenticatedUser, id: string, dto: ModifierLettreCleDto) {
    const { userId } = await this.assertSuperadmin(user);
    const l = await this.prisma.lettreCle.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Lettre-clé introuvable.');
    const code = l.code;
    if (dto.libelle !== undefined && dto.libelle.trim().toLowerCase() !== l.libelle.toLowerCase() && (await this.libelleLettrePris(dto.libelle.trim()))) {
      throw new ConflictException(`Une lettre-clé porte déjà le libellé « ${dto.libelle.trim()} ».`);
    }
    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.lettreCle.update({
        where: { id },
        data: { ...(dto.libelle !== undefined ? { libelle: dto.libelle.trim() } : {}), ...(dto.ordre !== undefined ? { ordre: dto.ordre } : {}) },
      });
      await this.audit(tx, userId, 'MODIFICATION_LETTRE_CLE', userId, { code, avant: { libelle: l.libelle, ordre: l.ordre }, apres: { libelle: maj.libelle, ordre: maj.ordre } }, 'lettres_cles');
      return maj;
    });
  }

  /** Désactiver (archiver) / réactiver (désarchiver) : une lettre inactive n'est plus proposée à la cotation. */
  async changerStatutLettreCle(user: AuthenticatedUser, id: string, action: 'archiver' | 'desarchiver') {
    const { userId } = await this.assertSuperadmin(user);
    const l = await this.prisma.lettreCle.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Lettre-clé introuvable.');
    const code = l.code;
    await this.dependances.assertPossible(user, 'lettreCle', id, action);
    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.lettreCle.update({ where: { id }, data: { actif: action === 'desarchiver' } });
      await this.audit(tx, userId, action === 'archiver' ? 'DESACTIVATION_LETTRE_CLE' : 'REACTIVATION_LETTRE_CLE', userId, { code }, 'lettres_cles');
      return maj;
    });
  }

  /** Suppression : seulement une lettre-clé qu'aucun acte (national ou d'organisation) ne porte (registre). */
  async supprimerLettreCle(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertSuperadmin(user);
    const l = await this.prisma.lettreCle.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Lettre-clé introuvable.');
    const code = l.code;
    await this.dependances.assertPossible(user, 'lettreCle', id, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      await this.audit(tx, userId, 'SUPPRESSION_LETTRE_CLE', userId, { code, libelle: l.libelle }, 'lettres_cles');
      await tx.lettreCle.delete({ where: { id } });
    });
    return { code, supprimee: true };
  }

  private async categorieSiConnue(valeur: string | null): Promise<string | null> {
    if (!valeur) return null;
    try {
      return await this.categoriesActe.normaliser(valeur);
    } catch {
      return null;
    }
  }

  private async libelleLettrePris(libelle: string): Promise<boolean> {
    return (await this.prisma.lettreCle.count({ where: { libelle: { equals: libelle, mode: 'insensitive' } } })) > 0;
  }

  async supprimerActeNational(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertGestionCatalogue(user);
    const acte = await this.prisma.referentielNationalActe.findFirst({
      where: { id, deletedAt: null },
    });
    if (!acte) {
      throw new NotFoundException('Acte national introuvable.');
    }
    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'acteNational', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.referentielNationalActe.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        userId,
        'SUPPRESSION_ACTE_CATALOGUE_NATIONAL',
        id,
        { code: acte.code },
        'referentiel_national_actes',
      );
    });
    return { id, retire: true };
  }

  /**
   * Archivage (RETIRE) / désarchivage (HOMOLOGUE) d'un élément du catalogue national
   * (ADR-007) : un élément retiré n'est plus proposé à l'import ; les copies déjà
   * importées par les organisations ne changent pas.
   */
  async changerStatutNational(
    user: AuthenticatedUser,
    type: 'actes' | 'medicaments',
    id: string,
    action: 'archiver' | 'desarchiver',
  ) {
    const { userId } = await this.assertGestionCatalogue(user);
    const entite = type === 'actes' ? 'acteNational' : 'medicamentNational';
    const existe =
      type === 'actes'
        ? await this.prisma.referentielNationalActe.findFirst({ where: { id, deletedAt: null } })
        : await this.prisma.referentielNationalMedicament.findFirst({ where: { id, deletedAt: null } });
    if (!existe) {
      throw new NotFoundException(type === 'actes' ? 'Acte national introuvable.' : 'Médicament national introuvable.');
    }
    await this.dependances.assertPossible(user, entite, id, action);

    const statut = action === 'archiver' ? 'RETIRE' : 'HOMOLOGUE';
    const dateRetrait = action === 'archiver' ? new Date() : null;
    const table = type === 'actes' ? 'referentiel_national_actes' : 'referentiel_national_medicaments';
    const libelle = type === 'actes' ? 'ACTE' : 'MEDICAMENT';
    await this.prisma.$transaction(async (tx) => {
      if (type === 'actes') {
        await tx.referentielNationalActe.update({ where: { id }, data: { statut, dateRetrait } });
      } else {
        await tx.referentielNationalMedicament.update({ where: { id }, data: { statutHomologation: statut, dateRetrait } });
      }
      await this.audit(
        tx,
        userId,
        action === 'archiver' ? `RETRAIT_${libelle}_CATALOGUE_NATIONAL` : `REACTIVATION_${libelle}_CATALOGUE_NATIONAL`,
        id,
        { statut },
        table,
      );
    });
    return { id, statut };
  }

  /**
   * Homologue un élément du catalogue national (PROPOSE ou SUSPENDU → HOMOLOGUE) : seul un élément homologué peut être activé par une
   * organisation (ADR-009). Les éléments créés par import Excel arrivent PROPOSE ; un élément RETIRÉ se réactive (désarchivage), il ne s'homologue pas.
   */
  async homologuerNational(user: AuthenticatedUser, type: 'actes' | 'medicaments', id: string) {
    const { userId } = await this.assertGestionCatalogue(user);
    const actuel =
      type === 'actes'
        ? (await this.prisma.referentielNationalActe.findFirst({ where: { id, deletedAt: null } }))?.statut
        : (await this.prisma.referentielNationalMedicament.findFirst({ where: { id, deletedAt: null } }))?.statutHomologation;
    if (actuel === undefined) {
      throw new NotFoundException(type === 'actes' ? 'Acte national introuvable.' : 'Médicament national introuvable.');
    }
    if (actuel === 'HOMOLOGUE') throw new ConflictException('Cet élément est déjà homologué.');
    if (actuel === 'RETIRE') throw new ConflictException('Cet élément est retiré du catalogue : réactivez-le (désarchivage) au lieu de l’homologuer.');
    const table = type === 'actes' ? 'referentiel_national_actes' : 'referentiel_national_medicaments';
    await this.prisma.$transaction(async (tx) => {
      const donnees = { homologuePar: userId, dateHomologation: new Date(), dateRetrait: null };
      if (type === 'actes') await tx.referentielNationalActe.update({ where: { id }, data: { statut: 'HOMOLOGUE', ...donnees } });
      else await tx.referentielNationalMedicament.update({ where: { id }, data: { statutHomologation: 'HOMOLOGUE', ...donnees } });
      await this.audit(tx, userId, type === 'actes' ? 'HOMOLOGATION_ACTE_CATALOGUE_NATIONAL' : 'HOMOLOGATION_MEDICAMENT_CATALOGUE_NATIONAL', id, { de: actuel }, table);
    });
    return { id, statut: 'HOMOLOGUE' };
  }

  async listerMedicamentsNational(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    await this.assertGestionCatalogue(user);
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
    const { userId } = await this.assertGestionCatalogue(user);
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

  /** Modification d'un médicament du catalogue national (valeurs avant / après tracées). */
  async modifierMedicamentNational(user: AuthenticatedUser, id: string, dto: ModifierMedicamentNationalDto) {
    const { userId } = await this.assertGestionCatalogue(user);
    const avant = await this.prisma.referentielNationalMedicament.findFirst({ where: { id, deletedAt: null } });
    if (!avant) throw new NotFoundException('Médicament national introuvable.');
    await this.dependances.assertPossible(user, 'medicamentNational', id, 'modifier');

    const texte = (v: string | null | undefined) => (v === null ? null : v?.trim() || null);
    const data: Prisma.ReferentielNationalMedicamentUpdateInput = {};
    const poser = <K extends keyof ModifierMedicamentNationalDto>(k: K, f: (v: NonNullable<ModifierMedicamentNationalDto[K]> | null) => unknown) => {
      if (k in dto && dto[k] !== undefined) (data as Record<string, unknown>)[k] = f(dto[k] as never);
    };
    if (dto.denominationCommune !== undefined) data.denominationCommune = dto.denominationCommune.trim();
    for (const k of ['nomCommercial', 'codeEan', 'codeProduit', 'forme', 'dosage', 'conditionnement', 'classeTherapeutique', 'regimeRemboursement'] as const) {
      poser(k, (v) => texte(v as string | null));
    }
    for (const k of ['remboursable', 'medicamentEssentiel', 'ordonnanceObligatoire', 'medicamentControle', 'generiqueDisponible', 'categorieRemboursement', 'usage'] as const) {
      poser(k, (v) => v);
    }
    for (const k of ['tauxRemboursementStd', 'prixReferenceXof', 'prixMaxRemboursable'] as const) {
      poser(k, (v) => this.dec(v as number | null | undefined));
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Aucune modification à enregistrer.');
    const champs = Object.keys(data);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.referentielNationalMedicament.update({ where: { id }, data });
      await this.audit(
        tx,
        userId,
        'MODIFICATION_MEDICAMENT_CATALOGUE_NATIONAL',
        id,
        {
          dci: avant.denominationCommune,
          avant: Object.fromEntries(champs.map((c) => [c, (avant as Record<string, unknown>)[c]?.toString() ?? null])),
          apres: Object.fromEntries(champs.map((c) => [c, (m as Record<string, unknown>)[c]?.toString() ?? null])),
        },
        'referentiel_national_medicaments',
      );
      return m;
    });
  }

  async supprimerMedicamentNational(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertGestionCatalogue(user);
    const m = await this.prisma.referentielNationalMedicament.findFirst({
      where: { id, deletedAt: null },
    });
    if (!m) {
      throw new NotFoundException('Médicament national introuvable.');
    }
    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'medicamentNational', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.referentielNationalMedicament.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        userId,
        'SUPPRESSION_MEDICAMENT_CATALOGUE_NATIONAL',
        id,
        { dci: m.denominationCommune },
        'referentiel_national_medicaments',
      );
    });
    return { id, retire: true };
  }

  // --- Actions de masse sur le catalogue national --------------------

  /**
   * Archiver / désarchiver / supprimer (logiquement) PLUSIEURS éléments du catalogue national en une requête. Réservé au
   * SUPERADMIN. Plafond de {@link MAX_ELEMENTS_ACTION_MASSE} éléments ; CHAQUE élément est contrôlé et traité individuellement
   * par la même méthode que l'action unitaire (registre des dépendances, ADR-007) dans sa propre transaction avec `log_audit()` ;
   * un refus n'arrête pas le lot et est tracé à part. Résultat partiel : pour chaque élément, réussi ou refusé avec la raison.
   * Archiver = simple retrait du catalogue (réversible) : plus proposé à l'import, copies des organisations inchangées.
   */
  async actionMasseCatalogue(
    user: AuthenticatedUser,
    type: TypeCatalogue,
    action: ActionMasseCatalogue,
    ids: string[],
  ): Promise<ResultatActionMasse> {
    const { userId } = await this.assertGestionCatalogue(user);
    const distincts = [...new Set(ids ?? [])];
    if (distincts.length === 0) throw new BadRequestException('Sélectionnez au moins un élément.');
    if (distincts.length > MAX_ELEMENTS_ACTION_MASSE) {
      throw new BadRequestException(`Au plus ${MAX_ELEMENTS_ACTION_MASSE} éléments par action.`);
    }
    const table = type === 'actes' ? 'referentiel_national_actes' : 'referentiel_national_medicaments';
    const existants =
      type === 'actes'
        ? (await this.prisma.referentielNationalActe.findMany({ where: { id: { in: distincts }, deletedAt: null }, select: { id: true, code: true, libelle: true } })).map(
            (a) => [a.id, `${a.code} — ${a.libelle}`] as const,
          )
        : (await this.prisma.referentielNationalMedicament.findMany({ where: { id: { in: distincts }, deletedAt: null }, select: { id: true, denominationCommune: true, nomCommercial: true } })).map(
            (m) => [m.id, m.nomCommercial ? `${m.denominationCommune} (${m.nomCommercial})` : m.denominationCommune] as const,
          );
    const noms = new Map(existants);

    const resultats: ResultatElementMasse[] = [];
    for (const id of distincts) {
      const nom = noms.get(id) ?? id;
      if (!noms.has(id)) {
        const raison = type === 'actes' ? 'Acte introuvable dans le catalogue national.' : 'Médicament introuvable dans le catalogue national.';
        await this.dependances.tracerRefusMetier(user, table, id, `masse_${action}`, raison);
        resultats.push({ id, nom, ok: false, raison });
        continue;
      }
      try {
        if (action === 'supprimer') {
          if (type === 'actes') await this.supprimerActeNational(user, id);
          else await this.supprimerMedicamentNational(user, id);
        } else if (action === 'homologuer') {
          await this.homologuerNational(user, type, id);
        } else {
          await this.changerStatutNational(user, type, id, action);
        }
        resultats.push({ id, nom, ok: true, raison: null });
      } catch (e) {
        // un refus (409 du registre, introuvable…) n'arrête pas le lot : l'élément est signalé avec sa raison
        if (!(e instanceof HttpException)) throw e;
        resultats.push({ id, nom, ok: false, raison: raisonDe(e) });
      }
    }
    const reussis = resultats.filter((r) => r.ok).length;
    // synthèse du lot (chaque réussite a déjà sa propre ligne d'audit ; les refus sont tracés par le registre)
    await this.prisma.$transaction(async (tx) => {
      await this.audit(tx, userId, `ACTION_MASSE_CATALOGUE_NATIONAL_${action.toUpperCase()}`, distincts[0], { type, demandes: distincts.length, reussis, refuses: distincts.length - reussis }, table);
    });
    return { type, action, demandes: distincts.length, reussis, refuses: distincts.length - reussis, resultats };
  }

  // --- Helpers -------------------------------------------------

  /** Superadmin OU assurance informatique : mise à jour du catalogue national (ADR-009). */
  private async assertGestionCatalogue(user: AuthenticatedUser): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    const roles = permissions?.roleChain ?? [];
    if (!roles.some((r) => (ROLES_GESTION_CATALOGUE_NATIONAL as readonly string[]).includes(r))) {
      throw new ForbiddenException('La mise à jour du catalogue national est réservée au superadministrateur et à l’assurance informatique.');
    }
    return { userId: profil.id };
  }

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

  private dec(v: number | null | undefined): string | null {
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
