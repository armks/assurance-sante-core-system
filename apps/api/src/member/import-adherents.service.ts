import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isEmail } from 'class-validator';
import ExcelJS from 'exceljs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberCarteService } from './carte.service';
import {
  ContexteAppelant,
  ROLES_IMPORT_ADHERENTS,
  ROLES_VALIDATION_IMPORT_ADHERENTS,
} from './member.types';

/** Forme minimale d'un fichier téléversé (multer, mémoire) — même convention
 * que les autres modules à upload (contestation/, payment/). */
export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface LigneValide {
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  dateNaissance: string; // ISO (YYYY-MM-DD)
}

interface LigneErreur {
  ligne: number;
  donnees: Record<string, string>;
  erreurs: string[];
}

const TAILLE_MAX_FICHIER_OCTETS = 5 * 1024 * 1024;
const MIME_TYPES_AUTORISES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // certains navigateurs/OS n'envoient pas le MIME xlsx exact
];

/** Alias d'en-tête acceptés (normalisés : minuscule, sans accent, sans espace/tiret/underscore). */
const ALIAS_ENTETES: Record<string, keyof LigneValide> = {
  nom: 'nom',
  prenom: 'prenom',
  telephone: 'telephone',
  tel: 'telephone',
  email: 'email',
  mail: 'email',
  datenaissance: 'dateNaissance',
  datedenaissance: 'dateNaissance',
  ddn: 'dateNaissance',
};

