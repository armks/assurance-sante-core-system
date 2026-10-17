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
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { bornesPage, bornesPeriode, conditionRecherche, versPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  ETATS_CONTESTATION_REVUE,
  OuvrirContestationActeDto,
  OuvrirContestationDto,
  RevueActesQueryDto,
  RevueQueryDto,
  TrancherContestationDto,
} from './dto/contestation.dto';
import {
  BUCKET_PIECES_JUSTIFICATIVES,
  ContexteAppelant,
  MIME_TYPES_PIECES_AUTORISES,
  ROLES_JUSTIFICATION_ETABLISSEMENT,
  ROLES_JUSTIFICATION_PHARMACIE,
  ROLE_MEDECIN_CONSEIL,
  ROLE_PHARMACIEN_CONSEIL,
  STATUTS_CONTESTATION_EN_LITIGE,
  TAILLE_MAX_PIECE_OCTETS,
} from './contestation.types';

type Db = PrismaService | Prisma.TransactionClient;

/** Forme minimale d'un fichier téléversé (multer, mémoire) — pas de dépendance
 * à `@types/multer` pour un unique champ utilisé. */
export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * ContestationService — accès en revue du pharmacien conseil sur les
 * prescriptions, et mécanisme de contestation d'une ligne d'ordonnance déjà
 * servie (prévu depuis le plan directeur v9, jamais construit jusqu'ici).
 *
 * Une contestation ne porte que sur une ligne DÉJÀ servie
 * (`ligneOrdonnance.pharmacieServanteId` non nul) — c'est ce qui désigne « la
 * pharmacie concernée » (item 4) qui doit répondre. Tant qu'une contestation
 * est OUVERT/JUSTIFICATION_RECUE (temporaire) ou REJETEE (définitif), la
 * ligne est exclue de tout calcul de montant facturable — appliqué dans
 * `PharmacyService` (`obtenirDispensation`/`listerDispensationsPharmacie`),
 * jamais dupliqué ici.
 */
@Injectable()
export class ContestationService {
  private readonly logger = new Logger(ContestationService.name);
  private readonly dureeUrlSignee = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Revue (ASSUREUR_PHARMACIEN_CONSEIL) --------------------------

  /**
   * Toutes les ordonnances récentes de l'organisation, avec leurs lignes et
   * le statut de contestation courant de chacune — alimente l'écran
   * « Prescriptions à examiner ». `dossierId` permet l'accès au dossier
   * complet du patient (diagnostic, motif, historique des actes), déjà lisible
   * par ce rôle (`ROLES_LECTURE_DOSSIER_STAFF`, care-episode.types.ts).
   */
  async listerOrdonnancesPourRevue(user: AuthenticatedUser, dto: RevueQueryDto = {}) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacienConseil(ctx);

    // Pagination SERVEUR par ordonnance (remplace `take: 200`). Recherche sur
    // patient, n° de traitement, établissement ET médicaments prescrits ; état
    // de contestation : l'ordonnance est retenue si AU MOINS UNE de ses lignes
    // est dans l'état demandé.
    const { page, limite, offset } = bornesPage(dto);
    const { debut, finExclue } = bornesPeriode(dto.du, dto.au);
    const derniere = Prisma.sql`(SELECT c.statut FROM contestations_prescription c WHERE c.ligne_ordonnance_id = l.id ORDER BY c.created_at DESC LIMIT 1)`;
    const conditions = Prisma.join(
      [
        Prisma.sql`o.deleted_at IS NULL`,
        Prisma.sql`o.organisation_id = ${ctx.organisationId}::uuid`,
        debut ? Prisma.sql`o.date_prescription >= ${debut}` : Prisma.sql`TRUE`,
        finExclue ? Prisma.sql`o.date_prescription < ${finExclue}` : Prisma.sql`TRUE`,
        dto.contestation
          ? Prisma.sql`EXISTS (SELECT 1 FROM lignes_ordonnance l WHERE l.ordonnance_id = o.id AND ${this.conditionEtatContestation(derniere, dto.contestation)})`
          : Prisma.sql`TRUE`,
        conditionRecherche(dto.q, [
          Prisma.sql`ad.prenom`, Prisma.sql`ad.nom`, Prisma.sql`b.prenom`, Prisma.sql`b.nom`,
          Prisma.sql`d.numero_traitement`, Prisma.sql`e.nom`,
          Prisma.sql`(SELECT string_agg(l.denomination_medicament, ' ') FROM lignes_ordonnance l WHERE l.ordonnance_id = o.id)`,
        ]),
      ],
      ' AND ',
    );
    const lignesPage = await this.prisma.$queryRaw<{ id: string; total: number }[]>`
      SELECT o.id::text AS id, (COUNT(*) OVER())::int AS total
      FROM ordonnances o
      JOIN dossiers_soins d ON d.id = o.dossier_soins_id
      JOIN etablissements_sante e ON e.id = d.etablissement_id
      LEFT JOIN adherents ad ON ad.id = d.adherent_id
      LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id
      WHERE ${conditions}
      ORDER BY o.date_prescription DESC, o.id
      LIMIT ${limite} OFFSET ${offset}`;
    let total = lignesPage[0]?.total ?? 0;
    if (!lignesPage.length && offset > 0) {
      const [r] = await this.prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n
        FROM ordonnances o
        JOIN dossiers_soins d ON d.id = o.dossier_soins_id
        JOIN etablissements_sante e ON e.id = d.etablissement_id
        LEFT JOIN adherents ad ON ad.id = d.adherent_id
        LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id
        WHERE ${conditions}`;
      total = r?.n ?? 0;
    }
    const ids = lignesPage.map((l) => l.id);

    const ordonnancesTrouvees = await this.prisma.ordonnance.findMany({
      where: { id: { in: ids } },
      include: {
        dossier: {
          select: {
            id: true,
            numeroTraitement: true,
            etablissement: { select: { nom: true } },
            adherent: { select: { nom: true, prenom: true } },
            beneficiaire: { select: { nom: true, prenom: true } },
          },
        },
        lignesOrdonnance: {
          include: {
            contestations: { orderBy: { createdAt: 'desc' }, take: 1 },
            pharmacieServante: { select: { nom: true } },
          },
        },
      },
    });
    const parId = new Map(ordonnancesTrouvees.map((o) => [o.id, o]));
    const ordonnances = ids.map((id) => parId.get(id)!).filter(Boolean);

    const items = ordonnances.map((o) => ({
      id: o.id,
      statut: o.statut,
      datePrescription: o.datePrescription,
      dossierId: o.dossier.id,
      numeroTraitement: o.dossier.numeroTraitement,
      etablissement: o.dossier.etablissement.nom,
      patient: o.dossier.adherent
        ? `${o.dossier.adherent.prenom} ${o.dossier.adherent.nom}`
        : o.dossier.beneficiaire
          ? `${o.dossier.beneficiaire.prenom} ${o.dossier.beneficiaire.nom}`
          : '—',
      lignes: o.lignesOrdonnance.map((l) => ({
        id: l.id,
        denominationMedicament: l.denominationMedicament,
        posologie: l.posologie,
        quantitePrescrite: l.quantitePrescrite,
        statut: l.statut,
        pharmacieServante: l.pharmacieServante?.nom ?? null,
        contestation: l.contestations[0]
          ? { id: l.contestations[0].id, statut: l.contestations[0].statut }
          : null,
      })),
    }));
    return versPage(items, total, page, limite);
  }

  /**
   * File des contestations — organisation entière pour le pharmacien conseil
   * (« Contestations en cours »), scopée à SA pharmacie pour le personnel
   * PHARMACIE (« Contestations reçues »).
   */
  async listerContestations(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const estPharmacienConseil = ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL);
    const estPharmacie = ctx.roleChain.some((r) =>
      (ROLES_JUSTIFICATION_PHARMACIE as readonly string[]).includes(r),
    );
    if (!estPharmacienConseil && !(estPharmacie && ctx.pharmacieId)) {
      throw new ForbiddenException(
        'Réservé au pharmacien conseil ou au personnel habilité de la pharmacie concernée.',
      );
    }

    const contestations = await this.prisma.contestationPrescription.findMany({
      where: {
        organisationId: ctx.organisationId,
        ...(estPharmacienConseil
          ? {}
          : { ligneOrdonnance: { pharmacieServanteId: ctx.pharmacieId! } }),
      },
      include: {
        ligneOrdonnance: {
          select: {
            denominationMedicament: true,
            posologie: true,
            quantitePrescrite: true,
            pharmacieServante: { select: { id: true, nom: true } },
            ordonnance: {
              select: {
                dossier: {
                  select: {
                    numeroTraitement: true,
                    adherent: { select: { nom: true, prenom: true } },
                    beneficiaire: { select: { nom: true, prenom: true } },
                  },
                },
              },
            },
          },
        },
        ouvertPar: { select: { role: true } },
        traitePar: { select: { role: true } },
      },
      orderBy: { dateOuverture: 'desc' },
    });

    return contestations.map((c) => {
      const dossier = c.ligneOrdonnance.ordonnance.dossier;
      return {
        id: c.id,
        ligneOrdonnanceId: c.ligneOrdonnanceId,
        denominationMedicament: c.ligneOrdonnance.denominationMedicament,
        posologie: c.ligneOrdonnance.posologie,
        quantitePrescrite: c.ligneOrdonnance.quantitePrescrite,
        pharmacie: c.ligneOrdonnance.pharmacieServante
          ? { id: c.ligneOrdonnance.pharmacieServante.id, nom: c.ligneOrdonnance.pharmacieServante.nom }
          : null,
        numeroTraitement: dossier.numeroTraitement,
        patient: dossier.adherent
          ? `${dossier.adherent.prenom} ${dossier.adherent.nom}`
          : dossier.beneficiaire
            ? `${dossier.beneficiaire.prenom} ${dossier.beneficiaire.nom}`
            : '—',
        motif: c.motif,
        statut: c.statut,
        dateOuverture: c.dateOuverture,
        dateLimite: c.dateLimite,
        reponseEtablissement: c.reponseEtablissement,
        piecesJustificatives: c.piecesJustificatives,
        dateCloture: c.dateCloture,
        ouvertPar: c.ouvertPar.role,
        traitePar: c.traitePar?.role ?? null,
      };
    });
  }

  /**
   * URL signée (durée limitée) d'une pièce justificative — jamais d'URL
   * publique (bucket privé). Réservé aux mêmes rôles que `listerContestations`.
   */
  async obtenirUrlPiece(user: AuthenticatedUser, contestationId: string, nomFichier: string) {
    const ctx = await this.contexteAppelant(user);
    const contestation = await this.chargerContestation(ctx, contestationId);
    const estPharmacienConseil = ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL);
    const estPharmacieConcernee =
      ctx.pharmacieId && contestation.pharmacieId === ctx.pharmacieId;
    if (!estPharmacienConseil && !estPharmacieConcernee) {
      throw new ForbiddenException("Cette pièce ne concerne pas votre pharmacie.");
    }
    const chemin = `${contestationId}/${nomFichier}`;
    if (!contestation.piecesJustificatives.includes(chemin)) {
      throw new NotFoundException("Cette pièce n'appartient pas à cette contestation.");
    }
    const url = await this.signerPiece(chemin);
    return { url, expiresIn: this.dureeUrlSignee };
  }

  /** Ouvre une contestation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL. */
  async ouvrirContestation(user: AuthenticatedUser, dto: OuvrirContestationDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacienConseil(ctx);

    const ligne = await this.prisma.ligneOrdonnance.findFirst({
      where: { id: dto.ligneOrdonnanceId },
      include: { ordonnance: { select: { organisationId: true } } },
    });
    if (!ligne || ligne.ordonnance.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Ligne de prescription introuvable.');
    }
    if (!ligne.pharmacieServanteId) {
      throw new BadRequestException(
        "Cette ligne n'a pas encore été délivrée par une pharmacie — rien à contester pour l'instant.",
      );
    }

    const existante = await this.prisma.contestationPrescription.findFirst({
      where: { ligneOrdonnanceId: ligne.id },
      orderBy: { createdAt: 'desc' },
    });
    if (existante && (STATUTS_CONTESTATION_EN_LITIGE as readonly string[]).includes(existante.statut)) {
      throw new ConflictException(
        existante.statut === 'REJETEE'
          ? 'Cette ligne a déjà été définitivement exclue de la facturation par une contestation précédente.'
          : 'Une contestation est déjà en cours sur cette ligne.',
      );
    }

    const contestation = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationPrescription.create({
        data: {
          organisationId: ctx.organisationId,
          ligneOrdonnanceId: ligne.id,
          ouvertParId: ctx.userId,
          motif: dto.motif,
        },
      });
      await this.audit(tx, ctx.userId, 'OUVERTURE_CONTESTATION_PRESCRIPTION', c.id, {
        ligneOrdonnanceId: ligne.id,
        motif: dto.motif,
      });
      return c;
    });

    return contestation;
  }

  // --- Réponse (pharmacie concernée) --------------------------------

  /**
   * Soumet la justification de la pharmacie — réservé à PHARMACIE_PHARMACIEN/
   * PHARMACIE_COMPTABLE de LA pharmacie concernée (`ligneOrdonnance.
   * pharmacieServanteId`), jamais une autre. Pièces stockées dans Supabase
   * Storage (bucket privé `contestations`).
   */
  async soumettreJustification(
    user: AuthenticatedUser,
    contestationId: string,
    reponse: string,
    fichiers: FichierTeleverse[],
  ) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) => (ROLES_JUSTIFICATION_PHARMACIE as readonly string[]).includes(r)) ||
      !ctx.pharmacieId
    ) {
      throw new ForbiddenException(
        'Réservé au pharmacien ou au comptable de la pharmacie concernée.',
      );
    }
    if (!reponse || reponse.trim().length < 5) {
      throw new BadRequestException('La réponse doit contenir au moins 5 caractères.');
    }

    const contestation = await this.chargerContestation(ctx, contestationId);
    if (contestation.pharmacieId !== ctx.pharmacieId) {
      throw new ForbiddenException("Cette contestation ne concerne pas votre pharmacie.");
    }
    if (contestation.statut !== 'OUVERT') {
      throw new ConflictException(
        `Cette contestation n'est plus en attente de justification (statut actuel : ${contestation.statut}).`,
      );
    }

    for (const f of fichiers) {
      if (!MIME_TYPES_PIECES_AUTORISES.includes(f.mimetype)) {
        throw new BadRequestException(`Type de fichier non autorisé : ${f.mimetype}.`);
      }
      if (f.size > TAILLE_MAX_PIECE_OCTETS) {
        throw new BadRequestException(`Fichier trop volumineux : ${f.originalname} (max 10 Mo).`);
      }
    }

    const chemins: string[] = [];
    for (const f of fichiers) {
      const chemin = await this.televerserPiece(contestationId, f);
      chemins.push(chemin);
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationPrescription.update({
        where: { id: contestationId },
        data: {
          reponseEtablissement: reponse,
          piecesJustificatives: chemins,
          statut: 'JUSTIFICATION_RECUE',
        },
      });
      await this.audit(tx, ctx.userId, 'JUSTIFICATION_CONTESTATION_PRESCRIPTION', c.id, {
        nbPieces: chemins.length,
      });
      return c;
    });

    return maj;
  }

  // --- Décision (ASSUREUR_PHARMACIEN_CONSEIL) -----------------------

  /**
   * Tranche une contestation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_
   * CONSEIL. VALIDEE débloque la ligne pour facturation normale (le prochain
   * calcul cesse de renvoyer `enLitige`). REJETEE l'exclut DÉFINITIVEMENT.
   */
  async trancherContestation(
    user: AuthenticatedUser,
    contestationId: string,
    dto: TrancherContestationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacienConseil(ctx);

    const contestation = await this.chargerContestationBrute(ctx, contestationId);
    if (!['OUVERT', 'JUSTIFICATION_RECUE'].includes(contestation.statut)) {
      throw new ConflictException(
        `Cette contestation est déjà tranchée (statut actuel : ${contestation.statut}).`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationPrescription.update({
        where: { id: contestationId },
        data: {
          statut: dto.decision,
          traiteParId: ctx.userId,
          dateCloture: new Date(),
        },
      });
      await this.audit(tx, ctx.userId, 'DECISION_CONTESTATION_PRESCRIPTION', c.id, {
        decision: dto.decision,
      });
      return c;
    });

    return maj;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Contestation d'un acte/hospitalisation/analyse-examen (actes_dossier) —
  //  même principe que la contestation de prescription ci-dessus, réutilisé
  //  pour ce second domaine plutôt que redessiné. Réservée à
  //  ASSUREUR_MEDECIN_CONSEIL (au lieu du pharmacien conseil) ; la
  //  justification revient à l'établissement CONCERNÉ (au lieu de la
  //  pharmacie concernée).
  // ═══════════════════════════════════════════════════════════════════

  /** Côté MÉDECIN CONSEIL : tous les actes récents de l'organisation, avec le
   * statut de contestation courant de chacun — alimente l'écran « Actes à examiner ». */
  async listerActesPourRevue(user: AuthenticatedUser, dto: RevueActesQueryDto = {}) {
    const ctx = await this.contexteAppelant(user);
    this.assertMedecinConseil(ctx);

    // Pagination SERVEUR (remplace `take: 200` : au-delà, les actes anciens
    // étaient inaccessibles, recherche comprise). Les filtres et la recherche
    // sont appliqués en SQL AVANT la pagination ; total = résultats filtrés.
    const { page, limite, offset } = bornesPage(dto);
    const { debut, finExclue } = bornesPeriode(dto.du, dto.au);
    const derniere = Prisma.sql`(SELECT c.statut FROM contestations_acte c WHERE c.acte_dossier_id = a.id ORDER BY c.created_at DESC LIMIT 1)`;
    const conditions = Prisma.join(
      [
        Prisma.sql`a.deleted_at IS NULL`,
        Prisma.sql`a.statut <> 'ANNULE'`,
        Prisma.sql`d.organisation_id = ${ctx.organisationId}::uuid`,
        debut ? Prisma.sql`a.date_prescription >= ${debut}` : Prisma.sql`TRUE`,
        finExclue ? Prisma.sql`a.date_prescription < ${finExclue}` : Prisma.sql`TRUE`,
        dto.categorie ? Prisma.sql`a.categorie_acte = ${dto.categorie}` : Prisma.sql`TRUE`,
        this.conditionEtatContestation(derniere, dto.contestation),
        conditionRecherche(dto.q, [
          Prisma.sql`ad.prenom`, Prisma.sql`ad.nom`, Prisma.sql`b.prenom`, Prisma.sql`b.nom`,
          Prisma.sql`d.numero_traitement`, Prisma.sql`e.nom`, Prisma.sql`a.libelle`, Prisma.sql`a.code_acte`,
        ]),
      ],
      ' AND ',
    );
    const lignes = await this.prisma.$queryRaw<{ id: string; total: number }[]>`
      SELECT a.id::text AS id, (COUNT(*) OVER())::int AS total
      FROM actes_dossier a
      JOIN dossiers_soins d ON d.id = a.dossier_soins_id
      JOIN etablissements_sante e ON e.id = d.etablissement_id
      LEFT JOIN adherents ad ON ad.id = d.adherent_id
      LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id
      WHERE ${conditions}
      ORDER BY a.date_prescription DESC, a.id
      LIMIT ${limite} OFFSET ${offset}`;
    const total = lignes[0]?.total ?? (offset > 0 ? await this.compterActesRevue(conditions) : 0);
    const ids = lignes.map((l) => l.id);

    const actes = await this.prisma.acteDossier.findMany({
      where: { id: { in: ids } },
      include: {
        dossier: {
          select: {
            id: true,
            numeroTraitement: true,
            typeVisite: true,
            etablissement: { select: { nom: true } },
            adherent: {
              select: { nom: true, prenom: true, numeroCarte: true, souscripteur: { select: { nom: true } } },
            },
            beneficiaire: {
              select: {
                nom: true,
                prenom: true,
                numeroCarte: true,
                adherent: { select: { souscripteur: { select: { nom: true } } } },
              },
            },
          },
        },
        contestations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const parId = new Map(actes.map((a) => [a.id, a]));

    const items = ids.map((id) => parId.get(id)!).filter(Boolean).map((a) => ({
      id: a.id,
      categorieActe: a.categorieActe,
      libelle: a.libelle,
      codeActe: a.codeActe,
      quantite: a.quantite,
      montantPrescrit: a.montantPrescrit?.toFixed(2) ?? null,
      statut: a.statut,
      datePrescription: a.datePrescription,
      montantSimuleAssurance: a.montantSimuleAssurance?.toFixed(2) ?? null,
      montantSimulePatient: a.montantSimulePatient?.toFixed(2) ?? null,
      dossierId: a.dossier.id,
      typeVisite: a.dossier.typeVisite,
      societe:
        a.dossier.adherent?.souscripteur?.nom ?? a.dossier.beneficiaire?.adherent?.souscripteur?.nom ?? '—',
      numeroCarte: a.dossier.adherent?.numeroCarte ?? a.dossier.beneficiaire?.numeroCarte ?? '—',
      numeroTraitement: a.dossier.numeroTraitement,
      etablissement: a.dossier.etablissement.nom,
      patient: a.dossier.adherent
        ? `${a.dossier.adherent.prenom} ${a.dossier.adherent.nom}`
        : a.dossier.beneficiaire
          ? `${a.dossier.beneficiaire.prenom} ${a.dossier.beneficiaire.nom}`
          : '—',
      contestation: a.contestations[0]
        ? { id: a.contestations[0].id, statut: a.contestations[0].statut }
        : null,
    }));
    return versPage(items, total, page, limite);
  }

  /** Total filtré quand la page demandée est au-delà de la dernière (0 ligne). */
  private async compterActesRevue(conditions: Prisma.Sql): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM actes_dossier a
      JOIN dossiers_soins d ON d.id = a.dossier_soins_id
      JOIN etablissements_sante e ON e.id = d.etablissement_id
      LEFT JOIN adherents ad ON ad.id = d.adherent_id
      LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id
      WHERE ${conditions}`;
    return r?.n ?? 0;
  }

  /**
   * Filtre « état de contestation » sur la DERNIÈRE contestation (sous-requête
   * `derniere`) : SANS = jamais contesté, EN_COURS = ouverte ou justification
   * reçue, TRAITEE = validée ou rejetée.
   */
  private conditionEtatContestation(
    derniere: Prisma.Sql,
    etat?: (typeof ETATS_CONTESTATION_REVUE)[number],
  ): Prisma.Sql {
    if (etat === 'SANS') return Prisma.sql`${derniere} IS NULL`;
    if (etat === 'EN_COURS') return Prisma.sql`${derniere} IN ('OUVERT', 'JUSTIFICATION_RECUE')`;
    if (etat === 'TRAITEE') return Prisma.sql`${derniere} IN ('VALIDEE', 'REJETEE')`;
    return Prisma.sql`TRUE`;
  }

  /**
   * File des contestations d'actes — organisation entière pour le médecin
   * conseil (« Contestations en cours »), scopée à SON établissement pour le
   * personnel de centre médical (« Contestations reçues »).
   */
  async listerContestationsActes(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const estMedecinConseil = ctx.roleChain.includes(ROLE_MEDECIN_CONSEIL);
    const estEtablissement = ctx.roleChain.some((r) =>
      (ROLES_JUSTIFICATION_ETABLISSEMENT as readonly string[]).includes(r),
    );
    if (!estMedecinConseil && !(estEtablissement && ctx.etablissementId)) {
      throw new ForbiddenException(
        "Réservé au médecin conseil ou au personnel habilité de l'établissement concerné.",
      );
    }

    const contestations = await this.prisma.contestationActe.findMany({
      where: {
        organisationId: ctx.organisationId,
        ...(estMedecinConseil
          ? {}
          : { acteDossier: { dossier: { etablissementId: ctx.etablissementId! } } }),
      },
      include: {
        acteDossier: {
          select: {
            categorieActe: true,
            libelle: true,
            codeActe: true,
            montantPrescrit: true,
            quantite: true,
            montantSimuleAssurance: true,
            montantSimulePatient: true,
            dossier: {
              select: {
                id: true,
                numeroTraitement: true,
                typeVisite: true,
                etablissement: { select: { nom: true } },
                adherent: {
                  select: { nom: true, prenom: true, numeroCarte: true, souscripteur: { select: { nom: true } } },
                },
                beneficiaire: {
                  select: {
                    nom: true,
                    prenom: true,
                    numeroCarte: true,
                    adherent: { select: { souscripteur: { select: { nom: true } } } },
                  },
                },
              },
            },
          },
        },
        ouvertPar: { select: { role: true } },
        traitePar: { select: { role: true } },
      },
      orderBy: { dateOuverture: 'desc' },
    });

    return contestations.map((c) => {
      const dossier = c.acteDossier.dossier;
      return {
        id: c.id,
        acteDossierId: c.acteDossierId,
        categorieActe: c.acteDossier.categorieActe,
        libelle: c.acteDossier.libelle,
        codeActe: c.acteDossier.codeActe,
        montantPrescrit: c.acteDossier.montantPrescrit?.toFixed(2) ?? null,
        quantite: c.acteDossier.quantite,
        montantSimuleAssurance: c.acteDossier.montantSimuleAssurance?.toFixed(2) ?? null,
        montantSimulePatient: c.acteDossier.montantSimulePatient?.toFixed(2) ?? null,
        etablissement: dossier.etablissement.nom,
        dossierId: dossier.id,
        typeVisite: dossier.typeVisite,
        societe: dossier.adherent?.souscripteur?.nom ?? dossier.beneficiaire?.adherent?.souscripteur?.nom ?? '—',
        numeroCarte: dossier.adherent?.numeroCarte ?? dossier.beneficiaire?.numeroCarte ?? '—',
        numeroTraitement: dossier.numeroTraitement,
        patient: dossier.adherent
          ? `${dossier.adherent.prenom} ${dossier.adherent.nom}`
          : dossier.beneficiaire
            ? `${dossier.beneficiaire.prenom} ${dossier.beneficiaire.nom}`
            : '—',
        motif: c.motif,
        statut: c.statut,
        dateOuverture: c.dateOuverture,
        dateLimite: c.dateLimite,
        reponseEtablissement: c.reponseEtablissement,
        piecesJustificatives: c.piecesJustificatives,
        dateCloture: c.dateCloture,
        ouvertPar: c.ouvertPar.role,
        traitePar: c.traitePar?.role ?? null,
      };
    });
  }

  /** URL signée (durée limitée) d'une pièce justificative — même bucket privé
   * que les prescriptions. Réservé aux mêmes rôles que `listerContestationsActes`. */
  async obtenirUrlPieceActe(user: AuthenticatedUser, contestationId: string, nomFichier: string) {
    const ctx = await this.contexteAppelant(user);
    const contestation = await this.chargerContestationActe(ctx, contestationId);
    const estMedecinConseil = ctx.roleChain.includes(ROLE_MEDECIN_CONSEIL);
    const estEtablissementConcerne =
      !!ctx.etablissementId && contestation.etablissementId === ctx.etablissementId;
    if (!estMedecinConseil && !estEtablissementConcerne) {
      throw new ForbiddenException("Cette pièce ne concerne pas votre établissement.");
    }
    const chemin = `${contestationId}/${nomFichier}`;
    if (!contestation.piecesJustificatives.includes(chemin)) {
      throw new NotFoundException("Cette pièce n'appartient pas à cette contestation.");
    }
    const url = await this.signerPiece(chemin);
    return { url, expiresIn: this.dureeUrlSignee };
  }

  /** Ouvre une contestation — réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL. */
  async ouvrirContestationActe(user: AuthenticatedUser, dto: OuvrirContestationActeDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertMedecinConseil(ctx);

    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: dto.acteDossierId, deletedAt: null },
      include: { dossier: { select: { organisationId: true } } },
    });
    if (!acte || acte.dossier.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Acte introuvable.');
    }
    if (acte.statut === 'ANNULE') {
      throw new BadRequestException('Cet acte est annulé — rien à contester.');
    }

    const existante = await this.prisma.contestationActe.findFirst({
      where: { acteDossierId: acte.id },
      orderBy: { createdAt: 'desc' },
    });
    if (existante && (STATUTS_CONTESTATION_EN_LITIGE as readonly string[]).includes(existante.statut)) {
      throw new ConflictException(
        existante.statut === 'REJETEE'
          ? 'Cet acte a déjà été définitivement exclu de la facturation par une contestation précédente.'
          : 'Une contestation est déjà en cours sur cet acte.',
      );
    }

    const contestation = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationActe.create({
        data: {
          organisationId: ctx.organisationId,
          acteDossierId: acte.id,
          ouvertParId: ctx.userId,
          motif: dto.motif,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'OUVERTURE_CONTESTATION_ACTE',
        c.id,
        { acteDossierId: acte.id, motif: dto.motif },
        'contestations_acte',
      );
      return c;
    });

    return contestation;
  }

  /**
   * Soumet la justification de l'établissement — réservé à
   * CENTRE_MEDICAL_MEDECIN/COMPTABLE/ADMINISTRATIF de L'ÉTABLISSEMENT
   * concerné, jamais un autre (ni CENTRE_MEDICAL_ACCUEIL). Mêmes contraintes
   * de pièces (type/taille), même bucket de stockage que les prescriptions.
   */
  async soumettreJustificationActe(
    user: AuthenticatedUser,
    contestationId: string,
    reponse: string,
    fichiers: FichierTeleverse[],
  ) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) => (ROLES_JUSTIFICATION_ETABLISSEMENT as readonly string[]).includes(r)) ||
      !ctx.etablissementId
    ) {
      throw new ForbiddenException(
        "Réservé au personnel habilité de l'établissement concerné.",
      );
    }
    if (!reponse || reponse.trim().length < 5) {
      throw new BadRequestException('La réponse doit contenir au moins 5 caractères.');
    }

    const contestation = await this.chargerContestationActe(ctx, contestationId);
    if (contestation.etablissementId !== ctx.etablissementId) {
      throw new ForbiddenException("Cette contestation ne concerne pas votre établissement.");
    }
    if (contestation.statut !== 'OUVERT') {
      throw new ConflictException(
        `Cette contestation n'est plus en attente de justification (statut actuel : ${contestation.statut}).`,
      );
    }

    for (const f of fichiers) {
      if (!MIME_TYPES_PIECES_AUTORISES.includes(f.mimetype)) {
        throw new BadRequestException(`Type de fichier non autorisé : ${f.mimetype}.`);
      }
      if (f.size > TAILLE_MAX_PIECE_OCTETS) {
        throw new BadRequestException(`Fichier trop volumineux : ${f.originalname} (max 10 Mo).`);
      }
    }

    const chemins: string[] = [];
    for (const f of fichiers) {
      const chemin = await this.televerserPiece(contestationId, f);
      chemins.push(chemin);
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationActe.update({
        where: { id: contestationId },
        data: {
          reponseEtablissement: reponse,
          piecesJustificatives: chemins,
          statut: 'JUSTIFICATION_RECUE',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'JUSTIFICATION_CONTESTATION_ACTE',
        c.id,
        { nbPieces: chemins.length },
        'contestations_acte',
      );
      return c;
    });

    return maj;
  }

  /**
   * Tranche une contestation d'acte — réservé EXCLUSIVEMENT à
   * ASSUREUR_MEDECIN_CONSEIL. VALIDEE débloque l'acte pour facturation
   * normale. REJETEE l'exclut DÉFINITIVEMENT.
   */
  async trancherContestationActe(
    user: AuthenticatedUser,
    contestationId: string,
    dto: TrancherContestationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertMedecinConseil(ctx);

    const contestation = await this.chargerContestationActeBrute(ctx, contestationId);
    if (!['OUVERT', 'JUSTIFICATION_RECUE'].includes(contestation.statut)) {
      throw new ConflictException(
        `Cette contestation est déjà tranchée (statut actuel : ${contestation.statut}).`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contestationActe.update({
        where: { id: contestationId },
        data: {
          statut: dto.decision,
          traiteParId: ctx.userId,
          dateCloture: new Date(),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DECISION_CONTESTATION_ACTE',
        c.id,
        { decision: dto.decision },
        'contestations_acte',
      );
      return c;
    });

    return maj;
  }

  // --- Helpers -------------------------------------------------------

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
      pharmacieId: profil.pharmacieId,
      etablissementId: profil.etablissementId,
    };
  }

  private assertPharmacienConseil(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }
  }

  private assertMedecinConseil(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_MEDECIN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL.');
    }
  }

  /** Charge une contestation d'acte avec l'établissement concerné dérivé de son dossier. */
  private async chargerContestationActe(ctx: ContexteAppelant, contestationId: string) {
    const c = await this.prisma.contestationActe.findFirst({
      where: { id: contestationId, organisationId: ctx.organisationId },
      include: { acteDossier: { select: { dossier: { select: { etablissementId: true } } } } },
    });
    if (!c) {
      throw new NotFoundException('Contestation introuvable.');
    }
    return { ...c, etablissementId: c.acteDossier.dossier.etablissementId };
  }

  private async chargerContestationActeBrute(ctx: ContexteAppelant, contestationId: string) {
    const c = await this.prisma.contestationActe.findFirst({
      where: { id: contestationId, organisationId: ctx.organisationId },
    });
    if (!c) {
      throw new NotFoundException('Contestation introuvable.');
    }
    return c;
  }

  /** Charge une contestation avec la pharmacie concernée dérivée de sa ligne. */
  private async chargerContestation(ctx: ContexteAppelant, contestationId: string) {
    const c = await this.prisma.contestationPrescription.findFirst({
      where: { id: contestationId, organisationId: ctx.organisationId },
      include: { ligneOrdonnance: { select: { pharmacieServanteId: true } } },
    });
    if (!c) {
      throw new NotFoundException('Contestation introuvable.');
    }
    return { ...c, pharmacieId: c.ligneOrdonnance.pharmacieServanteId };
  }

  private async chargerContestationBrute(ctx: ContexteAppelant, contestationId: string) {
    const c = await this.prisma.contestationPrescription.findFirst({
      where: { id: contestationId, organisationId: ctx.organisationId },
    });
    if (!c) {
      throw new NotFoundException('Contestation introuvable.');
    }
    return c;
  }

  // --- Stockage (Supabase Storage, bucket privé) ----------------------

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private async televerserPiece(contestationId: string, fichier: FichierTeleverse): Promise<string> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des pièces justificatives indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    const nomSur = `${Date.now()}-${fichier.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const chemin = `${contestationId}/${nomSur}`;

    const up = await fetch(`${this.baseStorage}/object/${BUCKET_PIECES_JUSTIFICATIVES}/${chemin}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': fichier.mimetype,
        'x-upsert': 'true',
      },
      body: fichier.buffer as unknown as BodyInit,
    });
    if (!up.ok) {
      throw new ServiceUnavailableException(
        `Téléversement de la pièce refusé (${up.status} : ${(await up.text()).slice(0, 200)}).`,
      );
    }
    return chemin;
  }

  private async signerPiece(chemin: string): Promise<string> {
    const sign = await fetch(
      `${this.baseStorage}/object/sign/${BUCKET_PIECES_JUSTIFICATIVES}/${chemin}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          apikey: this.serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: this.dureeUrlSignee }),
      },
    );
    if (!sign.ok) {
      throw new ServiceUnavailableException("Signature de l'URL de la pièce refusée.");
    }
    const corps = (await sign.json()) as { signedURL?: string; signedUrl?: string };
    const rel = corps.signedURL ?? corps.signedUrl;
    if (!rel) {
      throw new ServiceUnavailableException("Réponse de signature inattendue (pas d'URL).");
    }
    return `${this.baseStorage}${rel.startsWith('/') ? '' : '/'}${rel}`;
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible: string = 'contestations_prescription',
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
