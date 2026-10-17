import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type TarifPropose } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { DUREE_CODE_FACTURATION_MS, expirationDans } from '../common/codes-secrets';
import Decimal from 'decimal.js';
import { AdjudicationClientService, type TraceTarif } from '../adjudication-client/adjudication-client.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { verrouillerPlafond } from '../adjudication-client/verrou-plafond';
import { bornesPage, versPage } from '../common/pagination';
import { ConventionsService } from '../conventions/conventions.service';
import { EmailService } from '../email/email.service';
import { ALPHABET_CODE, LONGUEUR_CODE } from '../preauthorization/preauthorization.types';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileTarifsProposesQueryDto, ProposerTarifDto } from './dto/tarifs-proposes.dto';
import {
  CLE_ECART_MEDIANE,
  CLE_ESCALADE_JOURS,
  CLE_RAPPEL_JOURS,
  CLE_RECURRENCE_JOURS,
  CLE_RECURRENCE_NOMBRE,
  DEFAUT_ECART_MEDIANE,
  DEFAUT_ESCALADE_JOURS,
  DEFAUT_RAPPEL_JOURS,
  DEFAUT_RECURRENCE_JOURS,
  DEFAUT_RECURRENCE_NOMBRE,
  MENTION_TARIF_EN_EXAMEN,
  ROLES_DECISION_TARIF,
  ROLES_FILE_TARIF_PROPOSE,
  ROLES_LECTURE_ASSUREUR_TARIF_PROPOSE,
  ROLES_PROPOSITION_TARIF,
  ROLES_RAPPELS_TARIF_PROPOSE,
  type ActionDecision,
} from './tarifs-proposes.types';

type Db = PrismaService | Prisma.TransactionClient;

interface Ctx {
  userId: string;
  organisationId: string;
  etablissementId: string | null;
  roleChain: string[];
}