function normaliserEntete(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

// Téléphone : chiffres uniquement, + optionnel en tête, 8 à 15 chiffres —
// permissif (formats CI et internationaux), pas de norme unique imposée.
const REGEX_TELEPHONE = /^\+?[0-9]{8,15}$/;

type Db = PrismaService | Prisma.TransactionClient;

/**
 * ImportAdherentsService — import en masse d'adhérents (titulaires) depuis un
 * fichier Excel pour une société cliente déjà créée avec sa police/formule
 * (`member/`, un domaine métier strict — réutilise `MemberCarteService` du
 * même module plutôt que de dupliquer la génération de carte).
 *
 * Deux étapes séparées, jamais fusionnées : `importerAdherentsExcel` ne crée
 * AUCUN `Adherent` — seule `validerImportAdherents` (rôles distincts) le fait,
 * réutilisant la séquence `adherents_numero_seq` déjà en place (numérotation
 * chronologique automatique, comme `creerAdherent`).
 */
@Injectable()
export class ImportAdherentsService {
  private readonly logger = new Logger(ImportAdherentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly cartes: MemberCarteService,
  ) {}

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
      societeId: profil.societeId ?? null,
      entite: profil.entite ?? null,
      adherentId: profil.adherentId ?? null,
    };
  }

  private assertImport(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_IMPORT_ADHERENTS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "L'import d'adhérents est réservé à ASSUREUR_INFORMATIQUE et ASSUREUR_COMPTABLE.",
      );
    }
  }

  private assertValidation(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_VALIDATION_IMPORT_ADHERENTS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "La validation d'un import est réservée à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.",
      );
    }
  }

  /**
   * Parse le fichier .xlsx et journalise l'import en EN_ATTENTE_VALIDATION —
   * AUCUN `Adherent` créé ici. Chaque ligne en erreur (email en doublon,
   * téléphone invalide, champ obligatoire manquant) est listée précisément
   * dans `erreursDetail`, sans jamais bloquer l'import des lignes valides.
   */
  async importerAdherentsExcel(user: AuthenticatedUser, souscripteurId: string, fichier: FichierTeleverse) {
    const ctx = await this.contexteAppelant(user);
    this.assertImport(ctx);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: { id: souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }

    if (!MIME_TYPES_AUTORISES.includes(fichier.mimetype) && !fichier.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Seul un fichier .xlsx est accepté.');
    }
    if (fichier.size > TAILLE_MAX_FICHIER_OCTETS) {
      throw new BadRequestException('Fichier trop volumineux (max 5 Mo).');
    }

    const { lignesValides, erreursDetail } = await this.parserEtValider(ctx, fichier);
    const nbLignesTotal = lignesValides.length + erreursDetail.length;
    if (nbLignesTotal === 0) {
      throw new BadRequestException(
        "Fichier vide ou colonnes non reconnues (attendues : nom, prénom, téléphone, email, date de naissance).",
      );
    }

    const importCree = await this.prisma.$transaction(async (tx) => {
      const imp = await tx.importAdherents.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId,
          fichierNom: fichier.originalname,
          statut: 'EN_ATTENTE_VALIDATION',
          nbLignesTotal,
          nbLignesValides: lignesValides.length,
          nbLignesErreur: erreursDetail.length,
          lignesValides: lignesValides as unknown as object,
          erreursDetail: erreursDetail as unknown as object,
          importeParId: ctx.userId,
        },
      });
      await this.audit(tx, ctx.userId, 'IMPORT_ADHERENTS_EXCEL', imp.id, {
        souscripteurId,
        fichierNom: fichier.originalname,
        nbLignesTotal,
        nbLignesValides: lignesValides.length,
        nbLignesErreur: erreursDetail.length,
      });
      return imp;
    });

    return importCree;
  }

  async listerImportsAdherents(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const rolesAutorises: readonly string[] = [...ROLES_IMPORT_ADHERENTS, ...ROLES_VALIDATION_IMPORT_ADHERENTS];
    if (!ctx.roleChain.some((code) => rolesAutorises.includes(code))) {
      throw new ForbiddenException("Accès réservé au personnel habilité à l'import des adhérents.");
    }
    return this.prisma.importAdherents.findMany({
      where: { organisationId: ctx.organisationId },
      include: {
        souscripteur: { select: { id: true, nom: true } },
        importePar: { select: { role: true } },
        validePar: { select: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Crée les `Adherent` réels (numéro chronologique via la séquence
   * existante) et leur carte (`MemberCarteService.genererCarteAdherent`,
   * réutilisée telle quelle) — SEUL moment où l'import a un effet en base.
   * Un échec ponctuel de génération de carte (ex. Storage indisponible) ne
   * bloque pas les autres lignes ni la validation elle-même — l'adhérent
   * existe déjà, sa carte peut être régénérée séparément plus tard.
   */
  async validerImportAdherents(user: AuthenticatedUser, importId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertValidation(ctx);

    const imp = await this.prisma.importAdherents.findFirst({
      where: { id: importId, organisationId: ctx.organisationId },
    });
    if (!imp) {
      throw new NotFoundException('Import introuvable.');
    }
    if (imp.statut !== 'EN_ATTENTE_VALIDATION') {
      throw new ConflictException(`Cet import est déjà ${imp.statut}.`);
    }
    const lignes = imp.lignesValides as unknown as LigneValide[];
    if (!lignes || lignes.length === 0) {
      throw new ConflictException('Aucune ligne valide à importer.');
    }

    const police = await this.prisma.police.findFirst({
      where: { souscripteurId: imp.souscripteurId, organisationId: ctx.organisationId, statut: 'ACTIVE', deletedAt: null },
    });
    if (!police) {
      throw new ConflictException('Aucune police ACTIVE pour ce souscripteur — validation impossible.');
    }

    const adherentIds: string[] = [];
    for (const ligne of lignes) {
      const adherent = await this.prisma.$transaction(async (tx) => {
        const a = await tx.adherent.create({
          data: {
            organisationId: ctx.organisationId,
            souscripteurId: imp.souscripteurId,
            policeId: police.id,
            nom: ligne.nom,
            prenom: ligne.prenom,
            dateNaissance: new Date(ligne.dateNaissance),
            email: ligne.email,
            telephone: ligne.telephone,
          },
        });
        await this.audit(tx, ctx.userId, 'CREATION_ADHERENT_IMPORT', a.id, {
          importId: imp.id,
          numeroAdherent: a.numeroAdherent,
        }, 'adherents');
        return a;
      });
      adherentIds.push(adherent.id);
    }

    const echecsCarte: string[] = [];
    for (const adherentId of adherentIds) {
      try {
        await this.cartes.genererCarteAdherent(user, adherentId);
      } catch (error) {
        echecsCarte.push(adherentId);
        this.logger.error(
          `Génération de carte échouée pour l'adhérent ${adherentId} (import ${importId}) : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
    }

    const importMaj = await this.prisma.$transaction(async (tx) => {
      const imp2 = await tx.importAdherents.update({
        where: { id: importId },
        data: { statut: 'VALIDE', valideParId: ctx.userId, dateValidation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_IMPORT_ADHERENTS', imp2.id, {
        nbAdherentsCrees: adherentIds.length,
        nbCartesEnEchec: echecsCarte.length,
      });
      return imp2;
    });

    return { ...importMaj, nbAdherentsCrees: adherentIds.length, adherentIds, echecsCarte };
  }

  // --- Parsing Excel ---------------------------------------------------

  private async parserEtValider(
    ctx: ContexteAppelant,
    fichier: FichierTeleverse,
  ): Promise<{ lignesValides: LigneValide[]; erreursDetail: LigneErreur[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fichier.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Fichier .xlsx illisible ou corrompu.');
    }
    const feuille = workbook.worksheets[0];
    if (!feuille || feuille.rowCount < 2) {
      return { lignesValides: [], erreursDetail: [] };
    }

    const ligneEntete = feuille.getRow(1);
    const colonnes = new Map<keyof LigneValide, number>();
    ligneEntete.eachCell((cell, colNumber) => {
      const cle = ALIAS_ENTETES[normaliserEntete(String(cell.value ?? ''))];
      if (cle) colonnes.set(cle, colNumber);
    });
    const manquantes = (['nom', 'prenom', 'telephone', 'email', 'dateNaissance'] as const).filter(
      (c) => !colonnes.has(c),
    );
    if (manquantes.length > 0) {
      throw new BadRequestException(`Colonnes manquantes dans le fichier : ${manquantes.join(', ')}.`);
    }

    const brut = (n: number, col: keyof LigneValide) => {
      const idx = colonnes.get(col)!;
      const valeur = feuille.getRow(n).getCell(idx).value;
      if (valeur instanceof Date) return valeur;
      if (valeur === null || valeur === undefined) return '';
      if (typeof valeur === 'object' && 'text' in (valeur as any)) return String((valeur as any).text ?? '');
      return String(valeur).trim();
    };

    const candidats: { ligne: number; donnees: Record<string, string>; parsed: LigneValide | null; erreurs: string[] }[] = [];

    for (let n = 2; n <= feuille.rowCount; n++) {
      const row = feuille.getRow(n);
      if (row.cellCount === 0) continue;
      const nom = String(brut(n, 'nom'));
      const prenom = String(brut(n, 'prenom'));
      const telephone = String(brut(n, 'telephone')).replace(/[\s.-]/g, '');
      const email = String(brut(n, 'email')).trim().toLowerCase();
      const dateBrute = brut(n, 'dateNaissance');

      if (!nom && !prenom && !telephone && !email && !dateBrute) continue; // ligne vide, ignorée silencieusement

      const donnees = { nom, prenom, telephone, email, dateNaissance: String(dateBrute) };
      const erreurs: string[] = [];

      if (!nom) erreurs.push('nom manquant');
      if (!prenom) erreurs.push('prénom manquant');
      if (!telephone) erreurs.push('téléphone manquant');
      else if (!REGEX_TELEPHONE.test(telephone)) erreurs.push(`téléphone invalide (${telephone})`);
      if (!email) erreurs.push('email manquant');
      else if (!isEmail(email)) erreurs.push(`email invalide (${email})`);

      const dateNaissance = this.parserDate(dateBrute);
      if (!dateNaissance) erreurs.push('date de naissance invalide ou manquante');

      candidats.push({
        ligne: n,
        donnees,
        erreurs,
        parsed: erreurs.length === 0 ? { nom, prenom, telephone, email, dateNaissance: dateNaissance!.toISOString().slice(0, 10) } : null,
      });
    }

    // Doublon d'email DANS le fichier — toutes les lignes concernées en erreur.
    const occurrences = new Map<string, number[]>();
    for (const c of candidats) {
      if (!c.parsed) continue;
      const cle = c.parsed.email;
      occurrences.set(cle, [...(occurrences.get(cle) ?? []), c.ligne]);
    }
    const emailsEnDoublonFichier = new Set(
      [...occurrences.entries()].filter(([, lignes]) => lignes.length > 1).map(([email]) => email),
    );

    // Doublon d'email déjà présent en base (organisation entière).
    const emailsCandidats = candidats.filter((c) => c.parsed).map((c) => c.parsed!.email);
    const existants = emailsCandidats.length
      ? await this.prisma.adherent.findMany({
          where: { organisationId: ctx.organisationId, email: { in: emailsCandidats }, deletedAt: null },
          select: { email: true },
        })
      : [];
    const emailsExistants = new Set(existants.map((a) => a.email!));

    const lignesValides: LigneValide[] = [];
    const erreursDetail: LigneErreur[] = [];
    for (const c of candidats) {
      const erreursFinales = [...c.erreurs];
      if (c.parsed && emailsEnDoublonFichier.has(c.parsed.email)) {
        erreursFinales.push(`email en doublon dans le fichier (${c.parsed.email})`);
      }
      if (c.parsed && emailsExistants.has(c.parsed.email)) {
        erreursFinales.push(`email déjà utilisé par un adhérent existant (${c.parsed.email})`);
      }
      if (erreursFinales.length === 0 && c.parsed) {
        lignesValides.push(c.parsed);
      } else {
        erreursDetail.push({ ligne: c.ligne, donnees: c.donnees, erreurs: erreursFinales });
      }
    }

    return { lignesValides, erreursDetail };
  }

  private parserDate(valeur: unknown): Date | null {
    if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) return valeur;
    if (typeof valeur !== 'string' || !valeur.trim()) return null;
    const s = valeur.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // DD/MM/YYYY ou DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const [, jj, mm, aaaa] = m;
      const d = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(jj)));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Record<string, unknown> | null,
    tableCible: string = 'imports_adherents',
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
    }
  }
}
