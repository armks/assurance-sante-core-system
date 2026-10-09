import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { LettresClesService } from '../reference/lettres-cles.service';
import {
  ArchiverConventionDto,
  CreerConventionDto,
  ListerConventionsQueryDto,
  ModifierConventionDto,
  NouvelleVersionDto,
  RemplacerActesDto,
  RemplacerValeursDto,
} from './dto/conventions.dto';
import {
  ROLES_LECTURE_CONVENTION,
  ROLES_SAISIE_CONVENTION,
  ROLES_VALIDATION_CONVENTION,
  TAILLE_MAX_DOCUMENT_OCTETS,
  TYPES_DOCUMENT,
  VALEUR_MAX,
} from './conventions.types';

type Db = PrismaService | Prisma.TransactionClient;

export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface Ctx {
  userId: string;
  organisationId: string;
  roleChain: string[];
}

const JOUR_MS = 86_400_000;
const jour = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const veille = (d: Date): Date => new Date(d.getTime() - JOUR_MS);
const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const aujourdhui = (): Date => jour(new Date().toISOString());
const MOTIF_EXCLUSION = /exclusion constraint|23P01/i;

/**
 * ConventionsService — conventions établissement × assureur (ADR-008, lot 2).
 *
 * Circuit : saisie par l'assurance informatique (PROPOSEE), validation par le médecin conseil ou la direction —
 * jamais par la personne qui l'a saisie ou modifiée. Une convention VALIDEE n'est plus modifiable : « nouvelle
 * version » (l'ancienne est fermée à la validation de la nouvelle). Refus avec motif obligatoire.
 *
 * `tarifs_conventionnes` reste la table lue par le microservice Java jusqu'au lot 3 : les forfaits d'une convention
 * VALIDEE y sont projetés (même identifiant), fermés avec la convention. Le calcul Java n'est pas modifié ici.
 *
 * Journalisation (ADR-007) : succès via log_audit() dans la transaction ; refus métier tracés à part
 * (`DependancesService.tracerRefusMetier`), hors transaction.
 */
