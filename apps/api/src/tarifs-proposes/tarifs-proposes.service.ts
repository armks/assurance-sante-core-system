import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { AdjudicationClientService, type TraceTarif } from '../adjudication-client/adjudication-client.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProposerTarifDto } from './dto/tarifs-proposes.dto';
import {
  MENTION_TARIF_EN_EXAMEN,
  ROLES_LECTURE_ASSUREUR_TARIF_PROPOSE,
  ROLES_PROPOSITION_TARIF,
} from './tarifs-proposes.types';

type Db = PrismaService | Prisma.TransactionClient;

interface Ctx {
  userId: string;
  organisationId: string;
  etablissementId: string | null;
  roleChain: string[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Colonnes `tarif_*` de la ligne de facturation à partir de l'instantané du microservice. */
export function colonnesTrace(t: TraceTarif | null | undefined) {
  if (!t) return {};
  const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : new Decimal(String(v)));
  return {
    tarifStatut: t.statut_tarif === 'NON_TARIFABLE' ? null : t.statut_tarif,
    tarifRegleOrigine: t.regle_origine,
    tarifLettreCle: t.lettre_cle,
    tarifCoefficient: dec(t.coefficient),
    tarifValeurAppliquee: dec(t.valeur_appliquee),
    tarifConventionId: t.convention_id,
    tarifPolitiqueDepassement: t.politique_depassement,
    tarifPrixAffiche: dec(t.prix_affiche),
    tarifReconnu: dec(t.tarif_reconnu),
    tarifEcart: dec(t.ecart),
    tarifUnitaire: dec(t.tarif_unitaire),
    tarifQuantite: t.quantite ?? null,
    tarifProvisoire: t.provisoire === true,
    tarifProposeId: t.tarif_propose_id ?? null,
  };
}

/**
 * TarifsProposesService — ADR-008, lot 4.
 *
 * Un acte NON TARIFABLE (E016 : ni forfait ni valeur de lettre-clé dans la convention en vigueur) ne bloque plus : le
 * comptable ou l'administratif de l'établissement saisit un montant TOTAL avec une justification obligatoire. Le Java
 * calcule alors PROVISOIREMENT avec ce montant comme tarif reconnu (règle TARIF_PROPOSE) ; la ligne de facturation est
 * exclue du paiement tant que la proposition n'est pas VALIDE / AJUSTE, mais entame les plafonds.
 *
 * Les décisions (file du médecin conseil) arrivent au lot 5 : la table et les statuts sont prévus, pas les décisions.
 * `synchroniserLignes` réintègre les lignes dont la proposition a été décidée (VALIDE ou AJUSTE : nouveau calcul avec le
 * montant retenu, trace remplacée une fois ; REFUSE : le calcul provisoire cesse de peser sur les plafonds).
 */
@Injectable()
export class TarifsProposesService {
  private readonly logger = new Logger(TarifsProposesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
    private readonly adjudication: AdjudicationClientService,
  ) {}

  // ------------------------------------------------------------------ contexte

  private async contexte(user: AuthenticatedUser): Promise<Ctx> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      etablissementId: profil.etablissementId ?? null,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private aRole(ctx: Ctx, roles: readonly string[]): boolean {
    return ctx.roleChain.some((r) => roles.includes(r));
  }

  private estEtablissement(ctx: Ctx): boolean {
    return this.aRole(ctx, ROLES_PROPOSITION_TARIF) && !!ctx.etablissementId;
  }

  private async refuser(user: AuthenticatedUser, id: string, action: string, raison: string, droit = false): Promise<never> {
    await this.dependances.tracerRefusMetier(user, 'tarifs_proposes', id, action, raison);
    throw droit ? new ForbiddenException(raison) : new ConflictException(raison);
  }

  // ------------------------------------------------------------------ lecture

  private projeter(t: {
    id: string;
    etablissementId: string;
    acteDossierId: string;
    ligneFacturationId: string | null;
    montantPropose: Prisma.Decimal;
    justification: string;
    statut: string;
    proposePar: string;
    dateProposition: Date;
    decidePar: string | null;
    dateDecision: Date | null;
    montantDecide: Prisma.Decimal | null;
    motifDecision: string | null;
  }) {
    return {
      id: t.id,
      etablissementId: t.etablissementId,
      acteDossierId: t.acteDossierId,
      ligneFacturationId: t.ligneFacturationId,
      montantPropose: t.montantPropose.toFixed(2),
      justification: t.justification,
      statut: t.statut,
      proposePar: t.proposePar,
      dateProposition: t.dateProposition,
      decidePar: t.decidePar,
      dateDecision: t.dateDecision,
      montantDecide: t.montantDecide ? t.montantDecide.toFixed(2) : null,
      motifDecision: t.motifDecision,
    };
  }