const JOUR_MS = 86_400_000;
/** La décision recalcule sous verrou en appelant le microservice : même marge que la facture. */
const DELAI_TRANSACTION_DECISION_MS = 30_000;
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
    private readonly email: EmailService,
    private readonly conventions: ConventionsService,
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

  private projeter(t: TarifPropose) {
    const montantRetenu =
      t.statut === 'VALIDE' ? t.montantPropose.toFixed(2) : t.statut === 'AJUSTE' && t.montantDecide ? t.montantDecide.toFixed(2) : null;
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
      // ce que voit l'établissement : montant RETENU, motif du refus ou de l'ajustement
      montantRetenu,
      motifDecision: t.motifDecision,
      motifRefus: t.statut === 'REFUSE' ? t.motifDecision : null,
      ajoutConventionId: t.ajoutConventionId,
      etablissementPrevenuLe: t.etablissementPrevenuLe,
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
  private async simulerActe(
    acteId: string,
    organisationId: string,
    imposee?: { id: string; statut: string; montant_propose: string; montant_decide: string | null },
  ) {
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
            ...(imposee ? { tarif_propose: imposee } : {}),
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
        'Seuls le comptable, l’administratif et l’accueil d’un établissement peuvent proposer un tarif.',
      );
    }
    const acte = await this.prisma.acteDossier.findFirst({
      where: {
        id: dto.acteDossierId,
        deletedAt: null,
        dossier: { organisationId: ctx.organisationId, etablissementId: ctx.etablissementId },
      },
      select: { id: true, statut: true, libelle: true, quantite: true, categorieActe: true },
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

    const montantUnitaire = new Decimal(dto.montantPropose).div(acte.quantite);
    const [alerte, recurrence] = await Promise.all([
      this.alerteMontant(ctx.organisationId, acte.categorieActe, montantUnitaire),
      this.alerteRecurrence(ctx.organisationId, ctx.etablissementId),
    ]);
    return this.prisma.$transaction(async (tx) => {
      let t;
      try {
        t = await tx.tarifPropose.create({
          data: {
            categorieActe: acte.categorieActe,
            alerteRenforcee: alerte.renforcee,
            alerteRecurrence: recurrence.recurrence,
            alerteDetails: { ...alerte.details, recurrence: { nombre: recurrence.nombre } },
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
        alerteRenforcee: alerte.renforcee,
        alerteRecurrence: recurrence.recurrence,
      });
      return { ...this.projeter(t), alerteRenforcee: alerte.renforcee, alerteRecurrence: recurrence.recurrence };
    });
  }

  // ------------------------------------------------------------------ paramètres de plateforme

  private async parametre(cle: string, defaut: number): Promise<number> {
    const p = await this.prisma.parametrePlateforme.findUnique({ where: { cle } });
    const v = p ? Number(p.valeur) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : defaut;
  }

  // ------------------------------------------------------------------ alertes (à la proposition)

  /**
   * Alerte RENFORCÉE : le montant par unité dépasse de `seuil` % la médiane des tarifs reconnus (par unité) de la même
   * catégorie de garantie sur 12 mois — tarifs issus d'une convention (forfait, valeur propre, valeur de lettre-clé),
   * jamais d'un autre tarif proposé. SANS historique, l'alerte est systématique.
   */
  private async alerteMontant(organisationId: string, categorieActe: string, montantUnitaire: Decimal) {
    const seuil = await this.parametre(CLE_ECART_MEDIANE, DEFAUT_ECART_MEDIANE);
    const lignes = await this.prisma.$queryRaw<{ mediane: Prisma.Decimal | null; n: number }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY lf.tarif_unitaire) AS mediane, count(*)::int AS n
        FROM lignes_facturation lf
        JOIN actes_dossier ad ON ad.id = lf.acte_dossier_id
       WHERE lf.organisation_id = ${organisationId}::uuid
         AND ad.categorie_acte = ${categorieActe}
         AND lf.tarif_statut = 'TARIFABLE'
         AND lf.tarif_regle_origine IN ('FORFAIT', 'VALEUR_PROPRE', 'VALEUR_LETTRE_CLE')
         AND lf.tarif_provisoire = false
         AND lf.tarif_unitaire IS NOT NULL
         AND lf.created_at >= now() - interval '12 months'`;
    const n = lignes[0]?.n ?? 0;
    const mediane = lignes[0]?.mediane ? new Decimal(lignes[0].mediane.toString()) : null;
    if (n === 0 || !mediane) {
      return { renforcee: true, details: { raison: 'SANS_HISTORIQUE', nbReference: 0, seuilPourcent: seuil, montantUnitaire: montantUnitaire.toFixed(2) } };
    }
    const plafondAlerte = mediane.mul(new Decimal(100).add(seuil)).div(100);
    const renforcee = montantUnitaire.gt(plafondAlerte);
    return {
      renforcee,
      details: {
        raison: renforcee ? 'ECART_MEDIANE' : 'DANS_LA_NORME',
        nbReference: n,
        mediane: mediane.toFixed(2),
        seuilPourcent: seuil,
        montantUnitaire: montantUnitaire.toFixed(2),
        ecartPourcent: mediane.gt(0) ? montantUnitaire.sub(mediane).div(mediane).mul(100).toFixed(1) : null,
      },
    };
  }

  /** Alerte de RÉCURRENCE : N propositions ou plus du même établissement sur la période (celle en cours comprise). */
  private async alerteRecurrence(organisationId: string, etablissementId: string): Promise<{ recurrence: boolean; nombre: number }> {
    const [nombre, jours] = await Promise.all([
      this.parametre(CLE_RECURRENCE_NOMBRE, DEFAUT_RECURRENCE_NOMBRE),
      this.parametre(CLE_RECURRENCE_JOURS, DEFAUT_RECURRENCE_JOURS),
    ]);
    const depuis = new Date(Date.now() - jours * JOUR_MS);
    const n = await this.prisma.tarifPropose.count({
      where: { organisationId, etablissementId, deletedAt: null, dateProposition: { gte: depuis } },
    });
    return { recurrence: n + 1 >= nombre, nombre: n + 1 };
  }

  // ------------------------------------------------------------------ file du médecin conseil

  /** « Tarifs proposés à examiner » : pagination serveur, filtres, tri alerte renforcée puis ancienneté. */
  async file(user: AuthenticatedUser, q: FileTarifsProposesQueryDto) {
    const ctx = await this.contexte(user);
    if (!this.aRole(ctx, ROLES_FILE_TARIF_PROPOSE)) {
      throw new ForbiddenException('Réservé au médecin conseil (et à la direction en lecture).');
    }
    const { page, limite, offset } = bornesPage(q);
    const [rappelJours] = await Promise.all([this.parametre(CLE_RAPPEL_JOURS, DEFAUT_RAPPEL_JOURS)]);
    const where: Prisma.TarifProposeWhereInput = {
      organisationId: ctx.organisationId,
      deletedAt: null,
      statut: q.statut ?? 'PROPOSE',
      ...(q.etablissementId ? { etablissementId: q.etablissementId } : {}),
      ...(q.categorie ? { categorieActe: q.categorie } : {}),
      ...(q.ancienneteMin ? { dateProposition: { lte: new Date(Date.now() - q.ancienneteMin * JOUR_MS) } } : {}),
    };
    const [total, lignes] = await Promise.all([
      this.prisma.tarifPropose.count({ where }),
      this.prisma.tarifPropose.findMany({
        where,
        orderBy: [{ alerteRenforcee: 'desc' }, { dateProposition: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limite,
      }),
    ]);
    const [actes, etabs] = await Promise.all([
      this.prisma.acteDossier.findMany({
        where: { id: { in: lignes.map((l) => l.acteDossierId) } },
        select: { id: true, libelle: true, codeActe: true, quantite: true, montantPrescrit: true },
      }),
      this.prisma.etablissementSante.findMany({
        where: { id: { in: lignes.map((l) => l.etablissementId) }, organisationId: ctx.organisationId },
        select: { id: true, nom: true },
      }),
    ]);
    const actesParId = new Map(actes.map((a) => [a.id, a]));
    const etabsParId = new Map(etabs.map((e) => [e.id, e.nom]));
    const items = lignes.map((l) => {
      const a = actesParId.get(l.acteDossierId);
      const anciennete = Math.floor((Date.now() - l.dateProposition.getTime()) / JOUR_MS);
      return {
        ...this.projeter(l),
        etablissement: etabsParId.get(l.etablissementId) ?? null,
        categorieActe: l.categorieActe,
        acte: a
          ? {
              libelle: a.libelle,
              codeActe: a.codeActe,
              quantite: a.quantite,
              prixAffiche: a.montantPrescrit ? new Decimal(a.montantPrescrit.toString()).mul(a.quantite).toFixed(2) : null,
            }
          : null,
        alerteRenforcee: l.alerteRenforcee,
        alerteRecurrence: l.alerteRecurrence,
        alerteDetails: l.alerteDetails,
        ancienneteJours: anciennete,
        enRetard: l.statut === 'PROPOSE' && anciennete >= rappelJours,
        peutDecider: this.aRole(ctx, ROLES_DECISION_TARIF) && l.statut === 'PROPOSE' && l.proposePar !== ctx.userId,
      };
    });
    return versPage(items, total, page, limite);
  }

  /** Compteur du tableau de bord du médecin conseil (et de la direction). */
  async compteur(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    if (!this.aRole(ctx, ROLES_FILE_TARIF_PROPOSE)) {
      throw new ForbiddenException('Réservé au médecin conseil (et à la direction en lecture).');
    }
    const rappelJours = await this.parametre(CLE_RAPPEL_JOURS, DEFAUT_RAPPEL_JOURS);
    const base = { organisationId: ctx.organisationId, deletedAt: null, statut: 'PROPOSE' };
    const [aExaminer, alertesRenforcees, enRetard] = await Promise.all([
      this.prisma.tarifPropose.count({ where: base }),
      this.prisma.tarifPropose.count({ where: { ...base, alerteRenforcee: true } }),
      this.prisma.tarifPropose.count({ where: { ...base, dateProposition: { lte: new Date(Date.now() - rappelJours * JOUR_MS) } } }),
    ]);
    return { aExaminer, alertesRenforcees, enRetard };
  }

  // ------------------------------------------------------------------ décisions

  /** Décision du médecin conseil : valider, ajuster (montant et motif) ou refuser (motif). */
  async decider(
    user: AuthenticatedUser,
    id: string,
    action: ActionDecision,
    dto: { montantDecide?: number; motif?: string; ajouterConvention?: { type: 'FORFAIT' | 'VALEUR_LETTRE_CLE' } },
  ) {
    const ctx = await this.contexte(user);
    if (!this.aRole(ctx, ROLES_DECISION_TARIF)) {
      throw new ForbiddenException('Les décisions sur les tarifs proposés sont réservées au médecin conseil.');
    }
    const tp = await this.prisma.tarifPropose.findFirst({ where: { id, organisationId: ctx.organisationId, deletedAt: null } });
    if (!tp) throw new NotFoundException('Proposition de tarif introuvable.');
    const nomAction = `DECISION_TARIF_${action}`;
    if (tp.statut !== 'PROPOSE') {
      return this.refuser(user, id, nomAction, `Cette proposition est déjà décidée (${tp.statut}).`);
    }
    // le proposant ne décide JAMAIS sur sa propre proposition (aussi garanti par un CHECK en base)
    if (tp.proposePar === ctx.userId) {
      return this.refuser(user, id, nomAction, 'Vous ne pouvez pas décider sur une proposition que vous avez saisie.', true);
    }
    const motif = dto.motif?.trim() ?? null;
    if (action === 'AJUSTER') {
      if (dto.montantDecide === undefined || !(dto.montantDecide > 0)) throw new BadRequestException('Le montant ajusté est obligatoire.');
      if (!motif || motif.length < 5) throw new BadRequestException('Le motif de l’ajustement est obligatoire (5 caractères au moins).');
      if (new Decimal(dto.montantDecide).eq(tp.montantPropose.toString())) {
        throw new BadRequestException('Le montant ajusté est identique au montant proposé : validez simplement la proposition.');
      }
    }
    if (action === 'REFUSER' && (!motif || motif.length < 5)) {
      throw new BadRequestException('Le motif du refus est obligatoire (5 caractères au moins).');
    }
    if (dto.ajouterConvention && action === 'REFUSER') {
      throw new BadRequestException('L’ajout à la convention n’est possible qu’après une validation ou un ajustement.');
    }

    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: tp.acteDossierId, deletedAt: null, dossier: { organisationId: ctx.organisationId } },
      include: { dossier: { include: { police: { select: { produitId: true } } } } },
    });
    if (!acte) throw new NotFoundException('Acte introuvable.');
    if (dto.ajouterConvention && !acte.referentielActeId) {
      return this.refuser(user, id, nomAction, 'L’acte n’est pas rattaché au référentiel de l’organisation : impossible de créer une exception de convention.');
    }

    const statut = action === 'VALIDER' ? 'VALIDE' : action === 'AJUSTER' ? 'AJUSTE' : 'REFUSE';
    const montantRetenu = action === 'AJUSTER' ? new Decimal(dto.montantDecide!) : new Decimal(tp.montantPropose.toString());
    const imposee = {
      id: tp.id,
      statut,
      montant_propose: tp.montantPropose.toFixed(2),
      montant_decide: action === 'AJUSTER' ? new Decimal(dto.montantDecide!).toFixed(2) : null,
    };

    const atteintAvant = await this.plafondAtteint(acte);
    const resultat = await this.prisma.$transaction(
      async (tx) => {
        // MÊME verrou personne / famille que la facture et l'adjudication : le recalcul lit des cumuls stables
        await verrouillerPlafond(tx, {
          adherentId: acte.dossier.adherentId,
          beneficiaireId: acte.dossier.beneficiaireId,
          policeId: acte.dossier.policeId,
          produitId: acte.dossier.police.produitId,
        });
        const maj = await tx.tarifPropose.update({
          where: { id },
          data: {
            statut,
            decidePar: ctx.userId,
            dateDecision: new Date(),
            montantDecide: action === 'AJUSTER' ? new Decimal(dto.montantDecide!).toFixed(2) : null,
            motifDecision: motif,
          },
        });

        const ligne = await tx.ligneFacturation.findFirst({
          where: { acteDossierId: acte.id, tarifProposeId: id },
          include: { factureDossier: { select: { ticketSoinsId: true } } },
        });
        const prixTotal = new Decimal(acte.montantPrescrit?.toString() ?? '0').mul(acte.quantite);
        let avant: Decimal | null = null;
        let apres: Decimal | null = null;
        let factureComplementaire: { id: string; montantPatient: string } | null = null;
        if (ligne) {
          avant = new Decimal(ligne.montantReclame.toString());
          if (action === 'REFUSER') {
            // le calcul provisoire cesse de peser ; l'assurance ne paie rien pour cet acte ; la ligne reste exclue
            await tx.ligneFacturation.update({ where: { id: ligne.id }, data: { tarifProvisoire: false, montantReclame: '0.00' } });
            apres = new Decimal(0);
          } else {
            const { resultat: calcul } = await this.simulerActe(acte.id, ctx.organisationId, imposee);
            if (!calcul?.trace_tarif || calcul.trace_tarif.provisoire) {
              throw new ConflictException('Le recalcul du microservice n’a pas pu appliquer la décision : réessayez.');
            }
            apres = new Decimal(String(calcul.montant_couvert));
            await tx.ligneFacturation.update({
              where: { id: ligne.id },
              data: {
                montantReclame: apres.toFixed(2),
                // réintégrée ; une ligne en litige est ré-exclue par la consolidation mensuelle (double exclusion)
                reporteeMoisSuivant: false,
                ...colonnesTrace(calcul.trace_tarif),
                tarifProvisoire: false,
              },
            });
          }
          // part patient : prix affiché − part assurance (REFUSE : tout le prix affiché)
          const due = prixTotal.sub(apres);
          if (due.gt(0)) {
            const ticketId =
              ligne.factureDossier?.ticketSoinsId ??
              (await tx.ticketSoins.findFirst({ where: { dossierSoinsId: acte.dossierSoinsId }, select: { id: true } }))?.id;
            if (!ticketId) throw new ConflictException('Aucun ticket de soins pour établir la facture complémentaire.');
            const f = await tx.factureDossier.create({
              data: {
                organisationId: ctx.organisationId,
                dossierSoinsId: acte.dossierSoinsId,
                ticketSoinsId: ticketId,
                etablissementId: acte.dossier.etablissementId,
                adherentId: acte.dossier.adherentId,
                beneficiaireId: acte.dossier.beneficiaireId,
                // facture COMPLÉMENTAIRE : uniquement la part patient (l'assurance est déjà portée par la ligne)
                montantTotal: due.toFixed(2),
                montantAssurance: '0.00',
                montantPatient: due.toFixed(2),
                statut: 'EMISE',
                codeFacturation: await this.codeFacturationUnique(tx),
                codeFacturationExpireLe: expirationDans(DUREE_CODE_FACTURATION_MS),
                tarifProposeId: id,
              },
            });
            factureComplementaire = { id: f.id, montantPatient: due.toFixed(2) };
          }
        }

        let ajout: { conventionId: string; numero: string; version: number; versionCreee: boolean } | null = null;
        if (dto.ajouterConvention) {
          const unitaire = montantRetenu.div(acte.quantite).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          ajout = await this.conventions.ajouterExceptionDepuisTarifPropose(tx, {
            userId: ctx.userId,
            organisationId: ctx.organisationId,
            etablissementId: acte.dossier.etablissementId,
            referentielActeId: acte.referentielActeId!,
            type: dto.ajouterConvention.type,
            montantUnitaire: unitaire,
          });
          await tx.tarifPropose.update({
            where: { id },
            data: { ajoutConventionId: ajout.conventionId, ajoutConventionType: dto.ajouterConvention.type },
          });
        }

        await this.audit(tx, nomAction, id, ctx.userId, {
          acteDossierId: acte.id,
          etablissementId: acte.dossier.etablissementId,
          montantPropose: tp.montantPropose.toFixed(2),
          montantRetenu: action === 'REFUSER' ? null : montantRetenu.toFixed(2),
          motif,
          ligneFacturationId: ligne?.id ?? null,
          montantLigneAvant: avant?.toFixed(2) ?? null,
          montantLigneApres: apres?.toFixed(2) ?? null,
          factureComplementaireId: factureComplementaire?.id ?? null,
          ajoutConvention: ajout,
        });
        return { maj, avant, apres, factureComplementaire, ajout };
      },
      { timeout: DELAI_TRANSACTION_DECISION_MS },
    );

    // après le commit : alerte de plafond (le microservice lit des données validées) puis information de l'établissement
    const alertePlafond = await this.controlerPlafondApresDecision(ctx, acte, tp, resultat.avant, resultat.apres, atteintAvant);
    await this.prevenirEtablissement(acte.dossier.etablissementId, tp.id, statut, {
      acteLibelle: acte.libelle,
      montantPropose: tp.montantPropose.toFixed(2),
      montantRetenu: action === 'REFUSER' ? null : montantRetenu.toFixed(2),
      motif,
    });
    const final = await this.prisma.tarifPropose.findUniqueOrThrow({ where: { id } });
    return {
      ...this.projeter(final),
      alertePlafond,
      factureComplementaire: resultat.factureComplementaire,
      ajoutConvention: resultat.ajout,
    };
  }

  /**
   * Plafond annuel (famille ou personne) de la catégorie de l'acte DÉJÀ ATTEINT ? Lu auprès du microservice (données
   * validées). `null` si l'état n'est pas disponible : l'alerte est alors simplement omise.
   */
  private async plafondAtteint(acte: {
    categorieActe: string;
    dossier: { policeId: string; adherentId: string | null; beneficiaireId: string | null };
  }): Promise<{ famille: boolean; personne: boolean } | null> {
    try {
      const titulaire =
        acte.dossier.adherentId ??
        (acte.dossier.beneficiaireId
          ? (await this.prisma.beneficiaire.findUnique({ where: { id: acte.dossier.beneficiaireId }, select: { adherentId: true } }))?.adherentId
          : null);
      if (!titulaire) return null;
      const etat = await this.adjudication.etatPlafonds(acte.dossier.policeId, titulaire);
      const g = etat.garanties.find((x) => x.categorie_acte === acte.categorieActe);
      if (!g) return null;
      return {
        famille: g.restant_famille !== null && g.restant_famille <= 0,
        personne: g.personnes.some(
          (p) => p.restant !== null && p.restant <= 0 && (p.adherent_id === acte.dossier.adherentId || p.beneficiaire_id === acte.dossier.beneficiaireId),
        ),
      };
    } catch (e) {
      this.logger.error(`État des plafonds indisponible : ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Alerte au médecin conseil quand une décision MODIFIE la consommation d'un plafond DÉJÀ ATTEINT (avant ou après la
   * décision). LIMITE ACCEPTÉE (ADR-008) : le recalcul de la ligne décidée respecte le plafond (il ne peut pas le
   * dépasser), mais les lignes déjà acceptées APRÈS elle ne sont pas recalculées — plafonnées à cause de la ligne
   * provisoire, elles ne retrouvent pas le montant libéré par un refus ou un ajustement à la baisse ; l'alerte est le seul
   * garde-fou, la correction restant manuelle.
   */
  private async controlerPlafondApresDecision(
    ctx: Ctx,
    acte: { id: string; categorieActe: string; dossier: { policeId: string; adherentId: string | null; beneficiaireId: string | null } },
    tp: { id: string },
    avant: Decimal | null,
    apres: Decimal | null,
    atteintAvant: { famille: boolean; personne: boolean } | null,
  ): Promise<{ message: string } | null> {
    if (avant === null || apres === null || apres.eq(avant)) return null;
    const atteintApres = await this.plafondAtteint(acte);
    const niveau = atteintAvant?.famille || atteintApres?.famille ? 'famille' : atteintAvant?.personne || atteintApres?.personne ? 'personne' : null;
    if (!niveau) return null;
    const delta = apres.sub(avant);
    const message =
      `La décision ${delta.gt(0) ? 'augmente' : 'libère'} ${delta.abs().toFixed(0)} F sur un plafond ${niveau} déjà atteint (${acte.categorieActe}). ` +
      'Les lignes déjà acceptées postérieurement ne sont pas recalculées : elles peuvent avoir été plafonnées ou, à l’inverse, le plafond peut être dépassé.';
    await this.prisma.tarifPropose.update({ where: { id: tp.id }, data: { alertePlafond: true, alertePlafondMessage: message } });
    await this.audit(this.prisma, 'ALERTE_PLAFOND_DECISION_TARIF', tp.id, ctx.userId, { message, categorie: acte.categorieActe, niveau, delta: delta.toFixed(2) });
    return { message };
  }

  // ------------------------------------------------------------------ e-mails (EmailService)

  private async emailsDe(organisationId: string, roles: readonly string[], etablissementId?: string): Promise<string[]> {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const profils = await this.prisma.profil.findMany({
      where: { organisationId, role: { in: [...roles] }, deletedAt: null, ...(etablissementId ? { etablissementId } : {}) },
      select: { id: true },
    });
    const emails: string[] = [];
    for (const p of profils) {
      const { data } = await admin.auth.admin.getUserById(p.id).catch(() => ({ data: null }));
      if (data?.user?.email) emails.push(data.user.email);
    }
    return emails;
  }

  /** Informe le comptable et l'administratif de l'établissement de la décision (un échec d'envoi ne bloque rien). */
  private async prevenirEtablissement(
    etablissementId: string,
    tarifProposeId: string,
    statut: string,
    d: { acteLibelle: string; montantPropose: string; montantRetenu: string | null; motif: string | null },
  ) {
    try {
      const tp = await this.prisma.tarifPropose.findUnique({ where: { id: tarifProposeId }, select: { organisationId: true } });
      if (!tp) return;
      const emails = await this.emailsDe(tp.organisationId, ROLES_PROPOSITION_TARIF, etablissementId);
      const libelle = statut === 'VALIDE' ? 'validé' : statut === 'AJUSTE' ? 'ajusté' : 'refusé';
      const contenu =
        `Votre proposition de tarif pour l’acte « ${d.acteLibelle} » (${d.montantPropose} F) a été ${libelle}.\n` +
        (d.montantRetenu ? `Montant retenu : ${d.montantRetenu} F.\n` : 'L’acte reste non tarifable : vous pouvez proposer un autre montant, avec une nouvelle justification.\n') +
        (d.motif ? `Motif : ${d.motif}\n` : '');
      if (emails.length > 0) await this.email.envoyerEmail(emails, `Tarif proposé ${libelle}`, contenu);
      await this.prisma.tarifPropose.update({ where: { id: tarifProposeId }, data: { etablissementPrevenuLe: new Date() } });
    } catch (e) {
      this.logger.error(`Information de l’établissement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Rappel à J+2 (médecin conseil) et escalade à J+5 (direction) des propositions non décidées — déclenchable à la main
   * (comme `marquer-en-retard`). DETTE : aucun planificateur automatique n'est branché (voir ADR-008).
   */
  async envoyerRappels(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    if (!this.aRole(ctx, ROLES_RAPPELS_TARIF_PROPOSE)) {
      throw new ForbiddenException('Réservé à l’assurance informatique, à la direction et au médecin conseil.');
    }
    const [rappelJours, escaladeJours] = await Promise.all([
      this.parametre(CLE_RAPPEL_JOURS, DEFAUT_RAPPEL_JOURS),
      this.parametre(CLE_ESCALADE_JOURS, DEFAUT_ESCALADE_JOURS),
    ]);
    const base = { organisationId: ctx.organisationId, deletedAt: null, statut: 'PROPOSE' };
    const aRappeler = await this.prisma.tarifPropose.findMany({
      where: { ...base, rappelEnvoyeLe: null, dateProposition: { lte: new Date(Date.now() - rappelJours * JOUR_MS) } },
      select: { id: true, acteDossierId: true, montantPropose: true, dateProposition: true },
    });
    const aEscalader = await this.prisma.tarifPropose.findMany({
      where: { ...base, escaladeEnvoyeeLe: null, dateProposition: { lte: new Date(Date.now() - escaladeJours * JOUR_MS) } },
      select: { id: true, acteDossierId: true, montantPropose: true, dateProposition: true },
    });
    let rappels = 0;
    let escalades = 0;
    if (aRappeler.length > 0) {
      const emails = await this.emailsDe(ctx.organisationId, ['ASSUREUR_MEDECIN_CONSEIL']);
      const contenu = `${aRappeler.length} proposition(s) de tarif attendent votre décision depuis ${rappelJours} jour(s) ou plus. Ouvrez « Tarifs proposés à examiner ».`;
      if (emails.length > 0) await this.email.envoyerEmail(emails, 'Rappel : tarifs proposés à examiner', contenu);
      await this.prisma.$transaction(async (tx) => {
        await tx.tarifPropose.updateMany({ where: { id: { in: aRappeler.map((t) => t.id) } }, data: { rappelEnvoyeLe: new Date() } });
        await this.audit(tx, 'RAPPEL_TARIFS_PROPOSES', aRappeler[0].id, ctx.userId, { nombre: aRappeler.length, ids: aRappeler.map((t) => t.id) });
      });
      rappels = aRappeler.length;
    }
    if (aEscalader.length > 0) {
      const emails = await this.emailsDe(ctx.organisationId, ['ASSUREUR_DIRECTION']);
      const contenu = `${aEscalader.length} proposition(s) de tarif sont sans décision depuis ${escaladeJours} jour(s) ou plus : escalade à la direction.`;
      if (emails.length > 0) await this.email.envoyerEmail(emails, 'Escalade : tarifs proposés sans décision', contenu);
      await this.prisma.$transaction(async (tx) => {
        await tx.tarifPropose.updateMany({ where: { id: { in: aEscalader.map((t) => t.id) } }, data: { escaladeEnvoyeeLe: new Date() } });
        await this.audit(tx, 'ESCALADE_TARIFS_PROPOSES', aEscalader[0].id, ctx.userId, { nombre: aEscalader.length, ids: aEscalader.map((t) => t.id) });
      });
      escalades = aEscalader.length;
    }
    return { rappels, escalades, rappelApresJours: rappelJours, escaladeApresJours: escaladeJours };
  }

  // ------------------------------------------------------------------ facture complémentaire (vue du patient)

  /** Détail, pour l'établissement et le patient, des factures complémentaires : statut du tarif, motif, montant retenu. */
  async detailsComplementaires(db: Db, tarifProposeIds: string[]) {
    const ids = tarifProposeIds.filter(Boolean);
    if (ids.length === 0) return new Map<string, Record<string, unknown>>();
    const tps = await db.tarifPropose.findMany({ where: { id: { in: ids } } });
    const actes = await db.acteDossier.findMany({
      where: { id: { in: tps.map((t) => t.acteDossierId) } },
      select: { id: true, libelle: true },
    });
    const libelles = new Map(actes.map((a) => [a.id, a.libelle]));
    return new Map(
      tps.map((t) => [
        t.id,
        {
          acte: libelles.get(t.acteDossierId) ?? null,
          statutTarif: t.statut,
          montantRetenu: t.statut === 'VALIDE' ? t.montantPropose.toFixed(2) : t.statut === 'AJUSTE' && t.montantDecide ? t.montantDecide.toFixed(2) : null,
          motifRefus: t.statut === 'REFUSE' ? t.motifDecision : null,
          motifAjustement: t.statut === 'AJUSTE' ? t.motifDecision : null,
        },
      ]),
    );
  }

  private async codeFacturationUnique(db: Db): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      let c = '';
      for (let i = 0; i < LONGUEUR_CODE; i += 1) c += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
      if (!(await db.factureDossier.findUnique({ where: { codeFacturation: c } }))) return c;
    }
    throw new ConflictException('Impossible de générer un code de facturation unique — réessayez.');
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
