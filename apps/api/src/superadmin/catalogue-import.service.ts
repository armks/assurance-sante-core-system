import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { LettresClesService } from '../reference/lettres-cles.service';
import { ROLES_GESTION_CATALOGUE_NATIONAL } from './superadmin.types';

/** Forme minimale d'un fichier téléversé (multer, mémoire) — même convention
 * que `member/import-adherents.service.ts`. */
export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export const TYPES_CATALOGUE = ['ACTES', 'MEDICAMENTS'] as const;
export type TypeCatalogue = (typeof TYPES_CATALOGUE)[number];

/** Cotation d'une ligne d'import (prisma/sql/080) ; `null` = le fichier ne porte AUCUNE colonne de cotation :
 * un acte existant garde alors sa cotation. */
interface CotationLigne {
  lettreCleCode: string | null;
  coefficient: string | null;
  modeCotation: string;
  categorieGarantie: string | null;
  groupeCode: string | null;
}

interface LigneActeCatalogue {
  code: string;
  libelle: string;
  categorie: string | null;
  cotation: Partial<CotationLigne> | null;
  /** Un code déjà présent dans `referentiel_national_actes` (non supprimé) —
   * mise à jour à la validation, jamais une erreur bloquante. */
  estMiseAJour: boolean;
  idExistant: string | null;
}

interface LigneMedicamentCatalogue {
  denominationCommune: string;
  nomCommercial: string | null;
  classeTherapeutique: string | null;
  /** `Decimal` sérialisé en string (toujours 2 décimales), jamais un `number`. */
  prixReferenceXof: string | null;
  medicamentEssentiel: boolean;
  /** Doublon détecté par `denominationCommune` (insensible à la casse) —
   * mise à jour à la validation, jamais une erreur bloquante. */
  estMiseAJour: boolean;
  idExistant: string | null;
}

type LigneCatalogue = LigneActeCatalogue | LigneMedicamentCatalogue;

export interface LigneErreurCatalogue {
  ligne: number;
  donnees: Record<string, string>;
  erreurs: string[];
}

const TAILLE_MAX_FICHIER_OCTETS = 5 * 1024 * 1024;
const MIME_TYPES_AUTORISES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // certains navigateurs/OS n'envoient pas le MIME xlsx exact
];

