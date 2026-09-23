import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function profil(role: string, roleChain: string[] = [role]) {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role, adherentId: null, etablissementId: null, pharmacieId: null },
    permissions: { roleChain },
  };
}
const comptable = () => profil('ASSUREUR_COMPTABLE');
const medecinConseil = () => profil('ASSUREUR_MEDECIN_CONSEIL');
/**
 * roleChain simule fidèlement `IdentityService.resoudreChaineRoles` : l'adjoint
 * porte SA PROPRE valeur `role` (`ASSUREUR_COMPTABLE_ADJOINT`) mais son
 * `roleChain` remonte le parent (`role_parent_code`) et INCLUT donc
 * `ASSUREUR_COMPTABLE` — un helper qui omettrait cette remontée ne testerait
 * pas le vrai piège (un `roleChain.includes(...)` passerait à tort le test
 * même avec une implémentation boguée à corriger).
 */
const comptableAdjoint = () => profil('ASSUREUR_COMPTABLE_ADJOINT', ['ASSUREUR_COMPTABLE_ADJOINT', 'ASSUREUR_COMPTABLE']);

/** Prisma Decimal-like : suffit d'avoir toFixed / toString pour le service. */
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      factureMensuelleEtablissement: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      factureMensuellePharmacie: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      paiementGroupeFacture: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
      paiementGroupe: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      etablissementSante: { findMany: jest.fn().mockResolvedValue([]) },
      pharmacie: { findMany: jest.fn().mockResolvedValue([]) },
      compteFinancier: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
  });

  describe('associerFacturesPourPaiement', () => {
    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('une facture introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([{ id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(1000) }]);
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1', 'f2'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse si une facture n’est pas PROGRAMMEE_PAIEMENT', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([
        { id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(1000) },
        { id: 'f2', statut: 'VERIFIEE_MEDECIN_CONSEIL', etablissementId: 'etab-1', montantTotal: dec(2000) },
      ]);
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1', 'f2'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse de mélanger deux établissements différents', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([
        { id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(1000) },
        { id: 'f2', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-2', montantTotal: dec(2000) },
      ]);
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1', 'f2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse si une facture appartient déjà à un paiement groupé', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([
        { id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(1000) },
      ]);
      prisma.paiementGroupeFacture.findMany.mockResolvedValue([{ id: 'pgf-1', factureMensuelleEtablissementId: 'f1' }]);
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('regroupe 2 factures établissement du même établissement, montant sommé', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([
        { id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(15000) },
        { id: 'f2', statut: 'PROGRAMMEE_PAIEMENT', etablissementId: 'etab-1', montantTotal: dec(9000) },
      ]);
      prisma.paiementGroupe.create.mockResolvedValue({
        id: 'pg-1',
        beneficiaireType: 'ETABLISSEMENT',
        beneficiaireId: 'etab-1',
        montantTotal: dec(24000),
        statut: 'PROGRAMME',
      });

      const res = await service.associerFacturesPourPaiement(USER, {
        beneficiaireType: 'ETABLISSEMENT',
        factureMensuelleIds: ['f1', 'f2'],
      });

      expect(prisma.paiementGroupe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beneficiaireType: 'ETABLISSEMENT', beneficiaireId: 'etab-1', montantTotal: '24000.00' }),
        }),
      );
      expect(prisma.paiementGroupeFacture.createMany).toHaveBeenCalledWith({
        data: [
          { paiementGroupeId: 'pg-1', factureMensuelleEtablissementId: 'f1' },
          { paiementGroupeId: 'pg-1', factureMensuelleEtablissementId: 'f2' },
        ],
      });
      expect(res.montantTotal).toBe('24000.00');
      expect(res.nbFactures).toBe(2);
    });

    it('regroupe des factures pharmacie de la même pharmacie', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuellePharmacie.findMany.mockResolvedValue([
        { id: 'f1', statut: 'PROGRAMMEE_PAIEMENT', pharmacieId: 'pharm-1', montantTotal: dec(5000) },
      ]);
      prisma.paiementGroupe.create.mockResolvedValue({
        id: 'pg-2',
        beneficiaireType: 'PHARMACIE',
        beneficiaireId: 'pharm-1',
        montantTotal: dec(5000),
        statut: 'PROGRAMME',
      });

      const res = await service.associerFacturesPourPaiement(USER, {
        beneficiaireType: 'PHARMACIE',
        factureMensuelleIds: ['f1'],
      });

      expect(prisma.paiementGroupeFacture.createMany).toHaveBeenCalledWith({
        data: [{ paiementGroupeId: 'pg-2', factureMensuellePharmacieId: 'f1' }],
      });
      expect(res.montantTotal).toBe('5000.00');
    });
  });

  describe('marquerPaiementGroupePaye', () => {
    it('rôle non autorisé → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.marquerPaiementGroupePaye(USER, 'pg-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('groupe introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.paiementGroupe.findFirst.mockResolvedValue(null);
      await expect(service.marquerPaiementGroupePaye(USER, 'pg-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('déjà PAYE → 409', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.paiementGroupe.findFirst.mockResolvedValue({ id: 'pg-1', statut: 'PAYE', factures: [] });
      await expect(service.marquerPaiementGroupePaye(USER, 'pg-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('cascade PAYEE + datePaiement sur toutes les factures établissement liées', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.paiementGroupe.findFirst.mockResolvedValue({
        id: 'pg-1',
        statut: 'PROGRAMME',
        factures: [
          { factureMensuelleEtablissementId: 'f1', factureMensuellePharmacieId: null },
          { factureMensuelleEtablissementId: 'f2', factureMensuellePharmacieId: null },
        ],
      });
      prisma.paiementGroupe.update.mockResolvedValue({ id: 'pg-1', statut: 'PAYE', montantTotal: dec(24000) });

      const res = await service.marquerPaiementGroupePaye(USER, 'pg-1');

      expect(prisma.factureMensuelleEtablissement.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1', 'f2'] } },
        data: { statut: 'PAYEE', datePaiement: expect.any(Date) },
      });
      expect(prisma.factureMensuellePharmacie.updateMany).not.toHaveBeenCalled();
      expect(res.statut).toBe('PAYE');
    });
  });

  describe('listerFacturesPourComptableGlobal', () => {
    it('rôle non autorisé → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.listerFacturesPourComptableGlobal(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unifie établissement et pharmacie, tout statut', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.factureMensuelleEtablissement.findMany.mockResolvedValue([
        {
          id: 'fe-1',
          statut: 'EN_PREPARATION',
          periode: new Date('2026-08-01'),
          montantTotal: dec(15000),
          nbLignesReportees: 0,
          dateSoumission: null,
          dateVerification: null,
          dateProgrammation: null,
          datePaiement: null,
          etablissement: { nom: 'FARAH' },
          lignes: [
            {
              acteDossier: {
                categorieActe: 'CONSULTATION',
                dossier: {
                  police: { souscripteur: { nom: 'Société A' } },
                  adherent: { nom: 'Yao', prenom: 'Awa' },
                  beneficiaire: null,
                },
              },
            },
          ],
        },
      ]);
      prisma.factureMensuellePharmacie.findMany.mockResolvedValue([
        {
          id: 'fp-1',
          statut: 'PAYEE',
          periode: new Date('2026-07-01'),
          montantTotal: dec(3000),
          nbLignesReportees: 0,
          dateSoumission: null,
          dateValidation: null,
          dateProgrammation: null,
          datePaiement: null,
          pharmacie: { nom: 'Pharmacie Centrale' },
          lignes: [
            {
              ligneOrdonnance: {
                ordonnance: {
                  dossier: {
                    police: { souscripteur: { nom: 'Société B' } },
                    adherent: null,
                    beneficiaire: { nom: 'Kouassi', prenom: 'Fatou' },
                  },
                },
              },
            },
          ],
        },
      ]);

      const res = await service.listerFacturesPourComptableGlobal(USER);

      expect(res).toEqual([
        expect.objectContaining({
          id: 'fe-1',
          beneficiaireType: 'ETABLISSEMENT',
          beneficiaireNom: 'FARAH',
          societes: ['Société A'],
          patients: ['Awa Yao'],
          categoriesActe: ['CONSULTATION'],
        }),
        expect.objectContaining({
          id: 'fp-1',
          beneficiaireType: 'PHARMACIE',
          beneficiaireNom: 'Pharmacie Centrale',
          societes: ['Société B'],
          patients: ['Fatou Kouassi'],
          categoriesActe: ['PHARMACIE'],
        }),
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Comptes financiers — réservé EXCLUSIVEMENT au rôle EXACT
  //  ASSUREUR_COMPTABLE, jamais ASSUREUR_COMPTABLE_ADJOINT (piège
  //  d'héritage : roleChain/profil_a_role remontent l'adjoint vers son
  //  parent, ctx.role ne doit JAMAIS l'être).
  // ═══════════════════════════════════════════════════════════════════════
  describe('listerComptesFinanciers', () => {
    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.listerComptesFinanciers(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 MÊME si son roleChain inclut ASSUREUR_COMPTABLE (piège d’héritage évité)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(service.listerComptesFinanciers(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.findMany).not.toHaveBeenCalled();
    });

    it('ASSUREUR_COMPTABLE (titulaire) → liste avec solde formaté', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findMany.mockResolvedValue([
        {
          id: 'cf-1',
          type: 'BANCAIRE',
          nom: 'Compte principal',
          banqueNom: 'NSIA Banque',
          numeroCompte: 'CI001234',
          soldeActuel: dec(500000),
          createdAt: new Date(),
          updatedAt: new Date(),
          creePar: { role: 'ASSUREUR_COMPTABLE' },
        },
      ]);
      const res = await service.listerComptesFinanciers(USER);
      expect(res).toEqual([expect.objectContaining({ id: 'cf-1', soldeActuel: '500000.00' })]);
    });
  });

  describe('creerCompteFinancier', () => {
    const dto = { type: 'BANCAIRE' as const, nom: 'Compte principal', fondsInitial: 100000 };

    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.creerCompteFinancier(USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.create).not.toHaveBeenCalled();
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (jamais l’adjoint, même via son roleChain hérité)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(service.creerCompteFinancier(USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.create).not.toHaveBeenCalled();
    });

    it('ASSUREUR_COMPTABLE (titulaire) crée le compte avec son solde de départ', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.create.mockResolvedValue({
        id: 'cf-1',
        type: 'BANCAIRE',
        nom: 'Compte principal',
        soldeActuel: dec(100000),
      });

      const res = await service.creerCompteFinancier(USER, dto);

      expect(prisma.compteFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organisationId: 'org-1',
            type: 'BANCAIRE',
            nom: 'Compte principal',
            soldeActuel: '100000.00',
            creeParId: 'u1',
          }),
        }),
      );
      expect(res.soldeActuel).toBe('100000.00');
    });
  });

  describe('approvisionnerCompte', () => {
    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'EXTERNE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (jamais l’adjoint)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'EXTERNE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.findFirst).not.toHaveBeenCalled();
    });

    it('compte introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue(null);
      await expect(
        service.approvisionnerCompte(USER, 'cf-x', { montant: 1000, source: 'EXTERNE' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('source EXTERNE : augmente le solde, aucun débit ailleurs', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) });
      prisma.compteFinancier.update.mockResolvedValue({ id: 'cf-1', soldeActuel: dec(150000) });

      const res = await service.approvisionnerCompte(USER, 'cf-1', {
        montant: 50000,
        source: 'EXTERNE',
        piecesJustificatives: ['virement-2026-09.pdf'],
      });

      expect(prisma.compteFinancier.update).toHaveBeenCalledTimes(1);
      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: 'cf-1' },
        data: { soldeActuel: { increment: '50000.00' } },
      });
      expect(res.soldeActuel).toBe('150000.00');
    });

    it('source AUTRE_COMPTE sans compteSourceId → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) });
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'AUTRE_COMPTE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('source AUTRE_COMPTE identique à la cible → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) });
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'AUTRE_COMPTE', compteSourceId: 'cf-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('source AUTRE_COMPTE : compte source introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) })
        .mockResolvedValueOnce(null);
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'AUTRE_COMPTE', compteSourceId: 'cf-2' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('source AUTRE_COMPTE : solde source insuffisant → 409, aucune écriture', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) })
        .mockResolvedValueOnce({ id: 'cf-2', soldeActuel: dec(500) });
      await expect(
        service.approvisionnerCompte(USER, 'cf-1', { montant: 1000, source: 'AUTRE_COMPTE', compteSourceId: 'cf-2' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
    });

    it('source AUTRE_COMPTE : crédite la cible ET débite la source dans la même transaction', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) })
        .mockResolvedValueOnce({ id: 'cf-2', soldeActuel: dec(50000) });
      prisma.compteFinancier.update.mockResolvedValue({ id: 'cf-1', soldeActuel: dec(130000) });

      const res = await service.approvisionnerCompte(USER, 'cf-1', {
        montant: 30000,
        source: 'AUTRE_COMPTE',
        compteSourceId: 'cf-2',
      });

      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: 'cf-1' },
        data: { soldeActuel: { increment: '30000.00' } },
      });
      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: 'cf-2' },
        data: { soldeActuel: { decrement: '30000.00' } },
      });
      expect(res.soldeActuel).toBe('130000.00');
    });
  });
});
