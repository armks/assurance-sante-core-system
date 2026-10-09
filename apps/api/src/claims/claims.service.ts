import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import {
  AdjudicationClientService,
  AdjudicationInjoignableError,
  AdjudicationRefusError,
  MESSAGES_INDISPONIBILITE,
  type DecisionAdjudication,
} from '../adjudication-client/adjudication-client.service';
import {
  SoumettreReclamationDto,
  ValiderManuellementDto,
} from './dto/claims.dto';
import {
  CATEGORIE_ACTE_DISPENSATION,
  CODE_REJET_CATEGORIE_NON_COUVERTE,
  LIMITE_ACTES_RECLAMABLES,
  STATUTS_ACTE_RECLAMABLES,
  STATUTS_PREAUTORISATION_NON_RECLAMABLES,
  CODE_REJET_MANUEL,
  ContexteAppelant,
  ROLE_REVUE_FINANCIERE,
  ROLE_REVUE_SUPERVISION,
  ROLES_ADHERENT_CLAIMS,
  ROLES_GESTION_CLAIMS,
  ROLES_LECTURE_CLAIMS,
  ROLES_SOCIETE_CLAIMS,
  type TypeReclamation,
} from './claims.types';

/** Source d'une réclamation — exactement l'une des deux (v3 §5 étendu, prisma/sql/040). */
type SourceReclamation = { acteDossierId: string } | { dispensationId: string };