  /** Propositions : l'établissement voit les siennes ; l'assureur (lecture seule ici) toute son organisation. */
  async lister(user: AuthenticatedUser, statut?: string) {
    const ctx = await this.contexte(user);
    const etab = this.estEtablissement(ctx);
    if (!etab && !this.aRole(ctx, ROLES_LECTURE_ASSUREUR_TARIF_PROPOSE)) {
      throw new ForbiddenException('Réservé au comptable ou à l’administratif de l’établissement, et à l’assureur.');
    }
    const lignes = await this.prisma.tarifPropose.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(etab ? { etablissementId: ctx.etablissementId! } : {}),
        ...(statut ? { statut } : {}),
      },
      orderBy: { dateProposition: 'desc' },
      take: 200,
    });
    const actes = await this.prisma.acteDossier.findMany({
      where: { id: { in: lignes.map((l) => l.acteDossierId) } },
      select: { id: true, libelle: true, codeActe: true, quantite: true, montantPrescrit: true },
    });
    const parId = new Map(actes.map((a) => [a.id, a]));
    return lignes.map((l) => {
      const a = parId.get(l.acteDossierId);
      return {
        ...this.projeter(l),
        acte: a
          ? {
              libelle: a.libelle,
              codeActe: a.codeActe,
              quantite: a.quantite,
              prixAffiche: a.montantPrescrit ? new Decimal(a.montantPrescrit.toString()).mul(a.quantite).toFixed(2) : null,
            }
          : null,
      };
    });
  }

  async obtenir(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    const etab = this.estEtablissement(ctx);
    if (!etab && !this.aRole(ctx, ROLES_LECTURE_ASSUREUR_TARIF_PROPOSE)) {
      throw new ForbiddenException('Réservé au comptable ou à l’administratif de l’établissement, et à l’assureur.');
    }
    const t = await this.prisma.tarifPropose.findFirst({
      where: {
        id,
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(etab ? { etablissementId: ctx.etablissementId! } : {}),
      },
    });
    if (!t) throw new NotFoundException('Proposition de tarif introuvable.');
    return this.projeter(t);
  }

  /**
   * Actes de l'établissement pouvant faire l'objet d'une proposition : réalisés, jamais réglés, sans proposition
   * vivante. Que l'acte soit réellement non tarifable est contrôlé à la proposition (calcul du microservice).
   */
  async actesAProposer(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    if (!this.estEtablissement(ctx)) {
      throw new ForbiddenException('Réservé au comptable ou à l’administratif de l’établissement.');
    }
    const actes = await this.prisma.acteDossier.findMany({
      where: {
        statut: 'REALISE',
        deletedAt: null,
        dossier: { organisationId: ctx.organisationId, etablissementId: ctx.etablissementId! },
        lignesFacturation: { none: { statut: 'PAYE' } },
      },
      select: { id: true, libelle: true, codeActe: true, quantite: true, montantPrescrit: true, dateRealisation: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const vivants = await this.prisma.tarifPropose.findMany({
      where: { acteDossierId: { in: actes.map((a) => a.id) }, deletedAt: null, statut: { not: 'REFUSE' } },
      select: { acteDossierId: true },
    });
    const dejaPropose = new Set(vivants.map((v) => v.acteDossierId));
    return actes
      .filter((a) => !dejaPropose.has(a.id))
      .map((a) => ({
        id: a.id,
        libelle: a.libelle,
        codeActe: a.codeActe,
        quantite: a.quantite,
        prixAffiche: a.montantPrescrit ? new Decimal(a.montantPrescrit.toString()).mul(a.quantite).toFixed(2) : null,
        dateRealisation: iso(a.dateRealisation),
      }));
  }

  // ------------------------------------------------------------------ calcul du microservice

  /** Calcul du microservice pour UN acte déjà enregistré (même chemin que la facture). */
  private async simulerActe(acteId: string, organisationId: string) {
    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: acteId, deletedAt: null, dossier: { organisationId } },
      include: { dossier: { include: { police: { select: { produitId: true } } } } },
    });
    if (!acte) throw new NotFoundException('Acte introuvable.');
    const garantie = await this.prisma.garantie.findFirst({
      where: { produitId: acte.dossier.police.produitId, categorieActe: acte.categorieActe, deletedAt: null },
    });
    if (!garantie) return { acte, resultat: null as null };
    const montant = new Decimal(acte.montantPrescrit?.toString() ?? '0').mul(acte.quantite);
    try {
      const r = await this.adjudication.simuler({
        police_id: acte.dossier.policeId,
        adherent_id: acte.dossier.adherentId,
        beneficiaire_id: acte.dossier.adherentId ? null : acte.dossier.beneficiaireId,
        etablissement_id: acte.dossier.etablissementId,
        date_reference: null,
        type_visite: acte.dossier.typeVisite ?? null,
        lignes: [
          {
            garantie_id: garantie.id,
            montant: montant.toFixed(2),
            code_acte: acte.codeActe,
            acte_dossier_id: acte.id,
            quantite: acte.quantite,
            date_soins: (acte.dateRealisation ?? acte.datePrescription).toISOString().slice(0, 10),
          },
        ],
      });
      return { acte, resultat: r.lignes[0] };
    } catch (err) {
      this.logger.error(`Calcul indisponible : ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException(
        "Le calcul de la prise en charge est momentanément indisponible : la proposition n'a pas été enregistrée. Réessayez dans quelques minutes.",
      );
    }
  }

  // ------------------------------------------------------------------ proposition

  async proposer(user: AuthenticatedUser, dto: ProposerTarifDto) {
    const ctx = await this.contexte(user);
    if (!this.aRole(ctx, ROLES_PROPOSITION_TARIF) || !ctx.etablissementId) {
      throw new ForbiddenException(
        'Seuls le comptable et l’administratif d’un établissement peuvent proposer un tarif.',
      );
    }
    const acte = await this.prisma.acteDossier.findFirst({
      where: {
        id: dto.acteDossierId,
        deletedAt: null,
        dossier: { organisationId: ctx.organisationId, etablissementId: ctx.etablissementId },
      },
      select: { id: true, statut: true, libelle: true, quantite: true },
    });
    // autre organisation ou autre établissement : introuvable (aucune fuite d'existence)
    if (!acte) throw new NotFoundException('Acte introuvable.');

    if (acte.statut !== 'REALISE') {
      return this.refuser(user, acte.id, 'PROPOSITION_TARIF', 'Seul un acte réalisé peut recevoir une proposition de tarif.');
    }
    const existant = await this.prisma.tarifPropose.findFirst({
      where: { acteDossierId: acte.id, deletedAt: null, statut: { not: 'REFUSE' } },
      select: { statut: true },
    });
    if (existant) {
      return this.refuser(
        user,
        acte.id,
        'PROPOSITION_TARIF',
        `Cet acte a déjà une proposition de tarif (${existant.statut}) : une seule proposition à la fois.`,
      );
    }
    const regle = await this.prisma.ligneFacturation.count({ where: { acteDossierId: acte.id, statut: 'PAYE', tarifProvisoire: false } });
    if (regle > 0) {
      return this.refuser(user, acte.id, 'PROPOSITION_TARIF', 'Cet acte est déjà réglé : aucune proposition de tarif possible.');
    }

    // seul un acte réellement NON TARIFABLE peut recevoir une proposition (jamais pour contourner un tarif négocié)
    const { resultat } = await this.simulerActe(acte.id, ctx.organisationId);
    if (!resultat) {
      return this.refuser(user, acte.id, 'PROPOSITION_TARIF', 'La catégorie de cet acte n’est pas couverte par la police : aucun tarif à proposer.');
    }
    const trace = resultat.trace_tarif;
    if (!trace || trace.statut_tarif !== 'NON_TARIFABLE') {
      return this.refuser(
        user,
        acte.id,
        'PROPOSITION_TARIF',
        trace?.statut_tarif === 'TARIFABLE' && trace.regle_origine !== 'AUCUNE_CONVENTION'
          ? 'Cet acte est tarifable par la convention de l’établissement : il n’y a pas de tarif à proposer.'
          : 'Cet acte n’est rattaché à aucune convention validée : le prix affiché est reconnu, aucun tarif à proposer.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let t;
      try {
        t = await tx.tarifPropose.create({
          data: {
            organisationId: ctx.organisationId,
            etablissementId: ctx.etablissementId!,
            acteDossierId: acte.id,
            montantPropose: new Decimal(dto.montantPropose).toFixed(2),
            justification: dto.justification.trim(),
            proposePar: ctx.userId,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Cet acte a déjà une proposition de tarif.');
        }
        throw e;
      }
      await this.audit(tx, 'PROPOSITION_TARIF', t.id, ctx.userId, {
        acteDossierId: acte.id,
        etablissementId: ctx.etablissementId,
        montantPropose: t.montantPropose.toFixed(2),
        quantite: acte.quantite,
        message: trace.message,
      });
      return this.projeter(t);
    });
  }

  // ------------------------------------------------------------------ réintégration des lignes décidées

  /**
   * Réintègre les lignes dont la proposition a été DÉCIDÉE (lot 5) : VALIDE / AJUSTE → nouveau calcul avec le montant
   * retenu (la trace provisoire est remplacée une seule fois, ensuite figée), la ligne redevient payable ; REFUSE → le
   * calcul provisoire cesse d'entamer les plafonds. Une ligne en litige reste exclue par ailleurs (double exclusion).
   * `userId` : la personne dont l'action déclenche la réintégration (auteur de l'audit). Renvoie le nombre de lignes traitées.
   */
  async synchroniserLignes(organisationId: string, etablissementId: string, userId: string): Promise<number> {
    const lignes = await this.prisma.ligneFacturation.findMany({
      where: {
        organisationId,
        tarifProvisoire: true,
        acteDossier: { dossier: { etablissementId } },
      },
      select: { id: true, acteDossierId: true, tarifProposeId: true },
    });
    let traitees = 0;
    for (const l of lignes) {
      if (!l.tarifProposeId) continue;
      const tp = await this.prisma.tarifPropose.findFirst({
        where: { id: l.tarifProposeId, organisationId },
        select: { statut: true },
      });
      if (!tp || tp.statut === 'PROPOSE') continue;
      if (tp.statut === 'REFUSE') {
        await this.prisma.ligneFacturation.update({ where: { id: l.id }, data: { tarifProvisoire: false } });
        traitees += 1;
        continue;
      }
      const { acte, resultat } = await this.simulerActe(l.acteDossierId, organisationId);
      if (!resultat?.trace_tarif || resultat.trace_tarif.provisoire) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.ligneFacturation.update({
          where: { id: l.id },
          data: {
            montantReclame: new Decimal(String(resultat.montant_couvert)).toFixed(2),
            reporteeMoisSuivant: false,
            ...colonnesTrace(resultat.trace_tarif),
            tarifProvisoire: false,
          },
        });
        await this.audit(tx, 'REINTEGRATION_LIGNE_TARIF_PROPOSE', l.tarifProposeId!, userId, {
          ligneFacturationId: l.id,
          acteDossierId: acte.id,
          statutDecision: tp.statut,
          montantReclame: new Decimal(String(resultat.montant_couvert)).toFixed(2),
        });
      });
      traitees += 1;
    }
    return traitees;
  }

  /** Acte à tarif proposé non décidé, pour l'affichage patient : part estimée à titre indicatif. */
  async actesEnExamen(db: Db, factureDossierId: string) {
    const lignes = await db.ligneFacturation.findMany({
      where: { factureDossierId, tarifProvisoire: true },
      include: { acteDossier: { select: { libelle: true, montantPrescrit: true, quantite: true } } },
    });
    return lignes.map((l) => {
      const total = new Decimal(l.acteDossier.montantPrescrit?.toString() ?? '0').mul(l.acteDossier.quantite);
      return {
        acteId: l.acteDossierId,
        libelle: l.acteDossier.libelle,
        tarifPropose: l.tarifReconnu ? l.tarifReconnu.toFixed(2) : null,
        partEstimeeAssurance: l.montantReclame.toFixed(2),
        partEstimeePatient: total.sub(l.montantReclame.toString()).toFixed(2),
        mention: MENTION_TARIF_EN_EXAMEN,
        indicatif: true,
      };
    });
  }

  // ------------------------------------------------------------------ audit

  private async audit(db: Db, action: string, enregistrementId: string, userId: string | null, details: unknown) {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'tarifs_proposes'}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(`Échec log_audit(${action}, ${enregistrementId}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      throw error;
    }
  }
}
