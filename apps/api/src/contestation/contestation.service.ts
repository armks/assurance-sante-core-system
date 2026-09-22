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
import { PrismaService } from '../prisma/prisma.service';
import { OuvrirContestationDto, TrancherContestationDto } from './dto/contestation.dto';
import {
  BUCKET_PIECES_JUSTIFICATIVES,
  ContexteAppelant,
  MIME_TYPES_PIECES_AUTORISES,
  ROLES_JUSTIFICATION_PHARMACIE,
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
  async listerOrdonnancesPourRevue(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacienConseil(ctx);

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: { organisationId: ctx.organisationId, deletedAt: null },
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
      orderBy: { datePrescription: 'desc' },
      take: 200,
    });

    return ordonnances.map((o) => ({
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
    };
  }

  private assertPharmacienConseil(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }
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
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'contestations_prescription'}::text,
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
