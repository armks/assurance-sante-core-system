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
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssocierFacturesPourPaiementDto } from './dto/payment.dto';
import {
  CATEGORIE_ACTE_PHARMACIE,
  ContexteAppelant,
  ROLE_COMPTABLE_PAIEMENT_GROUPE,
  STATUT_FACTURE_MENSUELLE_GROUPABLE,
} from './payment.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PaymentService — module `payment/` : regroupement de factures mensuelles
 * (établissement OU pharmacie) en un paiement programmé unique, et vue
 * d'ensemble globale ASSUREUR_COMPTABLE (toutes factures mensuelles des deux
 * domaines, tout statut — item 1 du prompt « étend les factures mensuelles »).
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

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
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertComptable(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_PAIEMENT_GROUPE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
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
    this.assertComptable(ctx);

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

  /** Liste des paiements groupés — réservé à ASSUREUR_COMPTABLE, organisation entière. */
  async listerPaiementsGroupes(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertComptable(ctx);

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
      statut: g.statut,
    }));
  }

  /**
   * Marque un paiement groupé payé — cascade PAYEE + `datePaiement` à TOUTES
   * les factures liées (établissement ou pharmacie selon le groupe).
   */
  async marquerPaiementGroupePaye(user: AuthenticatedUser, paiementGroupeId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertComptable(ctx);

    const groupe = await this.prisma.paiementGroupe.findFirst({
      where: { id: paiementGroupeId, organisationId: ctx.organisationId },
      include: { factures: true },
    });
    if (!groupe) {
      throw new NotFoundException('Paiement groupé introuvable.');
    }
    if (groupe.statut !== 'PROGRAMME') {
      throw new ConflictException(`Ce paiement groupé est déjà ${groupe.statut}.`);
    }

    const maintenant = new Date();
    const etabIds = groupe.factures
      .map((f) => f.factureMensuelleEtablissementId)
      .filter((id): id is string => id !== null);
    const pharmaIds = groupe.factures
      .map((f) => f.factureMensuellePharmacieId)
      .filter((id): id is string => id !== null);

    const maj = await this.prisma.$transaction(async (tx) => {
      if (etabIds.length > 0) {
        await tx.factureMensuelleEtablissement.updateMany({
          where: { id: { in: etabIds } },
          data: { statut: 'PAYEE', datePaiement: maintenant },
        });
      }
      if (pharmaIds.length > 0) {
        await tx.factureMensuellePharmacie.updateMany({
          where: { id: { in: pharmaIds } },
          data: { statut: 'PAYEE', datePaiement: maintenant },
        });
      }
      const g = await tx.paiementGroupe.update({
        where: { id: paiementGroupeId },
        data: { statut: 'PAYE', datePaiement: maintenant },
      });
      await this.audit(tx, ctx.userId, 'PAIEMENT_PAIEMENT_GROUPE', g.id, {
        nbFacturesEtablissement: etabIds.length,
        nbFacturesPharmacie: pharmaIds.length,
      });
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
          ${'paiements_groupes'}::text,
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