function normaliserEntete(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

type ColonneActe =
  | 'code'
  | 'libelle'
  | 'categorie'
  | 'lettreCle'
  | 'coefficient'
  | 'modeCotation'
  | 'categorieGarantie'
  | 'groupeCode';
const ALIAS_ENTETES_ACTES: Record<string, ColonneActe> = {
  code: 'code',
  libelle: 'libelle',
  categorie: 'categorie',
  chapitre: 'categorie',
  lettrecle: 'lettreCle',
  lettre: 'lettreCle',
  coefficient: 'coefficient',
  coef: 'coefficient',
  mode: 'modeCotation',
  modecotation: 'modeCotation',
  isolegroupe: 'modeCotation',
  categoriegarantie: 'categorieGarantie',
  garantie: 'categorieGarantie',
  groupe: 'groupeCode',
  groupecode: 'groupeCode',
};
const COLONNES_COTATION: ColonneActe[] = ['lettreCle', 'coefficient', 'modeCotation', 'categorieGarantie', 'groupeCode'];

type ColonneMedicament = 'denominationCommune' | 'nomCommercial' | 'classeTherapeutique' | 'prixReferenceXof' | 'medicamentEssentiel';
const ALIAS_ENTETES_MEDICAMENTS: Record<string, ColonneMedicament> = {
  denominationcommune: 'denominationCommune',
  dci: 'denominationCommune',
  nomcommercial: 'nomCommercial',
  classetherapeutique: 'classeTherapeutique',
  prixreferencexof: 'prixReferenceXof',
  prixreference: 'prixReferenceXof',
  medicamentessentiel: 'medicamentEssentiel',
};

const VALEURS_VRAI = ['oui', 'true', '1', 'vrai', 'yes', 'x'];

type Db = PrismaService | Prisma.TransactionClient;

/**
 * CatalogueImportService — import en masse par Excel du catalogue national
 * (`referentiel_national_actes`/`referentiel_national_medicaments`), réservé
 * EXCLUSIVEMENT à SUPERADMIN_PRINCIPAL (module `superadmin/`, un domaine
 * métier strict — pas d'`organisation_id`, cross-tenant par nature).
 *
 * Même principe que `member/import-adherents.service.ts` : deux étapes
 * séparées, jamais fusionnées — `importerCatalogueExcel` ne crée/modifie
 * AUCUNE entrée du catalogue, seule `validerImportCatalogue` le fait. PAS de
 * double validation ici (contrairement aux adhérents) : SUPERADMIN_PRINCIPAL
 * est déjà la plus haute autorité sur cette donnée, importe ET valide.
 *
 * Nouvelle entrée → statut PROPOSE (jamais HOMOLOGUE directement, même si
 * `creerActeNational`/`creerMedicamentNational` — création unitaire, pas un
 * import en masse — défaut à HOMOLOGUE : asymétrie volontaire, une donnée
 * importée en masse depuis un fichier externe mérite une vérification
 * supplémentaire avant d'être considérée fiable). Doublon détecté (code déjà
 * existant pour un acte, dénomination commune déjà existante pour un
 * médicament) → mise à jour des champs importés SEULEMENT, le statut
 * d'homologation existant n'est jamais touché.
 */
@Injectable()
export class CatalogueImportService {
  private readonly logger = new Logger(CatalogueImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly categoriesActe: CategoriesActeService,
    private readonly lettresCles: LettresClesService,
  ) {}

  private async assertSuperadmin(user: AuthenticatedUser): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!(permissions?.roleChain ?? []).some((r) => (ROLES_GESTION_CATALOGUE_NATIONAL as readonly string[]).includes(r))) {
      throw new ForbiddenException(
        'La mise à jour du catalogue national est réservée au superadministrateur et à l’assurance informatique.',
      );
    }
    return { userId: profil.id };
  }

  /**
   * Parse le fichier .xlsx et journalise l'import en EN_ATTENTE_VALIDATION —
   * AUCUNE entrée du catalogue créée/modifiée ici. Chaque ligne en erreur
   * (code/libellé manquant, prix invalide) est listée précisément dans
   * `erreursDetail`, sans jamais bloquer les lignes valides. Un doublon
   * détecté (code ou dénomination commune déjà présent) est signalé comme
   * mise à jour dans `lignesValides` — PAS une erreur.
   */
  async importerCatalogueExcel(
    user: AuthenticatedUser,
    type: TypeCatalogue,
    fichier: FichierTeleverse,
  ) {
    const { userId } = await this.assertSuperadmin(user);
    if (!(TYPES_CATALOGUE as readonly string[]).includes(type)) {
      throw new BadRequestException("type doit être 'ACTES' ou 'MEDICAMENTS'.");
    }
    if (!MIME_TYPES_AUTORISES.includes(fichier.mimetype) && !fichier.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Seul un fichier .xlsx est accepté.');
    }
    if (fichier.size > TAILLE_MAX_FICHIER_OCTETS) {
      throw new BadRequestException('Fichier trop volumineux (max 5 Mo).');
    }

    const { lignesValides, erreursDetail } =
      type === 'ACTES' ? await this.parserActes(fichier) : await this.parserMedicaments(fichier);

    const nbLignesTotal = lignesValides.length + erreursDetail.length;
    if (nbLignesTotal === 0) {
      throw new BadRequestException(
        type === 'ACTES'
          ? 'Fichier vide ou colonnes non reconnues (attendues : code, libelle ; facultatives : categorie, lettre_cle, coefficient, mode, categorie_garantie, groupe_code).'
          : 'Fichier vide ou colonnes non reconnues (attendues : denomination_commune, nom_commercial, classe_therapeutique, prix_reference_xof, medicament_essentiel).',
      );
    }

    const importCree = await this.prisma.$transaction(async (tx) => {
      const imp = await tx.importCatalogueNational.create({
        data: {
          type,
          fichierNom: fichier.originalname,
          statut: 'EN_ATTENTE_VALIDATION',
          nbLignesTotal,
          nbLignesValides: lignesValides.length,
          nbLignesErreur: erreursDetail.length,
          lignesValides: lignesValides as unknown as object,
          erreursDetail: erreursDetail as unknown as object,
          importeParId: userId,
        },
      });
      await this.audit(
        tx,
        userId,
        'IMPORT_CATALOGUE_NATIONAL',
        imp.id,
        {
          type,
          fichierNom: fichier.originalname,
          nbLignesTotal,
          nbLignesValides: lignesValides.length,
          nbLignesErreur: erreursDetail.length,
        },
        'imports_catalogue_national',
      );
      return imp;
    });

    return importCree;
  }

  async listerImportsCatalogue(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    return this.prisma.importCatalogueNational.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Réservé EXCLUSIVEMENT à SUPERADMIN_PRINCIPAL — même rôle que l'import
   * lui-même, pas de double validation. Une transaction PAR LIGNE (création
   * OU mise à jour + audit), comme `validerImportAdherents` — puis une
   * dernière transaction marque l'import VALIDE.
   */
  async validerImportCatalogue(user: AuthenticatedUser, importId: string) {
    const { userId } = await this.assertSuperadmin(user);

    const imp = await this.prisma.importCatalogueNational.findFirst({
      where: { id: importId },
    });
    if (!imp) {
      throw new NotFoundException('Import introuvable.');
    }
    if (imp.statut !== 'EN_ATTENTE_VALIDATION') {
      throw new ConflictException(`Cet import est déjà ${imp.statut}.`);
    }
    const lignes = imp.lignesValides as unknown as LigneCatalogue[];
    if (!lignes || lignes.length === 0) {
      throw new ConflictException('Aucune ligne valide à importer.');
    }

    const idsCrees: string[] = [];
    const idsMisAJour: string[] = [];

    if (imp.type === 'ACTES') {
      for (const ligne of lignes as LigneActeCatalogue[]) {
        const { id, cree } = await this.prisma.$transaction(async (tx) => {
          if (ligne.estMiseAJour && ligne.idExistant) {
            const a = await tx.referentielNationalActe.update({
              where: { id: ligne.idExistant },
              data: { libelle: ligne.libelle, categorie: ligne.categorie, ...(ligne.cotation ?? {}) },
            });
            await this.audit(
              tx,
              userId,
              'MAJ_ACTE_CATALOGUE_NATIONAL_IMPORT',
              a.id,
              { importId: imp.id, code: ligne.code },
              'referentiel_national_actes',
            );
            return { id: a.id, cree: false };
          }
          const a = await tx.referentielNationalActe.create({
            data: {
              code: ligne.code,
              libelle: ligne.libelle,
              categorie: ligne.categorie,
              statut: 'PROPOSE',
              ...(ligne.cotation ?? {}),
            },
          });
          await this.audit(
            tx,
            userId,
            'CREATION_ACTE_CATALOGUE_NATIONAL_IMPORT',
            a.id,
            { importId: imp.id, code: ligne.code },
            'referentiel_national_actes',
          );
          return { id: a.id, cree: true };
        });
        (cree ? idsCrees : idsMisAJour).push(id);
      }
    } else {
      for (const ligne of lignes as LigneMedicamentCatalogue[]) {
        const { id, cree } = await this.prisma.$transaction(async (tx) => {
          if (ligne.estMiseAJour && ligne.idExistant) {
            const m = await tx.referentielNationalMedicament.update({
              where: { id: ligne.idExistant },
              data: {
                nomCommercial: ligne.nomCommercial,
                classeTherapeutique: ligne.classeTherapeutique,
                prixReferenceXof: ligne.prixReferenceXof,
                medicamentEssentiel: ligne.medicamentEssentiel,
              },
            });
            await this.audit(
              tx,
              userId,
              'MAJ_MEDICAMENT_CATALOGUE_NATIONAL_IMPORT',
              m.id,
              { importId: imp.id, dci: ligne.denominationCommune },
              'referentiel_national_medicaments',
            );
            return { id: m.id, cree: false };
          }
          const m = await tx.referentielNationalMedicament.create({
            data: {
              denominationCommune: ligne.denominationCommune,
              nomCommercial: ligne.nomCommercial,
              classeTherapeutique: ligne.classeTherapeutique,
              prixReferenceXof: ligne.prixReferenceXof,
              medicamentEssentiel: ligne.medicamentEssentiel,
              statutHomologation: 'PROPOSE',
            },
          });
          await this.audit(
            tx,
            userId,
            'CREATION_MEDICAMENT_CATALOGUE_NATIONAL_IMPORT',
            m.id,
            { importId: imp.id, dci: ligne.denominationCommune },
            'referentiel_national_medicaments',
          );
          return { id: m.id, cree: true };
        });
        (cree ? idsCrees : idsMisAJour).push(id);
      }
    }

    const importMaj = await this.prisma.$transaction(async (tx) => {
      const imp2 = await tx.importCatalogueNational.update({
        where: { id: importId },
        data: { statut: 'VALIDE', valideParId: userId, dateValidation: new Date() },
      });
      await this.audit(
        tx,
        userId,
        'VALIDATION_IMPORT_CATALOGUE_NATIONAL',
        imp2.id,
        { nbCrees: idsCrees.length, nbMisAJour: idsMisAJour.length },
        'imports_catalogue_national',
      );
      return imp2;
    });

    return {
      ...importMaj,
      nbCrees: idsCrees.length,
      nbMisAJour: idsMisAJour.length,
      idsCrees,
      idsMisAJour,
    };
  }

  // --- Parsing Excel ---------------------------------------------------

  private async chargerFeuille(fichier: FichierTeleverse): Promise<ExcelJS.Worksheet | undefined> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fichier.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Fichier .xlsx illisible ou corrompu.');
    }
    return workbook.worksheets[0];
  }

  private async parserActes(
    fichier: FichierTeleverse,
  ): Promise<{ lignesValides: LigneActeCatalogue[]; erreursDetail: LigneErreurCatalogue[] }> {
    const feuille = await this.chargerFeuille(fichier);
    if (!feuille || feuille.rowCount < 2) {
      return { lignesValides: [], erreursDetail: [] };
    }

    const ligneEntete = feuille.getRow(1);
    const colonnes = new Map<ColonneActe, number>();
    ligneEntete.eachCell((cell, colNumber) => {
      const cle = ALIAS_ENTETES_ACTES[normaliserEntete(String(cell.value ?? ''))];
      if (cle) colonnes.set(cle, colNumber);
    });
    const manquantes = (['code', 'libelle'] as const).filter((c) => !colonnes.has(c));
    if (manquantes.length > 0) {
      throw new BadRequestException(`Colonnes manquantes dans le fichier : ${manquantes.join(', ')}.`);
    }

    const brut = (n: number, col: ColonneActe) => {
      const idx = colonnes.get(col);
      if (!idx) return '';
      const valeur = feuille.getRow(n).getCell(idx).value;
      if (valeur === null || valeur === undefined) return '';
      if (typeof valeur === 'object' && 'text' in (valeur as any)) return String((valeur as any).text ?? '');
      return String(valeur).trim();
    };

    // le fichier porte-t-il des colonnes de cotation ? sinon un acte existant garde la sienne
    const avecCotation = COLONNES_COTATION.some((c) => colonnes.has(c));
    // `categorie_garantie` présente : `categorie` est le CHAPITRE (texte libre) ; sinon comportement historique
    // (la catégorie, validée, vaut aussi catégorie de garantie)
    const chapitreLibre = colonnes.has('categorieGarantie');
    const lettresActives = new Set(
      (await this.lettresCles.lister()).filter((l) => l.actif).map((l) => l.code),
    );

    const candidats: {
      ligne: number;
      donnees: Record<string, string>;
      code: string;
      libelle: string;
      categorie: string | null;
      cotation: Partial<CotationLigne> | null;
      erreurs: string[];
    }[] = [];

    for (let n = 2; n <= feuille.rowCount; n++) {
      const row = feuille.getRow(n);
      if (row.cellCount === 0) continue;
      const code = brut(n, 'code');
      const libelle = brut(n, 'libelle');
      const categorie = brut(n, 'categorie');
      const brutCotation = {
        lettreCleCode: brut(n, 'lettreCle'),
        coefficient: brut(n, 'coefficient'),
        modeCotation: brut(n, 'modeCotation'),
        categorieGarantie: brut(n, 'categorieGarantie'),
        groupeCode: brut(n, 'groupeCode'),
      };
      if (!code && !libelle && !categorie && !Object.values(brutCotation).some(Boolean)) continue; // ligne vide, ignorée silencieusement

      const donnees: Record<string, string> = { code, libelle, categorie };
      if (avecCotation) {
        donnees.lettre_cle = brutCotation.lettreCleCode;
        donnees.coefficient = brutCotation.coefficient;
        donnees.mode = brutCotation.modeCotation;
        donnees.categorie_garantie = brutCotation.categorieGarantie;
        donnees.groupe_code = brutCotation.groupeCode;
      }
      const erreurs: string[] = [];
      if (!code) erreurs.push('code manquant');
      if (!libelle) erreurs.push('libellé manquant');
      let categorieCode: string | null = categorie || null;
      if (!chapitreLibre) {
        // code ou libellé du référentiel unique des catégories (prisma/sql/067)
        try {
          categorieCode = await this.categoriesActe.normaliser(categorie);
        } catch {
          erreurs.push(`catégorie inconnue (${categorie})`);
        }
      }
      let cotation: Partial<CotationLigne> | null = null;
      if (avecCotation) {
        const analyse = await this.lettresCles.analyser(
          { ...brutCotation, categorieGarantie: chapitreLibre ? brutCotation.categorieGarantie : categorieCode ?? '' },
          lettresActives,
        );
        erreurs.push(...analyse.erreurs);
        cotation = analyse.valide;
      } else if (!chapitreLibre && categorieCode) {
        cotation = { categorieGarantie: categorieCode }; // historique : la catégorie validée est aussi la catégorie de garantie
      }

      candidats.push({ ligne: n, donnees, code, libelle, categorie: categorieCode, cotation, erreurs });
    }

    // Doublon de code DANS le fichier — toutes les lignes concernées en erreur.
    const occurrences = new Map<string, number[]>();
    for (const c of candidats) {
      if (!c.code) continue;
      occurrences.set(c.code, [...(occurrences.get(c.code) ?? []), c.ligne]);
    }
    const codesEnDoublonFichier = new Set(
      [...occurrences.entries()].filter(([, lignes]) => lignes.length > 1).map(([code]) => code),
    );

    // Code déjà présent dans le catalogue national — mise à jour, pas une erreur.
    const codesCandidats = candidats.filter((c) => c.code).map((c) => c.code);
    const existants = codesCandidats.length
      ? await this.prisma.referentielNationalActe.findMany({
          where: { code: { in: codesCandidats }, deletedAt: null },
          select: { id: true, code: true },
        })
      : [];
    const idParCode = new Map(existants.map((e) => [e.code, e.id]));

    const lignesValides: LigneActeCatalogue[] = [];
    const erreursDetail: LigneErreurCatalogue[] = [];
    for (const c of candidats) {
      const erreursFinales = [...c.erreurs];
      if (c.code && codesEnDoublonFichier.has(c.code)) {
        erreursFinales.push(`code en doublon dans le fichier (${c.code})`);
      }
      if (erreursFinales.length === 0) {
        const idExistant = idParCode.get(c.code) ?? null;
        lignesValides.push({
          code: c.code,
          libelle: c.libelle,
          categorie: c.categorie,
          cotation: c.cotation,
          estMiseAJour: idExistant !== null,
          idExistant,
        });
      } else {
        erreursDetail.push({ ligne: c.ligne, donnees: c.donnees, erreurs: erreursFinales });
      }
    }

    return { lignesValides, erreursDetail };
  }

  private async parserMedicaments(
    fichier: FichierTeleverse,
  ): Promise<{ lignesValides: LigneMedicamentCatalogue[]; erreursDetail: LigneErreurCatalogue[] }> {
    const feuille = await this.chargerFeuille(fichier);
    if (!feuille || feuille.rowCount < 2) {
      return { lignesValides: [], erreursDetail: [] };
    }

    const ligneEntete = feuille.getRow(1);
    const colonnes = new Map<ColonneMedicament, number>();
    ligneEntete.eachCell((cell, colNumber) => {
      const cle = ALIAS_ENTETES_MEDICAMENTS[normaliserEntete(String(cell.value ?? ''))];
      if (cle) colonnes.set(cle, colNumber);
    });
    if (!colonnes.has('denominationCommune')) {
      throw new BadRequestException('Colonne manquante dans le fichier : denomination_commune.');
    }

    const brut = (n: number, col: ColonneMedicament) => {
      const idx = colonnes.get(col);
      if (!idx) return '';
      const valeur = feuille.getRow(n).getCell(idx).value;
      if (valeur === null || valeur === undefined) return '';
      if (typeof valeur === 'object' && 'text' in (valeur as any)) return String((valeur as any).text ?? '');
      return String(valeur).trim();
    };

    const candidats: {
      ligne: number;
      donnees: Record<string, string>;
      denominationCommune: string;
      nomCommercial: string | null;
      classeTherapeutique: string | null;
      prixReferenceXof: string | null;
      medicamentEssentiel: boolean;
      erreurs: string[];
    }[] = [];

    for (let n = 2; n <= feuille.rowCount; n++) {
      const row = feuille.getRow(n);
      if (row.cellCount === 0) continue;
      const denominationCommune = brut(n, 'denominationCommune');
      const nomCommercial = brut(n, 'nomCommercial');
      const classeTherapeutique = brut(n, 'classeTherapeutique');
      const prixBrut = brut(n, 'prixReferenceXof');
      const essentielBrut = brut(n, 'medicamentEssentiel');
      if (!denominationCommune && !nomCommercial && !classeTherapeutique && !prixBrut && !essentielBrut) continue;

      const donnees = {
        denominationCommune,
        nomCommercial,
        classeTherapeutique,
        prixReferenceXof: prixBrut,
        medicamentEssentiel: essentielBrut,
      };
      const erreurs: string[] = [];
      if (!denominationCommune) erreurs.push('dénomination commune manquante');

      let prixReferenceXof: string | null = null;
      if (prixBrut) {
        try {
          const prix = new Decimal(prixBrut.replace(',', '.'));
          if (!prix.isFinite() || prix.isNegative()) {
            erreurs.push(`prix de référence invalide (${prixBrut})`);
          } else {
            prixReferenceXof = prix.toFixed(2);
          }
        } catch {
          erreurs.push(`prix de référence invalide (${prixBrut})`);
        }
      }

      candidats.push({
        ligne: n,
        donnees,
        denominationCommune,
        nomCommercial: nomCommercial || null,
        classeTherapeutique: classeTherapeutique || null,
        prixReferenceXof,
        medicamentEssentiel: VALEURS_VRAI.includes(essentielBrut.toLowerCase()),
        erreurs,
      });
    }

    // Doublon de DCI (insensible à la casse) DANS le fichier — toutes les
    // lignes concernées en erreur.
    const occurrences = new Map<string, number[]>();
    for (const c of candidats) {
      if (!c.denominationCommune) continue;
      const cle = c.denominationCommune.toLowerCase();
      occurrences.set(cle, [...(occurrences.get(cle) ?? []), c.ligne]);
    }
    const dciEnDoublonFichier = new Set(
      [...occurrences.entries()].filter(([, lignes]) => lignes.length > 1).map(([dci]) => dci),
    );

    // DCI déjà présente dans le catalogue national — mise à jour, pas une erreur.
    const dciCandidates = candidats.filter((c) => c.denominationCommune).map((c) => c.denominationCommune);
    const existants = dciCandidates.length
      ? await this.prisma.referentielNationalMedicament.findMany({
          where: { denominationCommune: { in: dciCandidates, mode: 'insensitive' }, deletedAt: null },
          select: { id: true, denominationCommune: true },
        })
      : [];
    const idParDci = new Map(existants.map((e) => [e.denominationCommune.toLowerCase(), e.id]));

    const lignesValides: LigneMedicamentCatalogue[] = [];
    const erreursDetail: LigneErreurCatalogue[] = [];
    for (const c of candidats) {
      const erreursFinales = [...c.erreurs];
      const cleDci = c.denominationCommune.toLowerCase();
      if (c.denominationCommune && dciEnDoublonFichier.has(cleDci)) {
        erreursFinales.push(`dénomination commune en doublon dans le fichier (${c.denominationCommune})`);
      }
      if (erreursFinales.length === 0) {
        const idExistant = idParDci.get(cleDci) ?? null;
        lignesValides.push({
          denominationCommune: c.denominationCommune,
          nomCommercial: c.nomCommercial,
          classeTherapeutique: c.classeTherapeutique,
          prixReferenceXof: c.prixReferenceXof,
          medicamentEssentiel: c.medicamentEssentiel,
          estMiseAJour: idExistant !== null,
          idExistant,
        });
      } else {
        erreursDetail.push({ ligne: c.ligne, donnees: c.donnees, erreurs: erreursFinales });
      }
    }

    return { lignesValides, erreursDetail };
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
