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
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovisionnerCompteDto,
  AssocierFacturesPourPaiementDto,
  CreerCompteFinancierDto,
  PayerFactureDto,
} from './dto/payment.dto';
import {
  BUCKET_MOUVEMENTS_FINANCIERS,
  CATEGORIE_ACTE_PHARMACIE,
  ContexteAppelant,
  MIME_TYPES_PIECE_JOINTE_AUTORISES,
  ROLES_GESTION_COMPTES_FINANCIERS,
  ROLE_COMPTABLE_PAIEMENT_GROUPE,
  STATUT_FACTURE_MENSUELLE_GROUPABLE,
  TAILLE_MAX_PIECE_JOINTE_OCTETS,
} from './payment.types';

type Db = PrismaService | Prisma.TransactionClient;

/** Forme minimale d'un fichier téléversé (multer, mémoire) — même convention
 * que `ContestationService` (pas de dépendance à `@types/multer`), dupliquée
 * localement plutôt qu'importée d'un autre module (un module = un domaine). */
export interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * PaymentService — module `payment/` : regroupement de factures mensuelles
 * (établissement OU pharmacie) en un paiement programmé unique, et vue
 * d'ensemble globale ASSUREUR_COMPTABLE (toutes factures mensuelles des deux
 * domaines, tout statut — item 1 du prompt « étend les factures mensuelles »).
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly dureeUrlSignee = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      role: profil.role,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  /**
   * Vue d'ensemble en LECTURE seule (`listerFacturesPourComptableGlobal`) —
   * volontairement ouverte à `ctx.roleChain` (donc à ASSUREUR_COMPTABLE_ADJOINT
   * par héritage) : consultation globale des factures, aucun mouvement
   * d'argent. Ne PAS réutiliser pour une action qui modifie ou engage de
   * l'argent — voir `assertGestionComptesFinanciers` pour ce cas.
   */
  private assertComptable(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_PAIEMENT_GROUPE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
  }

  /**
   * Gestion des comptes financiers ET des paiements groupés — réservée
   * EXCLUSIVEMENT au rôle EXACT ASSUREUR_COMPTABLE. Vérifie `ctx.role` (valeur
   * PROPRE au profil), JAMAIS `ctx.roleChain` (qui remonte
   * ASSUREUR_COMPTABLE_ADJOINT vers son parent ASSUREUR_COMPTABLE) ni
   * `permissions.peutValider` (capacité générique sans rapport avec ce
   * périmètre précis). Les paiements groupés (`associerFacturesPourPaiement`,
   * `listerPaiementsGroupes`) utilisaient auparavant `assertComptable`
   * (roleChain, adjoint inclus) — exception volontaire refermée sur demande
   * explicite (audit du 2026-09-24, PROGRESSION.md) : plus aucune action
   * touchant à l'argent n'est accessible à l'adjoint.
   */
  private assertGestionComptesFinanciers(ctx: ContexteAppelant): void {
    if (!(ROLES_GESTION_COMPTES_FINANCIERS as readonly string[]).includes(ctx.role ?? '')) {
      throw new ForbiddenException(
        'Réservé exclusivement à ASSUREUR_COMPTABLE (jamais son adjoint).',
      );
    }
  }

  /**
   * Regroupe plusieurs factures mensuelles VALIDÉES POUR PAIEMENT
   * (`PROGRAMMEE_PAIEMENT`) du MÊME bénéficiaire (un seul établissement OU une
   * seule pharmacie, jamais mélangés) en un paiement programmé unique. Chaque
   * facture ne peut appartenir qu'à un seul groupe à la fois (index unique
   * partiel, prisma/sql/048).
   */
  async associerFacturesPourPaiement(user: AuthenticatedUser, dto: AssocierFacturesPourPaiementDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const ids = [...new Set(dto.factureMensuelleIds)];

    if (dto.beneficiaireType === 'ETABLISSEMENT') {
      const factures = await this.prisma.factureMensuelleEtablissement.findMany({
        where: { id: { in: ids }, organisationId: ctx.organisationId },
      });
      if (factures.length !== ids.length) {
        throw new NotFoundException("Une ou plusieurs factures d'établissement sont introuvables.");
      }
      const nonGroupables = factures.filter((f) => f.statut !== STATUT_FACTURE_MENSUELLE_GROUPABLE);
      if (nonGroupables.length > 0) {
        throw new ConflictException({
          message: "Toutes les factures doivent être validées pour paiement (PROGRAMMEE_PAIEMENT) avant d'être groupées.",
          factureIdsNonGroupables: nonGroupables.map((f) => f.id),
        });
      }
      const beneficiaireIds = new Set(factures.map((f) => f.etablissementId));
      if (beneficiaireIds.size > 1) {
        throw new BadRequestException('Toutes les factures doivent appartenir au même établissement.');
      }
      const dejaGroupees = await this.prisma.paiementGroupeFacture.findMany({
        where: { factureMensuelleEtablissementId: { in: ids } },
      });
      if (dejaGroupees.length > 0) {
        throw new ConflictException('Une ou plusieurs factures appartiennent déjà à un paiement groupé.');
      }

      const beneficiaireId = [...beneficiaireIds][0];
      const montantTotal = factures.reduce(
        (acc, f) => acc.add(new Decimal(f.montantTotal.toString())),
        new Decimal(0),
      );

      const groupe = await this.prisma.$transaction(async (tx) => {
        const g = await tx.paiementGroupe.create({
          data: {
            organisationId: ctx.organisationId,
            beneficiaireType: 'ETABLISSEMENT',
            beneficiaireId,
            montantTotal: montantTotal.toFixed(2),
          },
        });
        await tx.paiementGroupeFacture.createMany({
          data: ids.map((id) => ({ paiementGroupeId: g.id, factureMensuelleEtablissementId: id })),
        });
        await this.audit(tx, ctx.userId, 'ASSOCIATION_PAIEMENT_GROUPE', g.id, {
          beneficiaireType: 'ETABLISSEMENT',
          beneficiaireId,
          factureMensuelleIds: ids,
          montantTotal: montantTotal.toFixed(2),
        });
        return g;
      });

      return { ...groupe, montantTotal: groupe.montantTotal.toFixed(2), nbFactures: ids.length };
    }

    // beneficiaireType === 'PHARMACIE' — même logique, table pharmacie.
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { id: { in: ids }, organisationId: ctx.organisationId },
    });
    if (factures.length !== ids.length) {
      throw new NotFoundException('Une ou plusieurs factures de pharmacie sont introuvables.');
    }
    const nonGroupables = factures.filter((f) => f.statut !== STATUT_FACTURE_MENSUELLE_GROUPABLE);
    if (nonGroupables.length > 0) {
      throw new ConflictException({
        message: "Toutes les factures doivent être validées pour paiement (PROGRAMMEE_PAIEMENT) avant d'être groupées.",
        factureIdsNonGroupables: nonGroupables.map((f) => f.id),
      });
    }
    const beneficiaireIds = new Set(factures.map((f) => f.pharmacieId));
    if (beneficiaireIds.size > 1) {
      throw new BadRequestException('Toutes les factures doivent appartenir à la même pharmacie.');
    }
    const dejaGroupees = await this.prisma.paiementGroupeFacture.findMany({
      where: { factureMensuellePharmacieId: { in: ids } },
    });
    if (dejaGroupees.length > 0) {
      throw new ConflictException('Une ou plusieurs factures appartiennent déjà à un paiement groupé.');
    }

    const beneficiaireId = [...beneficiaireIds][0];
    const montantTotal = factures.reduce(
      (acc, f) => acc.add(new Decimal(f.montantTotal.toString())),
      new Decimal(0),
    );

    const groupe = await this.prisma.$transaction(async (tx) => {
      const g = await tx.paiementGroupe.create({
        data: {
          organisationId: ctx.organisationId,
          beneficiaireType: 'PHARMACIE',
          beneficiaireId,
          montantTotal: montantTotal.toFixed(2),
        },
      });
      await tx.paiementGroupeFacture.createMany({
        data: ids.map((id) => ({ paiementGroupeId: g.id, factureMensuellePharmacieId: id })),
      });
      await this.audit(tx, ctx.userId, 'ASSOCIATION_PAIEMENT_GROUPE', g.id, {
        beneficiaireType: 'PHARMACIE',
        beneficiaireId,
        factureMensuelleIds: ids,
        montantTotal: montantTotal.toFixed(2),
      });
      return g;
    });

    return { ...groupe, montantTotal: groupe.montantTotal.toFixed(2), nbFactures: ids.length };
  }

  /** Liste des paiements groupés — réservé au rôle EXACT ASSUREUR_COMPTABLE (jamais l'adjoint). */
  async listerPaiementsGroupes(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const groupes = await this.prisma.paiementGroupe.findMany({
      where: { organisationId: ctx.organisationId },
      include: { factures: true },
      orderBy: { createdAt: 'desc' },
    });

    const etablissementIds = groupes.filter((g) => g.beneficiaireType === 'ETABLISSEMENT').map((g) => g.beneficiaireId);
    const pharmacieIds = groupes.filter((g) => g.beneficiaireType === 'PHARMACIE').map((g) => g.beneficiaireId);
    const [etablissements, pharmacies] = await Promise.all([
      etablissementIds.length
        ? this.prisma.etablissementSante.findMany({ where: { id: { in: etablissementIds } }, select: { id: true, nom: true } })
        : Promise.resolve([]),
      pharmacieIds.length
        ? this.prisma.pharmacie.findMany({ where: { id: { in: pharmacieIds } }, select: { id: true, nom: true } })
        : Promise.resolve([]),
    ]);
    const nomEtablissement = new Map(etablissements.map((e) => [e.id, e.nom]));
    const nomPharmacie = new Map(pharmacies.map((p) => [p.id, p.nom]));

    return groupes.map((g) => ({
      id: g.id,
      beneficiaireType: g.beneficiaireType,
      beneficiaireNom:
        g.beneficiaireType === 'ETABLISSEMENT'
          ? (nomEtablissement.get(g.beneficiaireId) ?? '—')
          : (nomPharmacie.get(g.beneficiaireId) ?? '—'),
      montantTotal: g.montantTotal.toFixed(2),
      nbFactures: g.factures.length,
      dateProgrammee: g.dateProgrammee,
      datePaiement: g.datePaiement,
      paiementProgrammeDate: g.paiementProgrammeDate,
      statut: g.statut,
    }));
  }

  // =====================================================================
  // Paiement RÉEL des factures mensuelles (établissement/pharmacie) et des
  // paiements groupés — point de convergence le plus sensible : jamais de
  // statut PAYEE sans un débit réel, exact, tracé (mêmes exigences de
  // précision `Decimal` que le microservice Java d'adjudication). Remplace
  // les anciens `marquerFactureMensuelle(Etablissement)Payee`/
  // `marquerPaiementGroupePaye` (symboliques, ne débitaient jamais rien) —
  // retirés pour ne laisser aucun chemin de paiement fictif actif.
  // =====================================================================

  private readonly STATUTS_FACTURE_PAYABLE = ['PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE'];
  private readonly STATUTS_GROUPE_PAYABLE = ['PROGRAMME', 'PAIEMENT_PROGRAMME'];

  /**
   * Paie une facture mensuelle individuelle OU un paiement groupé — exactement
   * l'un des deux. Débite le compte choisi et crée le mouvement financier
   * correspondant dans LA MÊME transaction, sauf si `dateProgrammee` est une
   * date future : dans ce cas, RIEN n'est débité — la facture/le groupe passe
   * au statut PAIEMENT_PROGRAMME, et un nouvel appel à `payerFacture` (sans
   * date future) confirme et exécute le débit réel.
   */
  async payerFacture(user: AuthenticatedUser, dto: PayerFactureDto) {
    const ctx = await this.contexteAppelant(user);
    // Débite un compte financier — même périmètre EXCLUSIF que les comptes/
    // mouvements financiers (rôle EXACT, jamais l'adjoint), PAS le périmètre
    // plus large de validerPourPaiement/associerFacturesPourPaiement : choisir
    // le compte à débiter est une opération de trésorerie, pas une étape du
    // circuit de facturation.
    this.assertGestionComptesFinanciers(ctx);

    if (!!dto.factureMensuelleId === !!dto.paiementGroupeId) {
      throw new BadRequestException('Fournir exactement un identifiant : factureMensuelleId OU paiementGroupeId.');
    }

    let dateProgrammee: Date | null = null;
    if (dto.dateProgrammee) {
      const d = new Date(dto.dateProgrammee);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        throw new BadRequestException('dateProgrammee doit être une date valide, strictement dans le futur.');
      }
      dateProgrammee = d;
    }

    const compte = await this.prisma.compteFinancier.findFirst({
      where: { id: dto.compteId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!compte) {
      throw new NotFoundException('Compte financier introuvable.');
    }

    const preuvePaiement = dto.preuvePaiement ?? [];

    if (dto.paiementGroupeId) {
      return this.payerPaiementGroupe(ctx, dto.paiementGroupeId, compte, dateProgrammee, dto.montant, preuvePaiement);
    }
    return this.payerFactureIndividuelle(ctx, dto.factureMensuelleId!, compte, dateProgrammee, dto.montant, preuvePaiement);
  }

  private async payerFactureIndividuelle(
    ctx: ContexteAppelant,
    factureMensuelleId: string,
    compte: { id: string; nom: string; soldeActuel: Prisma.Decimal },
    dateProgrammee: Date | null,
    montantDemande: number | undefined,
    preuvePaiement: string[],
  ) {
    const etab = await this.prisma.factureMensuelleEtablissement.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: { etablissement: { select: { nom: true } } },
    });
    const pharma = etab
      ? null
      : await this.prisma.factureMensuellePharmacie.findFirst({
          where: { id: factureMensuelleId, organisationId: ctx.organisationId },
          include: { pharmacie: { select: { nom: true } } },
        });
    if (!etab && !pharma) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }
    const estEtablissement = !!etab;
    const facture = (etab ?? pharma)!;
    const nomBeneficiaire = estEtablissement ? etab!.etablissement.nom : pharma!.pharmacie.nom;
    const tableCible = estEtablissement ? 'factures_mensuelles_etablissement' : 'factures_mensuelles_pharmacie';
    const auditAction = estEtablissement ? 'PAIEMENT_FACTURE_MENSUELLE_ETABLISSEMENT' : 'PAIEMENT_FACTURE_MENSUELLE';

    if (!this.STATUTS_FACTURE_PAYABLE.includes(facture.statut)) {
      throw new ConflictException(
        `Cette facture doit d'abord être validée pour paiement (statut actuel : ${facture.statut}).`,
      );
    }

    const groupee = await this.prisma.paiementGroupeFacture.findFirst({
      where: estEtablissement
        ? { factureMensuelleEtablissementId: factureMensuelleId }
        : { factureMensuellePharmacieId: factureMensuelleId },
    });
    if (groupee) {
      throw new ConflictException(
        'Cette facture appartient à un paiement groupé — payez le groupe plutôt que la facture individuellement.',
      );
    }

    const montantTotal = new Decimal(facture.montantTotal.toString());
    const montantDejaPaye = new Decimal(facture.montantPaye.toString());
    const montantRestant = montantTotal.sub(montantDejaPaye);
    const montant = montantDemande !== undefined ? new Decimal(montantDemande) : montantRestant;

    if (montant.gt(montantRestant)) {
      throw new BadRequestException(
        `Le montant (${montant.toFixed(2)} F) dépasse le solde restant dû (${montantRestant.toFixed(2)} F).`,
      );
    }

    if (dateProgrammee) {
      const maj = await this.prisma.$transaction(async (tx) => {
        const data = {
          statut: 'PAIEMENT_PROGRAMME',
          paiementProgrammeCompteId: compte.id,
          paiementProgrammeMontant: montant.toFixed(2),
          paiementProgrammePreuves: preuvePaiement,
          paiementProgrammeDate: dateProgrammee,
        };
        const f = estEtablissement
          ? await tx.factureMensuelleEtablissement.update({ where: { id: factureMensuelleId }, data })
          : await tx.factureMensuellePharmacie.update({ where: { id: factureMensuelleId }, data });
        await this.audit(
          tx,
          ctx.userId,
          `PROGRAMMATION_${auditAction}`,
          f.id,
          { compteId: compte.id, montant: montant.toFixed(2), dateProgrammee, preuvePaiement },
          tableCible,
        );
        return f;
      });
      return {
        ...maj,
        montantTotal: maj.montantTotal.toFixed(2),
        montantPaye: maj.montantPaye.toFixed(2),
        montantRestant: montantRestant.toFixed(2),
      };
    }

    const soldeCompte = new Decimal(compte.soldeActuel.toString());
    if (soldeCompte.lt(montant)) {
      throw new ConflictException(
        `Solde insuffisant sur le compte « ${compte.nom} » (${soldeCompte.toFixed(2)} F) pour payer ${montant.toFixed(2)} F.`,
      );
    }

    const nouveauMontantPaye = montantDejaPaye.add(montant);
    const complet = nouveauMontantPaye.gte(montantTotal);
    const nouveauStatut = complet ? 'PAYEE' : 'PARTIELLEMENT_REGLEE';
    const maintenant = new Date();

    const resultat = await this.prisma.$transaction(async (tx) => {
      await tx.compteFinancier.update({
        where: { id: compte.id },
        data: { soldeActuel: { decrement: montant.toFixed(2) } },
      });
      const data: Prisma.FactureMensuelleEtablissementUpdateInput & Prisma.FactureMensuellePharmacieUpdateInput = {
        montantPaye: nouveauMontantPaye.toFixed(2),
        statut: nouveauStatut,
        paiementProgrammeCompteId: null,
        paiementProgrammeMontant: null,
        paiementProgrammePreuves: [],
        paiementProgrammeDate: null,
        ...(complet ? { datePaiement: maintenant } : {}),
      };
      const f = estEtablissement
        ? await tx.factureMensuelleEtablissement.update({ where: { id: factureMensuelleId }, data })
        : await tx.factureMensuellePharmacie.update({ where: { id: factureMensuelleId }, data });
      await tx.mouvementFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          compteSourceId: compte.id,
          compteDestinationId: null,
          type: 'PAIEMENT_FACTURE',
          montant: montant.toFixed(2),
          description: `Paiement facture mensuelle ${estEtablissement ? 'établissement' : 'pharmacie'} — ${nomBeneficiaire}`,
          pieceJointeUrl: null,
          effectueParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        auditAction,
        f.id,
        { compteId: compte.id, montant: montant.toFixed(2), preuvePaiement, complet },
        tableCible,
      );
      return f;
    });

    return {
      ...resultat,
      montantTotal: resultat.montantTotal.toFixed(2),
      montantPaye: resultat.montantPaye.toFixed(2),
      montantRestant: montantTotal.sub(nouveauMontantPaye).toFixed(2),
    };
  }

  private async payerPaiementGroupe(
    ctx: ContexteAppelant,
    paiementGroupeId: string,
    compte: { id: string; nom: string; soldeActuel: Prisma.Decimal },
    dateProgrammee: Date | null,
    montantDemande: number | undefined,
    preuvePaiement: string[],
  ) {
    const groupe = await this.prisma.paiementGroupe.findFirst({
      where: { id: paiementGroupeId, organisationId: ctx.organisationId },
      include: {
        factures: {
          include: { factureMensuelleEtablissement: true, factureMensuellePharmacie: true },
        },
      },
    });
    if (!groupe) {
      throw new NotFoundException('Paiement groupé introuvable.');
    }
    if (!this.STATUTS_GROUPE_PAYABLE.includes(groupe.statut)) {
      throw new ConflictException(`Ce paiement groupé est déjà ${groupe.statut}.`);
    }

    const montantTotal = new Decimal(groupe.montantTotal.toString());
    const montant = montantDemande !== undefined ? new Decimal(montantDemande) : montantTotal;
    if (!montant.eq(montantTotal)) {
      throw new BadRequestException(
        `Le paiement d'un groupe est toujours intégral — le montant doit égaler le montant total du groupe (${montantTotal.toFixed(2)} F).`,
      );
    }

    if (dateProgrammee) {
      const maj = await this.prisma.$transaction(async (tx) => {
        const g = await tx.paiementGroupe.update({
          where: { id: paiementGroupeId },
          data: {
            statut: 'PAIEMENT_PROGRAMME',
            paiementProgrammeCompteId: compte.id,
            paiementProgrammePreuves: preuvePaiement,
            paiementProgrammeDate: dateProgrammee,
          },
        });
        await this.audit(
          tx,
          ctx.userId,
          'PROGRAMMATION_PAIEMENT_GROUPE',
          g.id,
          { compteId: compte.id, montant: montant.toFixed(2), dateProgrammee, preuvePaiement },
          'paiements_groupes',
        );
        return g;
      });
      return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
    }

    const soldeCompte = new Decimal(compte.soldeActuel.toString());
    if (soldeCompte.lt(montant)) {
      throw new ConflictException(
        `Solde insuffisant sur le compte « ${compte.nom} » (${soldeCompte.toFixed(2)} F) pour payer ${montant.toFixed(2)} F.`,
      );
    }

    const [etablissements, pharmacies] = await Promise.all([
      groupe.beneficiaireType === 'ETABLISSEMENT'
        ? this.prisma.etablissementSante.findMany({ where: { id: groupe.beneficiaireId }, select: { id: true, nom: true } })
        : Promise.resolve([]),
      groupe.beneficiaireType === 'PHARMACIE'
        ? this.prisma.pharmacie.findMany({ where: { id: groupe.beneficiaireId }, select: { id: true, nom: true } })
        : Promise.resolve([]),
    ]);
    const nomBeneficiaire = etablissements[0]?.nom ?? pharmacies[0]?.nom ?? '—';

    const maintenant = new Date();

    const maj = await this.prisma.$transaction(async (tx) => {
      await tx.compteFinancier.update({
        where: { id: compte.id },
        data: { soldeActuel: { decrement: montant.toFixed(2) } },
      });
      for (const pgf of groupe.factures) {
        if (pgf.factureMensuelleEtablissementId && pgf.factureMensuelleEtablissement) {
          await tx.factureMensuelleEtablissement.update({
            where: { id: pgf.factureMensuelleEtablissementId },
            data: {
              statut: 'PAYEE',
              datePaiement: maintenant,
              montantPaye: pgf.factureMensuelleEtablissement.montantTotal,
              paiementProgrammeCompteId: null,
              paiementProgrammeMontant: null,
              paiementProgrammePreuves: [],
              paiementProgrammeDate: null,
            },
          });
        } else if (pgf.factureMensuellePharmacieId && pgf.factureMensuellePharmacie) {
          await tx.factureMensuellePharmacie.update({
            where: { id: pgf.factureMensuellePharmacieId },
            data: {
              statut: 'PAYEE',
              datePaiement: maintenant,
              montantPaye: pgf.factureMensuellePharmacie.montantTotal,
              paiementProgrammeCompteId: null,
              paiementProgrammeMontant: null,
              paiementProgrammePreuves: [],
              paiementProgrammeDate: null,
            },
          });
        }
      }
      const g = await tx.paiementGroupe.update({
        where: { id: paiementGroupeId },
        data: {
          statut: 'PAYE',
          datePaiement: maintenant,
          paiementProgrammeCompteId: null,
          paiementProgrammePreuves: [],
          paiementProgrammeDate: null,
        },
      });
      await tx.mouvementFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          compteSourceId: compte.id,
          compteDestinationId: null,
          type: 'PAIEMENT_FACTURE',
          montant: montant.toFixed(2),
          description: `Paiement groupé — ${nomBeneficiaire} (${groupe.factures.length} facture(s))`,
          pieceJointeUrl: null,
          effectueParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'PAIEMENT_PAIEMENT_GROUPE',
        g.id,
        { compteId: compte.id, montant: montant.toFixed(2), preuvePaiement, nbFactures: groupe.factures.length },
        'paiements_groupes',
      );
      return g;
    });

    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  /**
   * Vue d'ensemble globale ASSUREUR_COMPTABLE (item 1 : accès en lecture à
   * TOUTES les factures mensuelles, établissement ET pharmacie, tout statut,
   * organisation entière) — dénormalisée pour alimenter l'écran à filtres
   * multicritères et le diagramme de consommation (item 5) : chaque facture
   * porte les listes DISTINCTES de sociétés/patients/catégories d'actes de ses
   * lignes, pour un filtrage 100% client-side (même convention que
   * `MesFacturesEcran`).
   */
  async listerFacturesPourComptableGlobal(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertComptable(ctx);

    const [facturesEtab, facturesPharma] = await Promise.all([
      this.prisma.factureMensuelleEtablissement.findMany({
        where: { organisationId: ctx.organisationId },
        include: {
          etablissement: { select: { nom: true } },
          lignes: {
            include: {
              acteDossier: {
                select: {
                  categorieActe: true,
                  dossier: {
                    select: {
                      police: { select: { souscripteur: { select: { nom: true } } } },
                      adherent: { select: { nom: true, prenom: true } },
                      beneficiaire: { select: { nom: true, prenom: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { periode: 'desc' },
      }),
      this.prisma.factureMensuellePharmacie.findMany({
        where: { organisationId: ctx.organisationId },
        include: {
          pharmacie: { select: { nom: true } },
          lignes: {
            include: {
              ligneOrdonnance: {
                select: {
                  ordonnance: {
                    select: {
                      dossier: {
                        select: {
                          police: { select: { souscripteur: { select: { nom: true } } } },
                          adherent: { select: { nom: true, prenom: true } },
                          beneficiaire: { select: { nom: true, prenom: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { periode: 'desc' },
      }),
    ]);

    const nomPatient = (adherent: { nom: string; prenom: string } | null, beneficiaire: { nom: string; prenom: string } | null) =>
      adherent ? `${adherent.prenom} ${adherent.nom}` : beneficiaire ? `${beneficiaire.prenom} ${beneficiaire.nom}` : '—';

    const uniques = (valeurs: string[]) => [...new Set(valeurs)];

    const listeEtab = facturesEtab.map((f) => {
      const societes = uniques(f.lignes.map((l) => l.acteDossier.dossier.police.souscripteur.nom));
      const patients = uniques(
        f.lignes.map((l) => nomPatient(l.acteDossier.dossier.adherent, l.acteDossier.dossier.beneficiaire)),
      );
      const categoriesActe = uniques(f.lignes.map((l) => l.acteDossier.categorieActe));
      return {
        id: f.id,
        beneficiaireType: 'ETABLISSEMENT' as const,
        beneficiaireNom: f.etablissement.nom,
        periode: f.periode,
        statut: f.statut,
        montantTotal: f.montantTotal.toFixed(2),
        montantPaye: f.montantPaye.toFixed(2),
        montantRestant: new Decimal(f.montantTotal.toString()).sub(new Decimal(f.montantPaye.toString())).toFixed(2),
        paiementProgrammeDate: f.paiementProgrammeDate,
        nbLignesReportees: f.nbLignesReportees,
        dateSoumission: f.dateSoumission,
        dateVerification: f.dateVerification,
        dateProgrammation: f.dateProgrammation,
        datePaiement: f.datePaiement,
        societes,
        patients,
        categoriesActe,
      };
    });

    const listePharma = facturesPharma.map((f) => {
      const dossiers = f.lignes.map((l) => l.ligneOrdonnance.ordonnance.dossier);
      const societes = uniques(dossiers.map((d) => d.police.souscripteur.nom));
      const patients = uniques(dossiers.map((d) => nomPatient(d.adherent, d.beneficiaire)));
      return {
        id: f.id,
        beneficiaireType: 'PHARMACIE' as const,
        beneficiaireNom: f.pharmacie.nom,
        periode: f.periode,
        statut: f.statut,
        montantTotal: f.montantTotal.toFixed(2),
        montantPaye: f.montantPaye.toFixed(2),
        montantRestant: new Decimal(f.montantTotal.toString()).sub(new Decimal(f.montantPaye.toString())).toFixed(2),
        paiementProgrammeDate: f.paiementProgrammeDate,
        nbLignesReportees: f.nbLignesReportees,
        dateSoumission: f.dateSoumission,
        dateVerification: f.dateValidation,
        dateProgrammation: f.dateProgrammation,
        datePaiement: f.datePaiement,
        societes,
        patients,
        categoriesActe: [CATEGORIE_ACTE_PHARMACIE],
      };
    });

    return [...listeEtab, ...listePharma].sort(
      (a, b) => new Date(b.periode).getTime() - new Date(a.periode).getTime(),
    );
  }

  // =====================================================================
  // Comptes financiers de l'assureur (trésorerie interne) — réservé
  // EXCLUSIVEMENT au rôle EXACT ASSUREUR_COMPTABLE, jamais son adjoint.
  // =====================================================================

  /** Liste des comptes financiers de l'organisation, solde à jour. */
  async listerComptesFinanciers(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const comptes = await this.prisma.compteFinancier.findMany({
      where: { organisationId: ctx.organisationId, deletedAt: null },
      include: { creePar: { select: { role: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return comptes.map((c) => ({
      id: c.id,
      type: c.type,
      nom: c.nom,
      banqueNom: c.banqueNom,
      numeroCompte: c.numeroCompte,
      soldeActuel: c.soldeActuel.toFixed(2),
      creePar: c.creePar.role,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /** Crée un compte financier avec son solde de départ — journalisé via log_audit(). */
  async creerCompteFinancier(user: AuthenticatedUser, dto: CreerCompteFinancierDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const fondsInitial = new Decimal(dto.fondsInitial);

    const compte = await this.prisma.$transaction(async (tx) => {
      const c = await tx.compteFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          type: dto.type,
          nom: dto.nom,
          banqueNom: dto.banqueNom ?? null,
          numeroCompte: dto.numeroCompte ?? null,
          soldeActuel: fondsInitial.toFixed(2),
          creeParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_COMPTE_FINANCIER',
        c.id,
        { type: dto.type, nom: dto.nom, fondsInitial: fondsInitial.toFixed(2) },
        'comptes_financiers',
      );
      return c;
    });

    return { ...compte, soldeActuel: compte.soldeActuel.toFixed(2) };
  }

  /**
   * Approvisionne un compte — augmente son solde et trace la source. Si
   * `source === 'AUTRE_COMPTE'`, débite le compte source dans LA MÊME
   * transaction (jamais d'argent créé de nulle part sans trace) : les deux
   * mouvements réussissent ou échouent ensemble.
   */
  async approvisionnerCompte(user: AuthenticatedUser, compteId: string, dto: ApprovisionnerCompteDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const compte = await this.prisma.compteFinancier.findFirst({
      where: { id: compteId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!compte) {
      throw new NotFoundException('Compte financier introuvable.');
    }

    const montant = new Decimal(dto.montant);

    let compteSource: { id: string; soldeActuel: Prisma.Decimal } | null = null;
    if (dto.source === 'AUTRE_COMPTE') {
      if (!dto.compteSourceId) {
        throw new BadRequestException(
          "compteSourceId est requis lorsque la source est 'AUTRE_COMPTE'.",
        );
      }
      if (dto.compteSourceId === compteId) {
        throw new BadRequestException("Un compte ne peut pas s'approvisionner depuis lui-même.");
      }
      compteSource = await this.prisma.compteFinancier.findFirst({
        where: { id: dto.compteSourceId, organisationId: ctx.organisationId, deletedAt: null },
        select: { id: true, soldeActuel: true },
      });
      if (!compteSource) {
        throw new NotFoundException('Compte source introuvable.');
      }
      if (new Decimal(compteSource.soldeActuel.toString()).lt(montant)) {
        throw new ConflictException(
          `Solde insuffisant sur le compte source (${new Decimal(compteSource.soldeActuel.toString()).toFixed(2)} F) pour débiter ${montant.toFixed(2)} F.`,
        );
      }
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const c = await tx.compteFinancier.update({
        where: { id: compteId },
        data: { soldeActuel: { increment: montant.toFixed(2) } },
      });
      if (compteSource) {
        await tx.compteFinancier.update({
          where: { id: compteSource.id },
          data: { soldeActuel: { decrement: montant.toFixed(2) } },
        });
      }
      await tx.mouvementFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          compteSourceId: compteSource?.id ?? null,
          compteDestinationId: compteId,
          type: 'APPROVISIONNEMENT',
          montant: montant.toFixed(2),
          description:
            dto.source === 'AUTRE_COMPTE'
              ? `Approvisionnement depuis le compte « ${compteSource?.id ?? '—'} ».`
              : (dto.piecesJustificatives ?? []).join(', ') || 'Approvisionnement externe.',
          pieceJointeUrl: null,
          effectueParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'APPROVISIONNEMENT_COMPTE_FINANCIER',
        c.id,
        {
          montant: montant.toFixed(2),
          source: dto.source,
          compteSourceId: compteSource?.id ?? null,
          piecesJustificatives: dto.piecesJustificatives ?? [],
        },
        'comptes_financiers',
      );
      return c;
    });

    return { ...maj, soldeActuel: maj.soldeActuel.toFixed(2) };
  }

  // --- Mouvements entre comptes + dépenses courantes -----------------------

  /**
   * Historique des mouvements de l'organisation, plus récents d'abord — le
   * filtrage (compte, type, période, montant) est fait côté écran, même
   * convention que `listerFacturesPourComptableGlobal` (données dénormalisées,
   * filtrage 100% client-side).
   */
  async listerMouvementsFinanciers(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const mouvements = await this.prisma.mouvementFinancier.findMany({
      where: { organisationId: ctx.organisationId },
      include: {
        compteSource: { select: { id: true, nom: true } },
        compteDestination: { select: { id: true, nom: true } },
        effectuePar: { select: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return mouvements.map((m) => ({
      id: m.id,
      type: m.type,
      montant: m.montant.toFixed(2),
      description: m.description,
      aUnePieceJointe: m.pieceJointeUrl !== null,
      compteSource: m.compteSource ? { id: m.compteSource.id, nom: m.compteSource.nom } : null,
      compteDestination: m.compteDestination ? { id: m.compteDestination.id, nom: m.compteDestination.nom } : null,
      effectuePar: m.effectuePar.role,
      createdAt: m.createdAt,
    }));
  }

  /** URL signée (durée limitée) de la pièce jointe d'un mouvement — jamais d'URL publique. */
  async obtenirUrlPieceJointeMouvement(user: AuthenticatedUser, mouvementId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    const mouvement = await this.prisma.mouvementFinancier.findFirst({
      where: { id: mouvementId, organisationId: ctx.organisationId },
    });
    if (!mouvement) {
      throw new NotFoundException('Mouvement introuvable.');
    }
    if (!mouvement.pieceJointeUrl) {
      throw new NotFoundException("Ce mouvement n'a pas de pièce jointe.");
    }
    const url = await this.signerPieceJointe(mouvement.pieceJointeUrl);
    return { url, expiresIn: this.dureeUrlSignee };
  }

  /**
   * Transfert entre deux comptes financiers de l'organisation — débite la
   * source et crédite la destination dans LA MÊME transaction (jamais l'un
   * sans l'autre), refuse si le solde source est insuffisant.
   */
  async transfererEntreComptes(
    user: AuthenticatedUser,
    compteSourceId: string,
    compteDestinationId: string,
    montantBrut: string,
    description: string | undefined,
    pieceJointe: FichierTeleverse | null,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    this.assertUuid(compteSourceId, 'compteSourceId');
    this.assertUuid(compteDestinationId, 'compteDestinationId');
    if (compteSourceId === compteDestinationId) {
      throw new BadRequestException('Le compte source et le compte destination doivent être différents.');
    }
    const montant = this.parserMontant(montantBrut);

    const [source, destination] = await Promise.all([
      this.prisma.compteFinancier.findFirst({
        where: { id: compteSourceId, organisationId: ctx.organisationId, deletedAt: null },
      }),
      this.prisma.compteFinancier.findFirst({
        where: { id: compteDestinationId, organisationId: ctx.organisationId, deletedAt: null },
      }),
    ]);
    if (!source) throw new NotFoundException('Compte source introuvable.');
    if (!destination) throw new NotFoundException('Compte destination introuvable.');

    const soldeSource = new Decimal(source.soldeActuel.toString());
    if (soldeSource.lt(montant)) {
      throw new ConflictException(
        `Solde insuffisant sur le compte source « ${source.nom} » (${soldeSource.toFixed(2)} F) pour transférer ${montant.toFixed(2)} F.`,
      );
    }

    const pieceJointeUrl = pieceJointe ? await this.televerserPieceJointe(ctx.organisationId, pieceJointe) : null;
    const descriptionFinale = description?.trim() || `Transfert de « ${source.nom} » vers « ${destination.nom} ».`;

    const mouvement = await this.prisma.$transaction(async (tx) => {
      await tx.compteFinancier.update({
        where: { id: compteSourceId },
        data: { soldeActuel: { decrement: montant.toFixed(2) } },
      });
      await tx.compteFinancier.update({
        where: { id: compteDestinationId },
        data: { soldeActuel: { increment: montant.toFixed(2) } },
      });
      const m = await tx.mouvementFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          compteSourceId,
          compteDestinationId,
          type: 'TRANSFERT',
          montant: montant.toFixed(2),
          description: descriptionFinale,
          pieceJointeUrl,
          effectueParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'TRANSFERT_ENTRE_COMPTES',
        m.id,
        { compteSourceId, compteDestinationId, montant: montant.toFixed(2) },
        'mouvements_financiers',
      );
      return m;
    });

    return { ...mouvement, montant: mouvement.montant.toFixed(2) };
  }

  /**
   * Dépense courante — débite un compte (bancaire ou caisse interne) et trace
   * le mouvement. Refuse si le solde est insuffisant (jamais de compte
   * négatif par cette voie).
   */
  async enregistrerDepense(
    user: AuthenticatedUser,
    compteId: string,
    montantBrut: string,
    description: string,
    pieceJointe: FichierTeleverse | null,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionComptesFinanciers(ctx);

    this.assertUuid(compteId, 'compteId');
    if (!description || description.trim().length < 3) {
      throw new BadRequestException('La description doit contenir au moins 3 caractères.');
    }
    const montant = this.parserMontant(montantBrut);

    const compte = await this.prisma.compteFinancier.findFirst({
      where: { id: compteId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!compte) {
      throw new NotFoundException('Compte financier introuvable.');
    }

    const solde = new Decimal(compte.soldeActuel.toString());
    if (solde.lt(montant)) {
      throw new ConflictException(
        `Solde insuffisant sur le compte « ${compte.nom} » (${solde.toFixed(2)} F) pour une dépense de ${montant.toFixed(2)} F.`,
      );
    }

    const pieceJointeUrl = pieceJointe ? await this.televerserPieceJointe(ctx.organisationId, pieceJointe) : null;

    const mouvement = await this.prisma.$transaction(async (tx) => {
      await tx.compteFinancier.update({
        where: { id: compteId },
        data: { soldeActuel: { decrement: montant.toFixed(2) } },
      });
      const m = await tx.mouvementFinancier.create({
        data: {
          organisationId: ctx.organisationId,
          compteSourceId: compteId,
          compteDestinationId: null,
          type: 'DEPENSE',
          montant: montant.toFixed(2),
          description: description.trim(),
          pieceJointeUrl,
          effectueParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DEPENSE_COMPTE_FINANCIER',
        m.id,
        { compteId, montant: montant.toFixed(2) },
        'mouvements_financiers',
      );
      return m;
    });

    return { ...mouvement, montant: mouvement.montant.toFixed(2) };
  }

  private parserMontant(montantBrut: string): Decimal {
    if (montantBrut === undefined || montantBrut === null || montantBrut === '') {
      throw new BadRequestException('Le montant est requis.');
    }
    let montant: Decimal;
    try {
      montant = new Decimal(String(montantBrut).replace(',', '.'));
    } catch {
      throw new BadRequestException('Le montant doit être un nombre valide.');
    }
    if (!montant.isFinite() || montant.lte(0)) {
      throw new BadRequestException('Le montant doit être un nombre supérieur à zéro.');
    }
    return montant;
  }

  private static readonly REGEX_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private assertUuid(valeur: string | undefined, nomChamp: string): void {
    if (!valeur || !PaymentService.REGEX_UUID.test(valeur)) {
      throw new BadRequestException(`${nomChamp} doit être un UUID valide.`);
    }
  }

  // --- Stockage (Supabase Storage, bucket privé) ----------------------

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private async televerserPieceJointe(organisationId: string, fichier: FichierTeleverse): Promise<string> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des pièces jointes indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    if (!MIME_TYPES_PIECE_JOINTE_AUTORISES.includes(fichier.mimetype)) {
      throw new BadRequestException(`Type de fichier non autorisé : ${fichier.mimetype}.`);
    }
    if (fichier.size > TAILLE_MAX_PIECE_JOINTE_OCTETS) {
      throw new BadRequestException(`Fichier trop volumineux : ${fichier.originalname} (max 10 Mo).`);
    }

    const nomSur = `${Date.now()}-${fichier.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const chemin = `${organisationId}/${nomSur}`;

    const up = await fetch(`${this.baseStorage}/object/${BUCKET_MOUVEMENTS_FINANCIERS}/${chemin}`, {
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
        `Téléversement de la pièce jointe refusé (${up.status} : ${(await up.text()).slice(0, 200)}).`,
      );
    }
    return chemin;
  }

  private async signerPieceJointe(chemin: string): Promise<string> {
    const sign = await fetch(
      `${this.baseStorage}/object/sign/${BUCKET_MOUVEMENTS_FINANCIERS}/${chemin}`,
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
      throw new ServiceUnavailableException("Signature de l'URL de la pièce jointe refusée.");
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
    tableCible: string = 'paiements_groupes',
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
