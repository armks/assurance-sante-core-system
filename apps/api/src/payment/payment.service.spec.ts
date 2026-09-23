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

function profil(role: string) {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role, adherentId: null, etablissementId: null, pharmacieId: null },
    permissions: { roleChain: [role] },
  };
}
const comptable = () => profil('ASSUREUR_COMPTABLE');
const medecinConseil = () => profil('ASSUREUR_MEDECIN_CONSEIL');

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
});