/** Mode de lecture résolu par `modeLecture()` — voir son commentaire. */
type ModeLecture = 'STAFF' | 'ADHERENT' | 'SOCIETE';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * ClaimsService — réception + adjudication des réclamations (v1 §16, PROMPT 24).
 *
 * `soumettre` :
 *   1. construit la réclamation à partir de l'acte de dossier (une seule
 *      réclamation vivante par acte — index unique `reclamations_acte_dossier_unique`) ;
 *   2. la VERROUILLE : `SOUMISE → EN_ADJUDICATION` via un compare-and-swap atomique
 *      (`updateMany where statut = 'SOUMISE'`). Toute seconde soumission — séquentielle
 *      OU concurrente — échoue proprement (409) ;
 *   3. **appelle le microservice Java** (`adjudication-service`, JWT de service HMAC),
 *      applique la décision (`codes_rejet`, statut) et la renvoie complète à l'appelant.
 *
 * Robustesse (§ « gestion d'erreur explicite ») : si le microservice est injoignable
 * ou renvoie une erreur, la réclamation **ne reste pas bloquée à EN_ADJUDICATION** —
 * elle repasse à `SOUMISE` (avec `codes_rejet = ['ADJ_ECHEC']` comme marqueur de
 * reprise), l'erreur est journalisée (`ECHEC_ADJUDICATION`), et l'appelant reçoit
 * un `503` / `502` explicite (jamais un `500` opaque).
 */
@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly adjudication: AdjudicationClientService,
    private readonly categoriesActe: CategoriesActeService,
  ) {}

  async soumettre(user: AuthenticatedUser, dto: SoumettreReclamationDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: dto.acteDossierId, deletedAt: null },
    });
    if (!acte) {
      throw new NotFoundException('Acte de dossier introuvable.');
    }

    const dossier = await this.prisma.dossierSoins.findFirst({
      where: { id: acte.dossierSoinsId, deletedAt: null },
    });
    if (!dossier || dossier.organisationId !== ctx.organisationId) {
      // 404 plutôt que 403 : ne pas révéler un dossier d'une autre organisation
      throw new NotFoundException('Dossier de soins introuvable.');
    }

    // Mêmes conditions que la facturation tiers payant : un acte non réalisé, ou
    // dont la pré-autorisation est en attente / refusée, n'est pas remboursable.
    if (!(STATUTS_ACTE_RECLAMABLES as readonly string[]).includes(acte.statut)) {
      throw new ConflictException(
        "Cet acte n'est pas réclamable : il doit d'abord être marqué « réalisé » par le médecin traitant.",
      );
    }
    if ((STATUTS_PREAUTORISATION_NON_RECLAMABLES as readonly string[]).includes(acte.statutPreautorisation)) {
      throw new ConflictException(
        acte.statutPreautorisation === 'REFUSEE'
          ? "Cet acte n'est pas réclamable : sa pré-autorisation a été refusée."
          : "Cet acte n'est pas réclamable : sa pré-autorisation est en attente de décision.",
      );
    }

    // Acte déjà facturé en tiers payant : l'assureur le règle par la facture de
    // l'établissement, et sa part assurance consomme déjà le plafond annuel
    // (cumul du microservice, ADR-005) — une réclamation le paierait / le
    // compterait deux fois.
    const factureTiersPayant = await this.prisma.ligneFacturation.findFirst({
      where: { acteDossierId: acte.id },
      select: { id: true },
    });
    if (factureTiersPayant) {
      throw new ConflictException(
        "Acte déjà facturé en tiers payant par l'établissement : la part assurance est réglée par la facture, pas par une réclamation.",
      );
    }

    // Garantie = celle du produit pour la CATÉGORIE de l'acte (référentiel
    // unique, prisma/sql/067). `dossier.planCouvertureId` (garantie
    // CONSULTATION) reste réservé à l'éligibilité et au délai de carence de la
    // consultation : il ne sert plus au calcul d'un acte d'une autre catégorie.
    const categorie = await this.categoriesActe.parCode(acte.categorieActe);
    if (!categorie) {
      throw new ConflictException(
        `Catégorie d'acte absente du référentiel : ${acte.categorieActe}.`,
      );
    }
    const police = await this.prisma.police.findFirst({
      where: { id: dossier.policeId },
      select: { produitId: true },
    });
    const garantie = police
      ? await this.prisma.garantie.findFirst({
          where: {
            produitId: police.produitId,
            categorieActe: acte.categorieActe,
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;

    const montant =
      dto.montant ??
      (acte.montantPrescrit
        ? new Decimal(acte.montantPrescrit.toString())
            .mul(acte.quantite ?? 1)
            .toNumber()
        : 0);

    const donnees = {
      dossierSoinsId: dossier.id,
      adherentId: dossier.adherentId,
      beneficiaireId: dossier.beneficiaireId,
      policeId: dossier.policeId,
      montant: new Decimal(montant).toFixed(2),
      typeReclamation: categorie.typeReclamation as TypeReclamation,
    };

    if (!garantie) {
      // Règle « non couvert » : catégorie sans garantie dans le produit →
      // rejet E011 posé ici, sans appel au microservice d'adjudication (il
      // n'aurait aucune garantie à appliquer).
      return this.rejeterCategorieNonCouverte(ctx, acte.id, donnees);
    }

    const reclamation = await this.creerOuChargerReclamation(
      ctx,
      { acteDossierId: acte.id },
      { ...donnees, garantieId: garantie.id },
    );

    return this.verrouillerEtAdjuger(ctx, reclamation);
  }

  /**
   * Réclamation d'un acte dont la catégorie n'a pas de garantie dans le
   * produit : créée directement REJETE avec le code E011 (contrainte
   * `reclamations_garantie_ou_non_couverte`, garantie NULL). Idempotente :
   * une réclamation existant déjà pour l'acte → 409, comme `verrouillerEtAdjuger`.
   */
  private async rejeterCategorieNonCouverte(
    ctx: ContexteAppelant,
    acteDossierId: string,
    data: {
      dossierSoinsId: string;
      adherentId: string | null;
      beneficiaireId: string | null;
      policeId: string;
      montant: string;
      typeReclamation: TypeReclamation;
    },
  ) {
    const existante = await this.prisma.reclamation.findFirst({
      where: { acteDossierId, deletedAt: null },
    });
    if (existante) {
      throw new ConflictException(
        `Réclamation déjà « ${existante.statut} » — soumission ignorée (idempotence).`,
      );
    }

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const r = await tx.reclamation.create({
          data: {
            organisationId: ctx.organisationId,
            acteDossierId,
            ...data,
            garantieId: null,
            statut: 'REJETE',
            codesRejet: [CODE_REJET_CATEGORIE_NON_COUVERTE],
          },
        });
        await this.audit(tx, ctx.userId, 'CREATION_RECLAMATION', r.id, {
          acteDossierId,
          montant: data.montant,
          type: data.typeReclamation,
        });
        await this.audit(tx, ctx.userId, 'ADJUDICATION_REJETE', r.id, {
          montantRembourse: '0.00',
          codesRejet: [CODE_REJET_CATEGORIE_NON_COUVERTE],
          motif: 'Catégorie d’acte non couverte par le produit (aucune garantie).',
        });
        return r.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          'Réclamation déjà créée par une soumission concurrente.',
        );
      }
      throw e;
    }

    const reclamation = await this.chargerReclamation(ctx, id);
    return { reclamation, adjudication: null };
  }

  /**
   * Appelée par `PharmacyService.confirmerPaiementDispensation` — PAS par un
   * utilisateur ASSUREUR authentifié via ce module : c'est un point d'entrée
   * INTERNE (jamais exposé par `ClaimsController`), déclenché automatiquement
   * dès qu'une dispensation est payée, cohérent avec « une dispensation payée
   * = un remboursement réclamé, pas un flux séparé sans lien avec
   * l'adjudication ». `ctxAppelant` est construit directement par
   * `PharmacyService` (userId = l'utilisateur pharmacie ayant confirmé le
   * paiement, à des fins d'audit uniquement — l'autorisation métier a déjà eu
   * lieu côté pharmacy, `assertGestion` ne s'applique pas ici). Idempotente :
   * rejouer avec la même `dispensationId` retrouve la réclamation existante
   * (via l'index unique partiel `reclamations_dispensation_unique`) plutôt
   * que d'en créer une seconde — même mécanisme que `soumettre`.
   */
  async soumettreDepuisDispensation(
    ctxAppelant: { userId: string; organisationId: string },
    params: {
      dispensationId: string;
      dossierSoinsId: string;
      adherentId: string | null;
      beneficiaireId: string | null;
      policeId: string;
      garantieId: string;
      montant: string;
    },
  ) {
    const ctx: ContexteAppelant = { ...ctxAppelant, roleChain: [], adherentId: null, societeId: null };
    const reclamation = await this.creerOuChargerReclamation(
      ctx,
      { dispensationId: params.dispensationId },
      {
        dossierSoinsId: params.dossierSoinsId,
        adherentId: params.adherentId,
        beneficiaireId: params.beneficiaireId,
        policeId: params.policeId,
        garantieId: params.garantieId,
        montant: params.montant,
        typeReclamation: 'PHARMACIE',
      },
    );
    return this.verrouillerEtAdjuger(ctx, reclamation);
  }

  /**
   * Cœur partagé entre `soumettre` (acte établissement) et
   * `soumettreDepuisDispensation` (pharmacie) : s'assure qu'une réclamation
   * SOUMISE existe pour cette source (create-or-find, idempotent face à une
   * création concurrente via l'index unique partiel correspondant).
   */
  private async creerOuChargerReclamation(
    ctx: ContexteAppelant,
    source: SourceReclamation,
    data: {
      dossierSoinsId: string;
      adherentId: string | null;
      beneficiaireId: string | null;
      policeId: string;
      garantieId: string;
      montant: string;
      typeReclamation: TypeReclamation;
    },
  ) {
    const where =
      'acteDossierId' in source
        ? { acteDossierId: source.acteDossierId, deletedAt: null }
        : { dispensationId: source.dispensationId, deletedAt: null };

    let reclamation = await this.prisma.reclamation.findFirst({ where });

    if (!reclamation) {
      try {
        reclamation = await this.prisma.$transaction(async (tx) => {
          const r = await tx.reclamation.create({
            data: {
              organisationId: ctx.organisationId,
              dossierSoinsId: data.dossierSoinsId,
              ...('acteDossierId' in source
                ? { acteDossierId: source.acteDossierId }
                : { dispensationId: source.dispensationId }),
              adherentId: data.adherentId,
              beneficiaireId: data.beneficiaireId,
              policeId: data.policeId,
              garantieId: data.garantieId,
              montant: data.montant,
              typeReclamation: data.typeReclamation,
              statut: 'SOUMISE',
            },
          });
          await this.audit(tx, ctx.userId, 'CREATION_RECLAMATION', r.id, {
            ...source,
            montant: data.montant,
            type: data.typeReclamation,
          });
          return r;
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          // création concurrente : l'autre requête a gagné, on récupère sa ligne
          reclamation = await this.prisma.reclamation.findFirst({ where });
        } else {
          throw e;
        }
      }
    }

    if (!reclamation) {
      throw new ConflictException(
        'Impossible de récupérer la réclamation après une soumission concurrente.',
      );
    }
    return reclamation;
  }

  /**
   * Verrouille (compare-and-swap SOUMISE → EN_ADJUDICATION) puis adjuge —
   * refuse (409, idempotence) si la réclamation n'est plus à SOUMISE.
   */
  private async verrouillerEtAdjuger(
    ctx: ContexteAppelant,
    reclamation: { id: string; statut: string },
  ) {
    if (reclamation.statut !== 'SOUMISE') {
      throw new ConflictException(
        `Réclamation déjà « ${reclamation.statut} » — soumission ignorée (idempotence).`,
      );
    }

    const { count } = await this.prisma.reclamation.updateMany({
      where: { id: reclamation.id, statut: 'SOUMISE', deletedAt: null },
      data: { statut: 'EN_ADJUDICATION' },
    });
    if (count === 0) {
      throw new ConflictException(
        'Réclamation déjà verrouillée par une soumission concurrente.',
      );
    }

    await this.audit(
      this.prisma,
      ctx.userId,
      'SOUMISSION_RECLAMATION',
      reclamation.id,
      { de: 'SOUMISE', vers: 'EN_ADJUDICATION' },
    );

    return this.adjuger(ctx, reclamation.id);
  }

  /**
   * Appelle le microservice d'adjudication et applique la décision. En cas
   * d'échec, remet la réclamation à SOUMISE et lève une erreur HTTP explicite.
   */
  private async adjuger(ctx: ContexteAppelant, reclamationId: string) {
    let decision: DecisionAdjudication;
    try {
      decision = await this.adjudication.evaluer(reclamationId);
    } catch (err) {
      throw await this.traiterEchecAdjudication(ctx, reclamationId, err);
    }

    // succès : le microservice a déjà posé `reclamations.statut` = decision.decision
    // (il n'a que le grant UPDATE(statut)) ; NestJS complète `codes_rejet` + audit.
    await this.prisma.$transaction(async (tx) => {
      await tx.reclamation.update({
        where: { id: reclamationId },
        data: {
          statut: decision.decision,
          codesRejet: decision.codes_rejet ?? [],
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        `ADJUDICATION_${decision.decision}`,
        reclamationId,
        {
          montantRembourse: decision.montant_rembourse,
          codesRejet: decision.codes_rejet ?? [],
          plafondRestantApres: decision.plafond_restant_apres,
          dureeTraitementMs: decision.duree_traitement_ms,
        },
      );
    });

    const reclamation = await this.chargerReclamation(ctx, reclamationId);
    return { reclamation, adjudication: decision };
  }

  private async traiterEchecAdjudication(
    ctx: ContexteAppelant,
    reclamationId: string,
    err: unknown,
  ): Promise<HttpException> {
    const detail =
      err instanceof AdjudicationRefusError
        ? `HTTP ${err.statut} — ${err.corps}`
        : err instanceof Error
          ? err.message
          : String(err);

    // Le microservice a-t-il quand même abouti (réponse HTTP perdue après commit) ?
    const actuelle = await this.prisma.reclamation.findUnique({
      where: { id: reclamationId },
    });
    if (actuelle && actuelle.statut !== 'EN_ADJUDICATION') {
      await this.audit(
        this.prisma,
        ctx.userId,
        'ADJUDICATION_REPONSE_PERDUE',
        reclamationId,
        { erreur: detail, statutConstate: actuelle.statut },
      );
      return new ServiceUnavailableException(
        `Le calcul de la prise en charge n'a pas confirmé sa réponse, mais la réclamation est déjà « ${actuelle.statut} » : vérifiez le remboursement avant de relancer.`,
      );
    }

    // Échec franc : retour à SOUMISE pour une nouvelle tentative.
    const { count } = await this.prisma.reclamation.updateMany({
      where: { id: reclamationId, statut: 'EN_ADJUDICATION', deletedAt: null },
      data: { statut: 'SOUMISE', codesRejet: ['ADJ_ECHEC'] },
    });
    await this.audit(
      this.prisma,
      ctx.userId,
      'ECHEC_ADJUDICATION',
      reclamationId,
      { erreur: detail, remiseASoumise: count === 1 },
    );
    this.logger.error(
      `Adjudication réclamation ${reclamationId} : ${detail} — remise à SOUMISE (${count} ligne).`,
    );

    return err instanceof AdjudicationInjoignableError
      ? new ServiceUnavailableException(MESSAGES_INDISPONIBILITE.reclamation)
      : new BadGatewayException(MESSAGES_INDISPONIBILITE.reclamationErreur);
  }

  /**
   * Actes pour lesquels une réclamation PEUT être soumise (écran « Nouvelle
   * réclamation ») : actes de l'organisation réalisés (ou liquidés), pré-autorisation
   * ni en attente ni refusée, jamais facturés en tiers payant, sans réclamation —
   * exactement les conditions de `soumettre`. Les plus récents d'abord
   * (`LIMITE_ACTES_RECLAMABLES`) ; `recherche` filtre sur le nom, le prénom ou le
   * numéro de carte du patient. Réservé aux rôles qui peuvent soumettre.
   */
  async listerActesReclamables(user: AuthenticatedUser, recherche?: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const terme = recherche?.trim();
    const filtrePersonne = terme
      ? {
          OR: [
            { nom: { contains: terme, mode: 'insensitive' as const } },
            { prenom: { contains: terme, mode: 'insensitive' as const } },
            { numeroCarte: { contains: terme, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const actes = await this.prisma.acteDossier.findMany({
      where: {
        deletedAt: null,
        statut: { in: [...STATUTS_ACTE_RECLAMABLES] },
        statutPreautorisation: { notIn: [...STATUTS_PREAUTORISATION_NON_RECLAMABLES] },
        lignesFacturation: { none: {} },
        dossier: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          ...(filtrePersonne
            ? { OR: [{ adherent: filtrePersonne }, { beneficiaire: filtrePersonne }] }
            : {}),
        },
      },
      include: {
        dossier: {
          select: {
            id: true,
            etablissement: { select: { nom: true } },
            adherent: { select: { id: true, nom: true, prenom: true, numeroCarte: true } },
            beneficiaire: { select: { id: true, nom: true, prenom: true, numeroCarte: true } },
          },
        },
      },
      orderBy: [{ dateRealisation: 'desc' }, { datePrescription: 'desc' }],
      // marge pour les actes déjà réclamés, écartés ci-dessous
      take: LIMITE_ACTES_RECLAMABLES * 2,
    });

    // pas de relation Prisma réclamation → acte : exclusion par une 2e requête
    const dejaReclames = new Set(
      (
        await this.prisma.reclamation.findMany({
          where: { acteDossierId: { in: actes.map((a) => a.id) }, deletedAt: null },
          select: { acteDossierId: true },
        })
      ).map((r) => r.acteDossierId),
    );

    return actes
      .filter((a) => !dejaReclames.has(a.id))
      .slice(0, LIMITE_ACTES_RECLAMABLES)
      .map((a) => {
        const personne = a.dossier.adherent ?? a.dossier.beneficiaire;
        return {
          id: a.id,
          libelle: a.libelle,
          categorieActe: a.categorieActe,
          codeActe: a.codeActe,
          dateSoins: a.dateRealisation ?? a.datePrescription,
          montant: new Decimal(a.montantPrescrit?.toString() ?? '0')
            .mul(a.quantite ?? 1)
            .toFixed(2),
          dossierSoinsId: a.dossier.id,
          etablissement: a.dossier.etablissement?.nom ?? null,
          patient: personne
            ? {
                type: a.dossier.adherent ? ('ADHERENT' as const) : ('BENEFICIAIRE' as const),
                nom: personne.nom,
                prenom: personne.prenom,
                numeroCarte: personne.numeroCarte,
              }
            : null,
        };
      });
  }

  async listerReclamations(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    const ctx = await this.contexteAppelant(user);
    const mode = this.modeLecture(ctx);
    const scopeSociete =
      mode === 'SOCIETE' ? { adherentId: { in: await this.adherentIdsSociete(ctx) } } : {};
    // Couverture bénéficiaires (audit dashboard adhérent) : `adherentId`/
    // `beneficiaireId` sont mutuellement exclusifs sur `Reclamation` — une
    // réclamation ouverte pour un bénéficiaire n'a jamais `adherentId` renseigné.
    const scopeAdherent =
      mode === 'ADHERENT' && ctx.adherentId
        ? { OR: [{ adherentId: ctx.adherentId }, { beneficiaireId: { in: await this.beneficiaireIdsPropres(ctx.adherentId) } }] }
        : {};
    const reclamations = await this.prisma.reclamation.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...scopeAdherent,
        ...scopeSociete,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        remboursement: true,
        adherent: { select: { id: true, nom: true, prenom: true, numeroAdherent: true } },
        beneficiaire: { select: { id: true, nom: true, prenom: true } },
      },
    });
    return this.avecRoleRevue(reclamations);
  }

  async obtenirReclamation(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const mode = this.modeLecture(ctx);
    return this.chargerReclamation(ctx, id, mode);
  }

  /**
   * Traitement manuel d'une réclamation `REVUE_MANUELLE` (v1 §16.3). Réservé,
   * **selon le type de réclamation**, à `ASSUREUR_MEDECIN_CONSEIL` (contenu
   * médical) ou `ASSUREUR_EXPLOITATION` (autre) — `ASSUREUR_DIRECTION` peut
   * traiter les deux.
   *
   *  - `APPROUVE` → statut `AUTO_ADJUDIQUE` (validé pour remboursement) ; le
   *    remboursement est mis à jour si `montantAjuste` est fourni.
   *  - `REJETE`   → statut `REJETE`, remboursement à 0, code `REJET_MANUEL`.
   */
  async validerManuellement(
    user: AuthenticatedUser,
    id: string,
    dto: ValiderManuellementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const reclamation = await this.chargerReclamation(ctx, id);

    if (reclamation.statut !== 'REVUE_MANUELLE') {
      throw new ConflictException(
        `La réclamation n'est pas en revue manuelle (statut : ${reclamation.statut}).`,
      );
    }

    const roleRequis = reclamation.roleRevue;
    const autorise =
      ctx.roleChain.includes(roleRequis) ||
      ctx.roleChain.includes(ROLE_REVUE_SUPERVISION);
    if (!autorise) {
      throw new ForbiddenException(
        `La revue manuelle d'une réclamation « ${reclamation.typeReclamation} » est réservée à ${roleRequis} (ou ${ROLE_REVUE_SUPERVISION}).`,
      );
    }

    // Tarif proposé (ADR-008, lot 4) : une réclamation sur un acte non tarifable / à tarif en examen ne s'approuve pas
    // tant que le tarif n'est pas décidé ; le rejet reste possible.
    if (dto.decision === 'APPROUVE') {
      const codes = reclamation.codesRejet ?? [];
      if (codes.includes('E016') || codes.includes('E017')) {
        const tp = reclamation.acteDossierId
          ? await this.prisma.tarifPropose.findFirst({
              where: { acteDossierId: reclamation.acteDossierId, organisationId: ctx.organisationId, deletedAt: null },
              orderBy: { dateProposition: 'desc' },
              select: { statut: true },
            })
          : null;
        if (!tp || tp.statut === 'REFUSE') {
          throw new ConflictException(
            "Acte non tarifable : la réclamation attend un tarif proposé par l'établissement (comptable ou administratif) et sa décision.",
          );
        }
        if (tp.statut === 'PROPOSE') {
          throw new ConflictException("Tarif en cours d'examen : la réclamation ne peut pas être approuvée avant la décision sur le tarif proposé.");
        }
        if (dto.montantAjuste === undefined) {
          throw new ConflictException(
            'Le tarif proposé a été décidé : précisez le montant recalculé à rembourser (le montant provisoire enregistré n’est plus valable).',
          );
        }
      }
    }

    const statutFinal = dto.decision === 'APPROUVE' ? 'AUTO_ADJUDIQUE' : 'REJETE';
    const montantFinal =
      dto.decision === 'REJETE'
        ? '0.00'
        : dto.montantAjuste !== undefined
          ? new Decimal(dto.montantAjuste).toFixed(2)
          : (reclamation.remboursement?.montantRembourse?.toString() ?? '0.00');

    await this.prisma.$transaction(async (tx) => {
      await tx.reclamation.update({
        where: { id },
        data: {
          statut: statutFinal,
          codesRejet:
            dto.decision === 'REJETE'
              ? [...(reclamation.codesRejet ?? []), CODE_REJET_MANUEL]
              : (reclamation.codesRejet ?? []),
        },
      });
      if (reclamation.remboursement) {
        await tx.remboursement.update({
          where: { reclamationId: id },
          data: {
            montantRembourse: montantFinal,
            decision: `REVUE_MANUELLE_${dto.decision}`,
          },
        });
      }
      await this.audit(tx, ctx.userId, 'VALIDATION_MANUELLE_RECLAMATION', id, {
        decision: dto.decision,
        statutFinal,
        montantAjuste: dto.montantAjuste ?? null,
        montantFinal,
        motif: dto.motif,
        roleRequis,
        de: 'REVUE_MANUELLE',
      });
    });

    return this.chargerReclamation(ctx, id);
  }

  // --- Autorisation / helpers -------------------------------------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucune organisation.",
      );
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
      adherentId: profil.adherentId ?? null,
      societeId: profil.societeId ?? null,
    };
  }

  private assertGestion(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_CLAIMS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la soumission des réclamations est réservée aux rôles ASSUREUR habilités (direction, exploitation, informatique).',
      );
    }
  }

  /**
   * Fuite inter-société corrigée (audit filière société, PROMPT SOCIETE_AFFILIEE) :
   * `listerReclamations`/`obtenirReclamation` ne vérifiaient QUE `organisationId`
   * — tout compte authentifié de l'organisation (y compris SOCIETE_*) lisait les
   * réclamations de TOUTES les sociétés clientes. `reclamations` n'ayant pas de
   * colonne société/souscripteur, ce scoping-là reste à faire ; en attendant, la
   * lecture « organisation entière » est resserrée au personnel ASSUREUR habilité,
   * comme la RLS `reclamations_lecture` aurait dû l'être (voir prisma/sql/025).
   *
   * `reclamations` a en revanche bien une colonne `adherentId` : un compte
   * ADHERENT (audit dashboard adhérent) est donc autorisé à lire — mais SCOPÉ
   * STRICTEMENT sur ses propres réclamations (`chargerReclamation` mode
   * `'ADHERENT'`), jamais celles d'un autre adhérent de l'organisation.
   *
   * De même, une société cliente (SOCIETE_ASSUREE/ADMINISTRATION) peut lire
   * les réclamations de SES PROPRES adhérents (écran « Réclamations » société,
   * gestion collaborative) — scope dérivé via `adherentIdsSociete` (pas de
   * colonne société directe sur `reclamations`), mode `'SOCIETE'`.
   */
  private modeLecture(ctx: ContexteAppelant): ModeLecture {
    const estStaff = ctx.roleChain.some((code) =>
      (ROLES_LECTURE_CLAIMS as readonly string[]).includes(code),
    );
    if (estStaff) return 'STAFF';

    const estAdherent = ctx.roleChain.some((code) =>
      (ROLES_ADHERENT_CLAIMS as readonly string[]).includes(code),
    );
    if (estAdherent && ctx.adherentId) return 'ADHERENT';

    const estSociete = ctx.roleChain.some((code) =>
      (ROLES_SOCIETE_CLAIMS as readonly string[]).includes(code),
    );
    if (estSociete && ctx.societeId) return 'SOCIETE';

    throw new ForbiddenException(
      'Rôle insuffisant : la consultation des réclamations est réservée aux rôles ASSUREUR habilités (direction, exploitation, informatique, médecin-conseil), à l’adhérent concerné pour ses propres réclamations, ou à sa société pour ses propres adhérents.',
    );
  }

  /** Ids des adhérents de la propre société de l'appelant — dérive le scope
   * `'SOCIETE'` en l'absence de colonne société/souscripteur sur `reclamations`. */
  private async adherentIdsSociete(ctx: ContexteAppelant): Promise<string[]> {
    const adherents = await this.prisma.adherent.findMany({
      where: { souscripteurId: ctx.societeId ?? '__aucun__', organisationId: ctx.organisationId, deletedAt: null },
      select: { id: true },
    });
    return adherents.map((a) => a.id);
  }

  /** Ids des bénéficiaires de l'adhérent connecté — dérive la couverture
   * bénéficiaires du mode `'ADHERENT'` (`adherentId`/`beneficiaireId` sont
   * mutuellement exclusifs sur `Reclamation`). */
  private async beneficiaireIdsPropres(adherentId: string): Promise<string[]> {
    const beneficiaires = await this.prisma.beneficiaire.findMany({
      where: { adherentId, deletedAt: null },
      select: { id: true },
    });
    return beneficiaires.map((b) => b.id);
  }

  private async chargerReclamation(
    ctx: ContexteAppelant,
    id: string,
    mode: ModeLecture = 'STAFF',
  ) {
    const scopeSociete =
      mode === 'SOCIETE' ? { adherentId: { in: await this.adherentIdsSociete(ctx) } } : {};
    const scopeAdherent =
      mode === 'ADHERENT' && ctx.adherentId
        ? { OR: [{ adherentId: ctx.adherentId }, { beneficiaireId: { in: await this.beneficiaireIdsPropres(ctx.adherentId) } }] }
        : {};
    const reclamation = await this.prisma.reclamation.findFirst({
      where: {
        id,
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...scopeAdherent,
        ...scopeSociete,
      },
      include: {
        remboursement: true,
        adherent: { select: { id: true, nom: true, prenom: true, numeroAdherent: true } },
        beneficiaire: { select: { id: true, nom: true, prenom: true } },
      },
    });
    if (!reclamation) {
      throw new NotFoundException('Réclamation introuvable.');
    }
    return (await this.avecRoleRevue([reclamation]))[0];
  }

  /**
   * Rôle de revue manuelle de chaque réclamation, lu dans le référentiel
   * `categories_acte` (prisma/sql/067) depuis la catégorie de sa source : celle
   * de l'acte, ou PHARMACIE pour une dispensation. Exposé au web (`roleRevue`)
   * pour qu'il ne redéfinisse pas la règle.
   */
  private async avecRoleRevue<T extends { acteDossierId: string | null }>(
    reclamations: T[],
  ): Promise<(T & { roleRevue: string })[]> {
    const idsActes = [
      ...new Set(reclamations.map((r) => r.acteDossierId).filter((v): v is string => !!v)),
    ];
    const actes = idsActes.length
      ? await this.prisma.acteDossier.findMany({
          where: { id: { in: idsActes } },
          select: { id: true, categorieActe: true },
        })
      : [];
    const categorieParActe = new Map(actes.map((a) => [a.id, a.categorieActe]));
    const roleParCategorie = new Map(
      (await this.categoriesActe.lister()).map((c) => [c.code, c.roleRevue]),
    );
    return reclamations.map((r) => {
      const categorie = r.acteDossierId
        ? categorieParActe.get(r.acteDossierId)
        : CATEGORIE_ACTE_DISPENSATION;
      return {
        ...r,
        roleRevue: (categorie && roleParCategorie.get(categorie)) || ROLE_REVUE_FINANCIERE,
      };
    });
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'reclamations',
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