@Injectable()
export class ConventionsService {
  private readonly logger = new Logger(ConventionsService.name);
  private readonly dureeUrlSignee = Number(process.env.CONVENTION_URL_TTL_SECONDS ?? 600);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
    private readonly lettresCles: LettresClesService,
  ) {}

  // ------------------------------------------------------------------ contexte et rôles

  private async contexte(user: AuthenticatedUser): Promise<Ctx> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private aRole(ctx: Ctx, roles: readonly string[]): boolean {
    return ctx.roleChain.some((r) => roles.includes(r));
  }

  private assertLecture(ctx: Ctx): void {
    if (!this.aRole(ctx, ROLES_LECTURE_CONVENTION)) {
      throw new ForbiddenException('Réservé à l’assurance informatique, au médecin conseil et à la direction.');
    }
  }

  private assertSaisie(ctx: Ctx): void {
    if (!this.aRole(ctx, ROLES_SAISIE_CONVENTION)) {
      throw new ForbiddenException('La saisie des conventions est réservée à l’assurance informatique.');
    }
  }

  private async refuser(user: AuthenticatedUser, id: string, action: string, raison: string, ctxRole = false): Promise<never> {
    await this.dependances.tracerRefusMetier(user, 'conventions', id, action, raison);
    throw ctxRole ? new ForbiddenException(raison) : new ConflictException(raison);
  }

  // ------------------------------------------------------------------ lecture

  private async charger(ctx: Ctx, id: string) {
    const c = await this.prisma.convention.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
      include: {
        etablissement: { select: { id: true, nom: true, code: true, statut: true } },
        precedente: { select: { id: true, numero: true, version: true, statut: true } },
        suivantes: { where: { deletedAt: null }, select: { id: true, numero: true, version: true, statut: true } },
        valeurs: { where: { deletedAt: null }, orderBy: [{ lettreCleCode: 'asc' }, { contexte: 'asc' }] },
        actes: {
          where: { deletedAt: null },
          include: { referentielActe: { select: { id: true, code: true, libelle: true, lettreCleCode: true, coefficient: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!c) throw new NotFoundException('Convention introuvable.');
    return c;
  }

  async lister(user: AuthenticatedUser, q: ListerConventionsQueryDto = {}) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const conventions = await this.prisma.convention.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(q.etablissementId ? { etablissementId: q.etablissementId } : {}),
        ...(q.statut ? { statut: q.statut } : {}),
      },
      include: {
        etablissement: { select: { id: true, nom: true, code: true } },
        _count: { select: { valeurs: { where: { deletedAt: null } }, actes: { where: { deletedAt: null } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return conventions.map((c) => ({
      id: c.id,
      numero: c.numero,
      version: c.version,
      statut: c.statut,
      historique: c.historique,
      dateDebut: iso(c.dateDebut),
      dateFin: iso(c.dateFin),
      politiqueDepassement: c.politiqueDepassement,
      aDocument: Boolean(c.documentChemin),
      etablissement: c.etablissement,
      nbValeurs: c._count.valeurs,
      nbActes: c._count.actes,
      motifRefus: c.motifRefus,
    }));
  }

  /** Détail complet + ce que l'appelant peut faire et ce qui bloque la validation (pour l'écran). */
  async obtenir(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const c = await this.charger(ctx, id);
    const ids = [c.saisiPar, c.modifiePar, c.validePar, c.refusePar].filter((x): x is string => Boolean(x));
    const profils = ids.length
      ? await this.prisma.profil.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } })
      : [];
    const role = (pid: string | null) => (pid ? { id: pid, role: profils.find((p) => p.id === pid)?.role ?? null } : null);
    return {
      id: c.id,
      numero: c.numero,
      version: c.version,
      statut: c.statut,
      historique: c.historique,
      dateDebut: iso(c.dateDebut),
      dateFin: iso(c.dateFin),
      politiqueDepassement: c.politiqueDepassement,
      document: c.documentChemin ? { nom: c.documentNom, type: c.documentType } : null,
      etablissement: c.etablissement,
      precedente: c.precedente,
      suivantes: c.suivantes,
      saisiPar: role(c.saisiPar),
      dateSaisie: c.dateSaisie,
      modifiePar: role(c.modifiePar),
      validePar: role(c.validePar),
      dateValidation: c.dateValidation,
      refusePar: role(c.refusePar),
      dateRefus: c.dateRefus,
      motifRefus: c.motifRefus,
      valeurs: c.valeurs.map((v) => ({ id: v.id, lettreCleCode: v.lettreCleCode, contexte: v.contexte, valeur: v.valeur.toFixed(2) })),
      actes: c.actes.map((a) => ({
        id: a.id,
        referentielActeId: a.referentielActeId,
        code: a.referentielActe.code,
        libelle: a.referentielActe.libelle,
        lettreCleCode: a.referentielActe.lettreCleCode,
        coefficient: a.referentielActe.coefficient?.toString() ?? null,
        prixForfaitaire: a.prixForfaitaire?.toFixed(2) ?? null,
        valeurLettreCle: a.valeurLettreCle?.toFixed(2) ?? null,
        dateDebut: iso(a.dateDebut),
        dateFin: iso(a.dateFin),
      })),
      moi: { id: ctx.userId },
      blocagesValidation: await this.blocagesValidation(ctx, c),
    };
  }

  /** Raisons pour lesquelles l'appelant ne peut PAS valider maintenant (vide = il peut). */
  private async blocagesValidation(ctx: Ctx, c: Awaited<ReturnType<ConventionsService['charger']>>): Promise<string[]> {
    const raisons: string[] = [];
    if (!this.aRole(ctx, ROLES_VALIDATION_CONVENTION)) raisons.push('Votre rôle ne permet pas de valider une convention.');
    if (c.statut !== 'PROPOSEE') raisons.push(`La convention est ${c.statut.toLowerCase()} : seule une convention proposée se valide.`);
    if (c.saisiPar === ctx.userId || c.modifiePar === ctx.userId) raisons.push('Vous avez saisi ou modifié cette convention : la validation revient à une autre personne.');
    if (!c.documentChemin) raisons.push('Le document signé n’est pas joint.');
    if (c.valeurs.length === 0 && c.actes.length === 0) raisons.push('Aucune valeur de lettre-clé ni exception par acte n’est saisie.');
    return raisons;
  }

  /** Indicateur du tableau de bord : établissements actifs sans convention VALIDEE en vigueur aujourd'hui. */
  async indicateurs(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const auj = aujourdhui();
    const [etablissements, enVigueur, aValider] = await Promise.all([
      this.prisma.etablissementSante.findMany({
        where: { organisationId: ctx.organisationId, deletedAt: null, statut: 'ACTIF' },
        select: { id: true, nom: true, code: true },
        orderBy: { nom: 'asc' },
      }),
      this.prisma.convention.findMany({
        where: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          // en vigueur aujourd'hui : validée, ou fermée (archivée) dont la période court encore
          statut: { in: ['VALIDEE', 'ARCHIVEE'] },
          dateDebut: { lte: auj },
          OR: [{ dateFin: null }, { dateFin: { gte: auj } }],
        },
        select: { etablissementId: true },
      }),
      this.prisma.convention.count({ where: { organisationId: ctx.organisationId, deletedAt: null, statut: 'PROPOSEE' } }),
    ]);
    const couverts = new Set(enVigueur.map((c) => c.etablissementId));
    const sans = etablissements.filter((e) => !couverts.has(e.id));
    return {
      etablissementsActifs: etablissements.length,
      sansConventionValidee: sans.length,
      etablissementsSansConvention: sans,
      conventionsAValider: aValider,
    };
  }

  /** Lettres-clés ACTIVES proposées au formulaire (le référentiel complet reste au superadmin). */
  async lettresClesActives(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    return (await this.lettresCles.lister())
      .filter((l) => l.actif)
      .map((l) => ({ code: l.code, libelle: l.libelle, ordre: l.ordre }));
  }

  // ------------------------------------------------------------------ saisie

  private async assertEtablissement(ctx: Ctx, etablissementId: string) {
    const e = await this.prisma.etablissementSante.findFirst({
      where: { id: etablissementId, organisationId: ctx.organisationId, deletedAt: null },
      select: { id: true, nom: true, statut: true },
    });
    if (!e) throw new NotFoundException('Établissement introuvable.');
    if (e.statut === 'RESILIE') {
      throw new ConflictException(`L’établissement « ${e.nom} » est archivé : aucune nouvelle convention.`);
    }
    return e;
  }

  private verifierPeriode(debut: Date, fin: Date | null) {
    if (Number.isNaN(debut.getTime())) throw new BadRequestException('Date de début invalide.');
    if (fin && fin < debut) throw new BadRequestException('La date de fin doit être postérieure ou égale à la date de début.');
  }

  async creer(user: AuthenticatedUser, dto: CreerConventionDto) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const etab = await this.assertEtablissement(ctx, dto.etablissementId);
    const numero = dto.numero.trim();
    if (!numero) throw new BadRequestException('Le numéro de la convention est obligatoire.');
    const debut = jour(dto.dateDebut);
    const fin = dto.dateFin ? jour(dto.dateFin) : null;
    this.verifierPeriode(debut, fin);
    if (await this.prisma.convention.count({ where: { organisationId: ctx.organisationId, numero, deletedAt: null } })) {
      throw new ConflictException(`Une convention porte déjà le numéro « ${numero} » : utilisez « Nouvelle version » pour la faire évoluer.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.convention.create({
        data: {
          organisationId: ctx.organisationId,
          etablissementId: etab.id,
          numero,
          dateDebut: debut,
          dateFin: fin,
          politiqueDepassement: dto.politiqueDepassement ?? 'PATIENT',
          saisiPar: ctx.userId,
        },
      });
      await this.audit(tx, ctx.userId, 'CREATION_CONVENTION', c.id, { numero, etablissement: etab.nom, dateDebut: iso(debut), dateFin: iso(fin) });
      return { id: c.id, numero: c.numero, statut: c.statut };
    });
  }

  async modifier(user: AuthenticatedUser, id: string, dto: ModifierConventionDto) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const avant = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'modifier');
    const numero = dto.numero !== undefined ? dto.numero.trim() : avant.numero;
    if (!numero) throw new BadRequestException('Le numéro de la convention est obligatoire.');
    if (numero !== avant.numero && (await this.prisma.convention.count({ where: { organisationId: ctx.organisationId, numero, deletedAt: null, id: { not: id } } }))) {
      throw new ConflictException(`Une convention porte déjà le numéro « ${numero} ».`);
    }
    const debut = dto.dateDebut ? jour(dto.dateDebut) : avant.dateDebut;
    const fin = dto.dateFin === undefined ? avant.dateFin : dto.dateFin ? jour(dto.dateFin) : null;
    this.verifierPeriode(debut, fin);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.convention.update({
        where: { id },
        data: { numero, dateDebut: debut, dateFin: fin, politiqueDepassement: dto.politiqueDepassement ?? avant.politiqueDepassement, modifiePar: ctx.userId },
      });
      await this.audit(tx, ctx.userId, 'MODIFICATION_CONVENTION', id, {
        avant: { numero: avant.numero, dateDebut: iso(avant.dateDebut), dateFin: iso(avant.dateFin), politiqueDepassement: avant.politiqueDepassement },
        apres: { numero, dateDebut: iso(debut), dateFin: iso(fin), politiqueDepassement: c.politiqueDepassement },
      });
      return { id, statut: c.statut };
    });
  }

  /** Remplace d'un bloc les valeurs par lettre-clé et contexte (le formulaire est enregistré en une fois). */
  async remplacerValeurs(user: AuthenticatedUser, id: string, dto: RemplacerValeursDto) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'modifier');
    const actives = await this.lettresCles.codesActifs();
    const vus = new Set<string>();
    const lignes = dto.valeurs.map((v) => {
      const code = v.lettreCleCode.trim().toUpperCase();
      if (!actives.has(code)) throw new BadRequestException(`Lettre-clé inconnue ou inactive : ${code}.`);
      const cle = `${code}|${v.contexte}`;
      if (vus.has(cle)) throw new BadRequestException(`Valeur en double pour ${code} (${v.contexte.toLowerCase()}).`);
      vus.add(cle);
      if (!(v.valeur > 0) || v.valeur > VALEUR_MAX) throw new BadRequestException(`Valeur invalide pour ${code} : strictement positive.`);
      return { code, contexte: v.contexte, valeur: new Decimal(v.valeur).toFixed(2) };
    });
    return this.prisma.$transaction(async (tx) => {
      const existantes = conv.valeurs;
      const garder = new Set(lignes.map((l) => `${l.code}|${l.contexte}`));
      for (const e of existantes) {
        if (!garder.has(`${e.lettreCleCode}|${e.contexte}`)) await tx.conventionValeur.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
      }
      for (const l of lignes) {
        const e = existantes.find((x) => x.lettreCleCode === l.code && x.contexte === l.contexte);
        if (e) {
          if (e.valeur.toFixed(2) !== l.valeur) await tx.conventionValeur.update({ where: { id: e.id }, data: { valeur: l.valeur } });
        } else {
          await tx.conventionValeur.create({ data: { conventionId: id, lettreCleCode: l.code, contexte: l.contexte, valeur: l.valeur } });
        }
      }
      await tx.convention.update({ where: { id }, data: { modifiePar: ctx.userId } });
      await this.audit(tx, ctx.userId, 'MODIFICATION_VALEURS_CONVENTION', id, {
        numero: conv.numero,
        avant: existantes.map((e) => ({ lettre: e.lettreCleCode, contexte: e.contexte, valeur: e.valeur.toFixed(2) })),
        apres: lignes.map((l) => ({ lettre: l.code, contexte: l.contexte, valeur: l.valeur })),
      });
      return { id, nbValeurs: lignes.length };
    });
  }

  /** Remplace d'un bloc les exceptions par acte : forfait OU valeur de lettre-clé propre à l'acte. */
  async remplacerActes(user: AuthenticatedUser, id: string, dto: RemplacerActesDto) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'modifier');
    const ids = dto.actes.map((a) => a.referentielActeId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Un acte ne peut figurer qu’une fois dans la convention.');
    const actes = await this.prisma.referentielActe.findMany({
      where: { id: { in: ids }, organisationId: ctx.organisationId, deletedAt: null },
      select: { id: true, code: true, lettreCleCode: true },
    });
    const lignes = dto.actes.map((a) => {
      const acte = actes.find((x) => x.id === a.referentielActeId);
      if (!acte) throw new NotFoundException('Acte introuvable dans votre référentiel.');
      const forfait = a.prixForfaitaire ?? null;
      const propre = a.valeurLettreCle ?? null;
      if ((forfait === null) === (propre === null)) {
        throw new BadRequestException(`Acte ${acte.code} : renseignez un forfait OU une valeur de lettre-clé propre à l’acte, jamais les deux ni aucun.`);
      }
      if (propre !== null && !acte.lettreCleCode) {
        throw new BadRequestException(`Acte ${acte.code} : une valeur de lettre-clé propre exige que l’acte soit coté (lettre-clé et coefficient).`);
      }
      const valeur = forfait ?? propre!;
      if (!(valeur > 0) || valeur > VALEUR_MAX) throw new BadRequestException(`Acte ${acte.code} : montant invalide.`);
      return { acteId: acte.id, code: acte.code, forfait: forfait !== null ? new Decimal(forfait).toFixed(2) : null, propre: propre !== null ? new Decimal(propre).toFixed(2) : null };
    });
    return this.prisma.$transaction(async (tx) => {
      const existantes = conv.actes;
      const garder = new Set(lignes.map((l) => l.acteId));
      for (const e of existantes) {
        if (!garder.has(e.referentielActeId)) await tx.conventionActe.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
      }
      for (const l of lignes) {
        const e = existantes.find((x) => x.referentielActeId === l.acteId);
        const data = { prixForfaitaire: l.forfait, valeurLettreCle: l.propre };
        if (e) {
          if (e.prixForfaitaire?.toFixed(2) !== l.forfait || e.valeurLettreCle?.toFixed(2) !== l.propre) {
            await tx.conventionActe.update({ where: { id: e.id }, data });
          }
        } else {
          await tx.conventionActe.create({ data: { conventionId: id, referentielActeId: l.acteId, ...data } });
        }
      }
      await tx.convention.update({ where: { id }, data: { modifiePar: ctx.userId } });
      await this.audit(tx, ctx.userId, 'MODIFICATION_ACTES_CONVENTION', id, {
        numero: conv.numero,
        avant: existantes.map((e) => ({ acte: e.referentielActe.code, forfait: e.prixForfaitaire?.toFixed(2) ?? null, valeurLettreCle: e.valeurLettreCle?.toFixed(2) ?? null })),
        apres: lignes.map((l) => ({ acte: l.code, forfait: l.forfait, valeurLettreCle: l.propre })),
      });
      return { id, nbActes: lignes.length };
    });
  }

  // ------------------------------------------------------------------ document signé (Storage privé)

  private get baseStorage(): string {
    return `${process.env.SUPABASE_URL ?? ''}/storage/v1`;
  }
  private get cleService(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }
  private enTetes(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.cleService}`, apikey: this.cleService, ...extra };
  }
  private assertStorage() {
    if (!process.env.SUPABASE_URL || !this.cleService) {
      throw new ServiceUnavailableException('Stockage des documents indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
    }
  }

  async joindreDocument(user: AuthenticatedUser, id: string, fichier: FichierTeleverse | undefined) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'modifier');
    if (!fichier || !fichier.buffer || fichier.size === 0) throw new BadRequestException('Aucun fichier reçu (champ « document »).');
    const extension = TYPES_DOCUMENT[fichier.mimetype];
    if (!extension) throw new BadRequestException('Format refusé : PDF, JPEG ou PNG uniquement.');
    if (fichier.size > TAILLE_MAX_DOCUMENT_OCTETS) throw new BadRequestException('Document trop volumineux : 10 Mo au maximum.');
    this.assertStorage();
    // isolation : le chemin commence par l'organisation, jamais par une donnée du client
    const chemin = `${ctx.organisationId}/${conv.etablissementId}/${id}-${Date.now()}.${extension}`;
    const up = await fetch(`${this.baseStorage}/object/conventions/${chemin}`, {
      method: 'POST',
      headers: this.enTetes({ 'Content-Type': fichier.mimetype, 'x-upsert': 'true' }),
      body: fichier.buffer as unknown as BodyInit,
    });
    if (!up.ok) {
      throw new ServiceUnavailableException(`Téléversement du document refusé (${up.status}).`);
    }
    const ancien = conv.documentChemin;
    await this.prisma.$transaction(async (tx) => {
      await tx.convention.update({
        where: { id },
        data: { documentChemin: chemin, documentNom: fichier.originalname.slice(0, 200), documentType: fichier.mimetype, modifiePar: ctx.userId },
      });
      await this.audit(tx, ctx.userId, 'DOCUMENT_CONVENTION', id, { numero: conv.numero, nom: fichier.originalname.slice(0, 200), taille: fichier.size, remplace: Boolean(ancien) });
    });
    if (ancien) {
      await fetch(`${this.baseStorage}/object/conventions/${ancien}`, { method: 'DELETE', headers: this.enTetes() }).catch(() => undefined);
    }
    return { id, document: { nom: fichier.originalname, type: fichier.mimetype } };
  }

  /** URL signée à durée limitée ; 404 hors de l'organisation (jamais un chemin fourni par le client). */
  async urlDocument(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const conv = await this.charger(ctx, id);
    if (!conv.documentChemin) throw new NotFoundException('Aucun document joint à cette convention.');
    this.assertStorage();
    const sign = await fetch(`${this.baseStorage}/object/sign/conventions/${conv.documentChemin}`, {
      method: 'POST',
      headers: this.enTetes({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: this.dureeUrlSignee }),
    });
    if (!sign.ok) throw new ServiceUnavailableException(`Signature de l'URL du document refusée (${sign.status}).`);
    const corps = (await sign.json()) as { signedURL?: string; signedUrl?: string };
    const rel = corps.signedURL ?? corps.signedUrl;
    if (!rel) throw new ServiceUnavailableException("Réponse de signature inattendue (pas d'URL).");
    return { url: `${this.baseStorage}${rel.startsWith('/') ? '' : '/'}${rel}`, expiresIn: this.dureeUrlSignee, nom: conv.documentNom };
  }

  // ------------------------------------------------------------------ circuit

  async valider(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const conv = await this.charger(ctx, id);
    if (!this.aRole(ctx, ROLES_VALIDATION_CONVENTION)) {
      return this.refuser(user, id, 'validation', 'La validation d’une convention revient au médecin conseil ou à la direction.', true);
    }
    if (conv.statut !== 'PROPOSEE') {
      return this.refuser(user, id, 'validation', `Validation impossible : la convention est ${conv.statut.toLowerCase()} (seule une convention proposée se valide).`);
    }
    if (conv.saisiPar === ctx.userId || conv.modifiePar === ctx.userId) {
      return this.refuser(user, id, 'validation', 'Auto-validation interdite : vous avez saisi ou modifié cette convention ; la validation revient à une autre personne.', true);
    }
    if (!conv.documentChemin) {
      return this.refuser(user, id, 'validation', 'Validation impossible : le document signé n’est pas joint.');
    }
    if (conv.valeurs.length === 0 && conv.actes.length === 0) {
      return this.refuser(user, id, 'validation', 'Validation impossible : aucune valeur de lettre-clé ni exception par acte n’est saisie.');
    }

    // chevauchement avec une autre convention VALIDEE du même établissement (hors la version qu'on remplace)
    const conflit = await this.conventionEnConflit(this.prisma, conv, conv.conventionPrecedenteId);
    if (conflit) {
      return this.refuser(
        user,
        id,
        'validation',
        `Chevauchement : la convention ${conflit.numero} (version ${conflit.version}) est validée du ${iso(conflit.dateDebut)} ${conflit.dateFin ? `au ${iso(conflit.dateFin)}` : 'sans date de fin'} pour cet établissement. Utilisez « Nouvelle version » pour la remplacer.`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let precedenteFermee: { id: string; numero: string; dateFin: string | null } | null = null;
        if (conv.conventionPrecedenteId) {
          const prec = await tx.convention.findFirst({ where: { id: conv.conventionPrecedenteId, deletedAt: null } });
          if (prec && prec.statut === 'VALIDEE') {
            const fin = veille(conv.dateDebut);
            if (fin < prec.dateDebut) {
              throw new ConflictException(`La nouvelle version doit débuter après le ${iso(prec.dateDebut)} (début de la version qu’elle remplace).`);
            }
            await this.fermerProjection(tx, prec.id, fin);
            await tx.convention.update({ where: { id: prec.id }, data: { statut: 'ARCHIVEE', dateFin: prec.dateFin && prec.dateFin < fin ? prec.dateFin : fin } });
            precedenteFermee = { id: prec.id, numero: prec.numero, dateFin: iso(fin) };
          }
        }
        const v = await tx.convention.update({
          where: { id },
          data: { statut: 'VALIDEE', validePar: ctx.userId, dateValidation: new Date(), motifRefus: null },
        });
        const forfaits = conv.actes.filter((a) => a.prixForfaitaire !== null);
        await this.projeterForfaits(tx, v, forfaits);
        await this.audit(tx, ctx.userId, 'VALIDATION_CONVENTION', id, {
          numero: conv.numero,
          version: conv.version,
          etablissement: conv.etablissement.nom,
          saisiPar: conv.saisiPar,
          dateDebut: iso(conv.dateDebut),
          dateFin: iso(conv.dateFin),
          nbValeurs: conv.valeurs.length,
          nbForfaits: forfaits.length,
          nbValeursPropres: conv.actes.length - forfaits.length,
          precedenteFermee,
        });
        return { id, statut: v.statut };
      });
    } catch (e) {
      if (e instanceof ConflictException || e instanceof ForbiddenException) throw e;
      if (MOTIF_EXCLUSION.test(String((e as Error)?.message ?? e))) {
        return this.refuser(user, id, 'validation', 'Chevauchement détecté à l’enregistrement : une convention ou un tarif validé couvre déjà tout ou partie de cette période pour l’établissement.');
      }
      throw e;
    }
  }

  async refuserConvention(user: AuthenticatedUser, id: string, motif: string) {
    const ctx = await this.contexte(user);
    this.assertLecture(ctx);
    const conv = await this.charger(ctx, id);
    if (!this.aRole(ctx, ROLES_VALIDATION_CONVENTION)) {
      return this.refuser(user, id, 'refus', 'Le refus d’une convention revient au médecin conseil ou à la direction.', true);
    }
    if (conv.statut !== 'PROPOSEE') {
      return this.refuser(user, id, 'refus', `Refus impossible : la convention est ${conv.statut.toLowerCase()}.`);
    }
    if (conv.saisiPar === ctx.userId || conv.modifiePar === ctx.userId) {
      return this.refuser(user, id, 'refus', 'Vous avez saisi ou modifié cette convention : le refus revient à une autre personne (vous pouvez la supprimer).', true);
    }
    const texte = (motif ?? '').trim();
    if (texte.length < 5) throw new BadRequestException('Le motif de refus est obligatoire (5 caractères minimum).');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.convention.update({
        where: { id },
        data: { statut: 'REFUSEE', refusePar: ctx.userId, dateRefus: new Date(), motifRefus: texte },
      });
      await this.audit(tx, ctx.userId, 'REFUS_CONVENTION', id, { numero: conv.numero, version: conv.version, saisiPar: conv.saisiPar, motif: texte });
      return { id, statut: c.statut };
    });
  }

  /** Une convention refusée est corrigée puis reproposée (même numéro, nouveau circuit de validation). */
  async reproposer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    if (conv.statut !== 'REFUSEE') {
      return this.refuser(user, id, 'reproposition', `Reproposition impossible : la convention est ${conv.statut.toLowerCase()} (seule une convention refusée se repropose).`);
    }
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.convention.update({
        where: { id },
        data: { statut: 'PROPOSEE', modifiePar: ctx.userId, refusePar: null, dateRefus: null },
      });
      await this.audit(tx, ctx.userId, 'REPROPOSITION_CONVENTION', id, { numero: conv.numero, motifRefusPrecedent: conv.motifRefus });
      return { id, statut: c.statut };
    });
  }

  /** Copie une convention VALIDEE en nouvelle version PROPOSEE ; l'ancienne est fermée à la validation de la nouvelle. */
  async nouvelleVersion(user: AuthenticatedUser, id: string, dto: NouvelleVersionDto) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const source = await this.charger(ctx, id);
    if (source.statut !== 'VALIDEE') {
      return this.refuser(user, id, 'nouvelle_version', `Nouvelle version impossible : seule une convention validée en a une (celle-ci est ${source.statut.toLowerCase()}).`);
    }
    const debut = jour(dto.dateDebut);
    if (Number.isNaN(debut.getTime()) || debut <= source.dateDebut) {
      throw new BadRequestException(`La nouvelle version doit débuter après le ${iso(source.dateDebut)}.`);
    }
    const enCours = await this.prisma.convention.count({
      where: { conventionPrecedenteId: id, deletedAt: null, statut: { in: ['PROPOSEE', 'REFUSEE'] } },
    });
    if (enCours > 0) {
      return this.refuser(user, id, 'nouvelle_version', 'Une nouvelle version de cette convention est déjà en cours : terminez-la ou supprimez-la d’abord.');
    }
    const derniere = await this.prisma.convention.aggregate({
      where: { organisationId: ctx.organisationId, numero: source.numero, deletedAt: null },
      _max: { version: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.convention.create({
        data: {
          organisationId: ctx.organisationId,
          etablissementId: source.etablissementId,
          numero: source.numero,
          version: (derniere._max.version ?? source.version) + 1,
          conventionPrecedenteId: source.id,
          dateDebut: debut,
          dateFin: null,
          politiqueDepassement: source.politiqueDepassement,
          saisiPar: ctx.userId,
        },
      });
      for (const v of source.valeurs) {
        await tx.conventionValeur.create({ data: { conventionId: c.id, lettreCleCode: v.lettreCleCode, contexte: v.contexte, valeur: v.valeur } });
      }
      for (const a of source.actes) {
        await tx.conventionActe.create({ data: { conventionId: c.id, referentielActeId: a.referentielActeId, prixForfaitaire: a.prixForfaitaire, valeurLettreCle: a.valeurLettreCle } });
      }
      await this.audit(tx, ctx.userId, 'NOUVELLE_VERSION_CONVENTION', c.id, {
        numero: source.numero,
        version: c.version,
        precedente: source.id,
        dateDebut: iso(debut),
        nbValeurs: source.valeurs.length,
        nbActes: source.actes.length,
      });
      return { id: c.id, numero: c.numero, version: c.version, statut: c.statut };
    });
  }

  /**
   * ADR-008, lot 5 — « ajouter à la convention » après la validation d'un tarif proposé : crée une exception d'acte
   * (forfait OU valeur de lettre-clé propre à l'acte) dans une version PROPOSEE de la convention en vigueur de
   * l'établissement — JAMAIS en modifiant une convention VALIDEE. Une version PROPOSEE déjà en cours reçoit la ligne ;
   * sinon une nouvelle version est ouverte (copie de la convention validée, effet le lendemain). La version est à valider
   * par le circuit normal : celui qui l'a saisie (ici le médecin conseil qui décide) ne peut pas la valider lui-même.
   * Appelée dans la transaction de la décision ; ne vérifie pas de rôle (l'appelant l'a fait).
   */
  async ajouterExceptionDepuisTarifPropose(
    tx: Prisma.TransactionClient,
    p: {
      userId: string;
      organisationId: string;
      etablissementId: string;
      referentielActeId: string;
      type: 'FORFAIT' | 'VALEUR_LETTRE_CLE';
      /** Tarif UNITAIRE retenu (montant retenu / quantité). */
      montantUnitaire: Decimal;
    },
  ): Promise<{ conventionId: string; numero: string; version: number; versionCreee: boolean }> {
    const aujourdhuiJour = aujourdhui();
    const base = await tx.convention.findFirst({
      where: {
        organisationId: p.organisationId,
        etablissementId: p.etablissementId,
        statut: 'VALIDEE',
        deletedAt: null,
        dateDebut: { lte: aujourdhuiJour },
        OR: [{ dateFin: null }, { dateFin: { gte: aujourdhuiJour } }],
      },
      include: {
        valeurs: { where: { deletedAt: null } },
        actes: { where: { deletedAt: null } },
      },
      orderBy: { version: 'desc' },
    });
    if (!base) {
      throw new ConflictException('Aucune convention validée en vigueur pour cet établissement : rien à enrichir.');
    }
    const acte = await tx.referentielActe.findFirst({
      where: { id: p.referentielActeId, organisationId: p.organisationId, deletedAt: null },
      select: { id: true, code: true, lettreCleCode: true, coefficient: true },
    });
    if (!acte) throw new ConflictException('Acte du référentiel introuvable dans cette organisation.');

    let prixForfaitaire: Decimal | null = null;
    let valeurLettreCle: Decimal | null = null;
    if (p.type === 'FORFAIT') {
      prixForfaitaire = p.montantUnitaire.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else {
      if (!acte.lettreCleCode || !acte.coefficient) {
        throw new ConflictException(`L'acte ${acte.code} n'est pas coté (lettre-clé et coefficient) : une valeur de lettre-clé propre à l'acte est impossible, choisissez un forfait.`);
      }
      valeurLettreCle = p.montantUnitaire.div(acte.coefficient.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }
    const retenu = prixForfaitaire ?? valeurLettreCle!;
    if (retenu.lte(0) || retenu.gt(VALEUR_MAX)) {
      throw new ConflictException('Le montant retenu ne peut pas devenir une exception de convention (nul ou hors limites).');
    }

    let cible = await tx.convention.findFirst({
      where: { conventionPrecedenteId: base.id, deletedAt: null, statut: { in: ['PROPOSEE', 'REFUSEE'] } },
      include: { actes: { where: { deletedAt: null }, select: { referentielActeId: true } } },
    });
    let versionCreee = false;
    if (cible && cible.statut === 'REFUSEE') {
      throw new ConflictException(`La version ${cible.version} de la convention ${cible.numero} a été refusée : reprenez-la (reproposer) ou supprimez-la avant d'y ajouter une exception.`);
    }
    if (!cible) {
      const derniere = await tx.convention.aggregate({
        where: { organisationId: p.organisationId, numero: base.numero, deletedAt: null },
        _max: { version: true },
      });
      const lendemain = new Date(aujourdhuiJour.getTime() + JOUR_MS);
      const debut = lendemain > base.dateDebut ? lendemain : new Date(base.dateDebut.getTime() + JOUR_MS);
      const creee = await tx.convention.create({
        data: {
          organisationId: p.organisationId,
          etablissementId: base.etablissementId,
          numero: base.numero,
          version: (derniere._max.version ?? base.version) + 1,
          conventionPrecedenteId: base.id,
          dateDebut: debut,
          dateFin: null,
          politiqueDepassement: base.politiqueDepassement,
          saisiPar: p.userId,
        },
      });
      for (const v of base.valeurs) {
        await tx.conventionValeur.create({ data: { conventionId: creee.id, lettreCleCode: v.lettreCleCode, contexte: v.contexte, valeur: v.valeur } });
      }
      for (const a of base.actes) {
        await tx.conventionActe.create({ data: { conventionId: creee.id, referentielActeId: a.referentielActeId, prixForfaitaire: a.prixForfaitaire, valeurLettreCle: a.valeurLettreCle, dateDebut: a.dateDebut, dateFin: a.dateFin } });
      }
      cible = Object.assign(creee, { actes: base.actes.map((a) => ({ referentielActeId: a.referentielActeId })) });
      versionCreee = true;
    } else if (cible.actes.some((a) => a.referentielActeId === acte.id)) {
      throw new ConflictException(`L'acte ${acte.code} a déjà une exception dans la version ${cible.version} en cours.`);
    }
    if (base.actes.some((a) => a.referentielActeId === acte.id) && versionCreee) {
      // l'acte avait déjà une ligne dans la convention validée (copiée) : il serait tarifable, donc jamais proposé
      throw new ConflictException(`L'acte ${acte.code} a déjà une exception dans la convention en vigueur.`);
    }
    await tx.conventionActe.create({
      data: {
        conventionId: cible.id,
        referentielActeId: acte.id,
        prixForfaitaire: prixForfaitaire ? prixForfaitaire.toFixed(2) : null,
        valeurLettreCle: valeurLettreCle ? valeurLettreCle.toFixed(2) : null,
      },
    });
    await this.audit(tx, p.userId, 'AJOUT_EXCEPTION_DEPUIS_TARIF_PROPOSE', cible.id, {
      numero: cible.numero,
      version: cible.version,
      versionCreee,
      acte: acte.code,
      type: p.type,
      montantUnitaire: p.montantUnitaire.toFixed(2),
      forfait: prixForfaitaire ? prixForfaitaire.toFixed(2) : null,
      valeurLettreCle: valeurLettreCle ? valeurLettreCle.toFixed(2) : null,
    });
    return { conventionId: cible.id, numero: cible.numero, version: cible.version, versionCreee };
  }

  /** Archiver = fermer une convention validée (date de fin) ; une convention archivée ne se rouvre pas. */
  async archiver(user: AuthenticatedUser, id: string, dto: ArchiverConventionDto = {}) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'archiver');
    const fin = dto.dateFin ? jour(dto.dateFin) : aujourdhui();
    if (fin < conv.dateDebut) throw new BadRequestException(`La date de fin ne peut précéder le début de la convention (${iso(conv.dateDebut)}).`);
    const finRetenue = conv.dateFin && conv.dateFin < fin ? conv.dateFin : fin;
    return this.prisma.$transaction(async (tx) => {
      await this.fermerProjection(tx, id, finRetenue);
      const c = await tx.convention.update({ where: { id }, data: { statut: 'ARCHIVEE', dateFin: finRetenue } });
      await this.audit(tx, ctx.userId, 'ARCHIVAGE_CONVENTION', id, { numero: conv.numero, version: conv.version, dateFin: iso(finRetenue) });
      return { id, statut: c.statut, dateFin: iso(finRetenue) };
    });
  }

  /** Suppression (logique) : seulement une convention jamais validée (proposée ou refusée). */
  async supprimer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    this.assertSaisie(ctx);
    const conv = await this.charger(ctx, id);
    await this.dependances.assertPossible(user, 'convention', id, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      const maintenant = new Date();
      await tx.conventionValeur.updateMany({ where: { conventionId: id, deletedAt: null }, data: { deletedAt: maintenant } });
      await tx.conventionActe.updateMany({ where: { conventionId: id, deletedAt: null }, data: { deletedAt: maintenant } });
      await tx.convention.update({ where: { id }, data: { deletedAt: maintenant } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_CONVENTION', id, { numero: conv.numero, version: conv.version, statut: conv.statut });
    });
    if (conv.documentChemin && process.env.SUPABASE_URL && this.cleService) {
      await fetch(`${this.baseStorage}/object/conventions/${conv.documentChemin}`, { method: 'DELETE', headers: this.enTetes() }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ projection vers tarifs_conventionnes (lue par le Java)

  /** Convention VALIDEE de l'établissement qui chevauche la période de `conv` (hors la version remplacée). */
  private async conventionEnConflit(db: Db, conv: { id: string; etablissementId: string; dateDebut: Date; dateFin: Date | null }, hors: string | null) {
    return db.convention.findFirst({
      where: {
        etablissementId: conv.etablissementId,
        statut: 'VALIDEE',
        deletedAt: null,
        id: { notIn: [conv.id, ...(hors ? [hors] : [])] },
        ...(conv.dateFin ? { dateDebut: { lte: conv.dateFin } } : {}),
        OR: [{ dateFin: null }, { dateFin: { gte: conv.dateDebut } }],
      },
      select: { id: true, numero: true, version: true, dateDebut: true, dateFin: true },
    });
  }

  /** Les forfaits d'une convention VALIDEE deviennent des lignes de `tarifs_conventionnes` (MÊME identifiant). */
  private async projeterForfaits(
    tx: Prisma.TransactionClient,
    conv: { organisationId: string; etablissementId: string; dateDebut: Date; dateFin: Date | null },
    forfaits: { id: string; referentielActeId: string; prixForfaitaire: Prisma.Decimal | null; dateDebut: Date | null; dateFin: Date | null }[],
  ) {
    for (const f of forfaits) {
      const existe = await tx.tarifConventionne.findUnique({ where: { id: f.id }, select: { id: true } });
      if (existe) continue; // ligne historique : déjà projetée
      await tx.tarifConventionne.create({
        data: {
          id: f.id,
          organisationId: conv.organisationId,
          etablissementId: conv.etablissementId,
          referentielActeId: f.referentielActeId,
          tarifConvention: f.prixForfaitaire!,
          dateDebut: f.dateDebut ?? conv.dateDebut,
          dateFin: f.dateFin ?? conv.dateFin,
        },
      });
    }
  }

  /** Ferme les forfaits projetés d'une convention à `fin` ; ceux qui ne démarraient pas encore sont retirés. */
  private async fermerProjection(tx: Prisma.TransactionClient, conventionId: string, fin: Date) {
    const lignes = await tx.conventionActe.findMany({
      where: { conventionId, deletedAt: null, prixForfaitaire: { not: null } },
      select: { id: true },
    });
    const ids = lignes.map((l) => l.id);
    if (ids.length === 0) return;
    await tx.tarifConventionne.updateMany({ where: { id: { in: ids }, deletedAt: null, dateDebut: { gt: fin } }, data: { deletedAt: new Date() } });
    await tx.tarifConventionne.updateMany({
      where: { id: { in: ids }, deletedAt: null, OR: [{ dateFin: null }, { dateFin: { gt: fin } }] },
      data: { dateFin: fin },
    });
  }

  // ------------------------------------------------------------------ audit

  private async audit(db: Db, userId: string, action: string, enregistrementId: string, details: Prisma.InputJsonValue | null): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'conventions'}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(`Échec log_audit(${action}, ${enregistrementId}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      throw error;
    }
  }
}
