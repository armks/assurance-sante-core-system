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
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    prisma = {
      factureMensuelleEtablissement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      factureMensuellePharmacie: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      paiementGroupeFacture: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
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
      mouvementFinancier: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('/object/sign/')) {
        return { ok: true, json: async () => ({ signedURL: '/object/sign/mouvements-financiers/x/y.pdf?token=abc' }) } as any;
      }
      return { ok: true, text: async () => '' } as any;
    });
    global.fetch = fetchMock as any;

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

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (exception paiements groupés refermée, audit du 2026-09-24)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(
        service.associerFacturesPourPaiement(USER, { beneficiaireType: 'ETABLISSEMENT', factureMensuelleIds: ['f1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.factureMensuelleEtablissement.findMany).not.toHaveBeenCalled();
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

  describe('listerPaiementsGroupes', () => {
    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.listerPaiementsGroupes(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (exception paiements groupés refermée, audit du 2026-09-24)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(service.listerPaiementsGroupes(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.paiementGroupe.findMany).not.toHaveBeenCalled();
    });

    it('ASSUREUR_COMPTABLE (titulaire) liste les paiements groupés', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.paiementGroupe.findMany.mockResolvedValue([
        { id: 'pg-1', beneficiaireType: 'ETABLISSEMENT', beneficiaireId: 'etab-1', montantTotal: dec(1000), statut: 'PROGRAMME', factures: [] },
      ]);
      prisma.etablissementSante.findMany.mockResolvedValue([{ id: 'etab-1', nom: 'FARAH' }]);

      const res = await service.listerPaiementsGroupes(USER);

      expect(res).toHaveLength(1);
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
          montantPaye: dec(0),
          paiementProgrammeDate: null,
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
          montantPaye: dec(3000),
          paiementProgrammeDate: null,
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

    it('montant à virgule (150000.75) : passé à Prisma via Decimal, exact au centime (PROMPT 4)', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.create.mockResolvedValue({
        id: 'cf-2',
        type: 'BANCAIRE',
        nom: 'Compte principal',
        soldeActuel: dec(150000.75),
      });

      const res = await service.creerCompteFinancier(USER, { ...dto, fondsInitial: 150000.75 });

      expect(prisma.compteFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ soldeActuel: '150000.75' }) }),
      );
      expect(res.soldeActuel).toBe('150000.75');
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

    it('crée aussi un mouvement APPROVISIONNEMENT (historique par compte complet)', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(100000) })
        .mockResolvedValueOnce({ id: 'cf-2', soldeActuel: dec(50000) });
      prisma.compteFinancier.update.mockResolvedValue({ id: 'cf-1', soldeActuel: dec(130000) });

      await service.approvisionnerCompte(USER, 'cf-1', {
        montant: 30000,
        source: 'AUTRE_COMPTE',
        compteSourceId: 'cf-2',
      });

      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'APPROVISIONNEMENT',
            compteSourceId: 'cf-2',
            compteDestinationId: 'cf-1',
            montant: '30000.00',
            pieceJointeUrl: null,
          }),
        }),
      );
    });

    it('montant à virgule (1500.50) : le même Decimal alimente increment, mouvement ET audit (PROMPT 4)', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValueOnce({ id: 'cf-1', soldeActuel: dec(10000) });
      prisma.compteFinancier.update.mockResolvedValue({ id: 'cf-1', soldeActuel: dec(11500.5) });

      const res = await service.approvisionnerCompte(USER, 'cf-1', {
        montant: 1500.5,
        source: 'EXTERNE',
        piecesJustificatives: ['virement.pdf'],
      });

      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: 'cf-1' },
        data: { soldeActuel: { increment: '1500.50' } },
      });
      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ montant: '1500.50' }) }),
      );
      expect(res.soldeActuel).toBe('11500.50');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Mouvements entre comptes + dépenses courantes — même périmètre EXCLUSIF
  //  que les comptes financiers (ASSUREUR_COMPTABLE, jamais son adjoint).
  // ═══════════════════════════════════════════════════════════════════════
  describe('transfererEntreComptes', () => {
    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.transfererEntreComptes(USER, 'cf-1', 'cf-2', '1000', undefined, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (jamais l’adjoint, même via son roleChain hérité)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(
        service.transfererEntreComptes(USER, 'cf-1', 'cf-2', '1000', undefined, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.findFirst).not.toHaveBeenCalled();
    });

    it('compteSourceId invalide (pas un UUID) → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(
        service.transfererEntreComptes(USER, 'pas-un-uuid', '11111111-1111-4111-8111-111111111111', '1000', undefined, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('même compte source et destination → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      const id = '11111111-1111-4111-8111-111111111111';
      await expect(service.transfererEntreComptes(USER, id, id, '1000', undefined, null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('montant non numérique → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(
        service.transfererEntreComptes(
          USER,
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          'abc',
          undefined,
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    const SRC = '11111111-1111-4111-8111-111111111111';
    const DST = '22222222-2222-4222-8222-222222222222';

    it('compte source introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: DST, nom: 'B', soldeActuel: dec(1000) });
      await expect(service.transfererEntreComptes(USER, SRC, DST, '100', undefined, null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('compte destination introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'A', soldeActuel: dec(1000) })
        .mockResolvedValueOnce(null);
      await expect(service.transfererEntreComptes(USER, SRC, DST, '100', undefined, null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('solde insuffisant → 409, aucune écriture', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'A', soldeActuel: dec(500) })
        .mockResolvedValueOnce({ id: DST, nom: 'B', soldeActuel: dec(1000) });
      await expect(service.transfererEntreComptes(USER, SRC, DST, '1000', undefined, null)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
      expect(prisma.mouvementFinancier.create).not.toHaveBeenCalled();
    });

    it('transfert réussi : débite la source, crédite la destination, trace le mouvement', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'Compte A', soldeActuel: dec(10000) })
        .mockResolvedValueOnce({ id: DST, nom: 'Compte B', soldeActuel: dec(2000) });
      prisma.mouvementFinancier.create.mockResolvedValue({
        id: 'mf-1',
        type: 'TRANSFERT',
        montant: dec(3000),
      });

      const res = await service.transfererEntreComptes(USER, SRC, DST, '3000', 'Virement mensuel', null);

      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: SRC },
        data: { soldeActuel: { decrement: '3000.00' } },
      });
      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: DST },
        data: { soldeActuel: { increment: '3000.00' } },
      });
      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            compteSourceId: SRC,
            compteDestinationId: DST,
            type: 'TRANSFERT',
            montant: '3000.00',
            description: 'Virement mensuel',
            pieceJointeUrl: null,
          }),
        }),
      );
      expect(res.montant).toBe('3000.00');
    });

    it('log_audit() échoue → la méthode rejette (PROMPT 4 : jamais avalé, la transaction Prisma se défait avec elle)', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'Compte A', soldeActuel: dec(10000) })
        .mockResolvedValueOnce({ id: DST, nom: 'Compte B', soldeActuel: dec(2000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-1', type: 'TRANSFERT', montant: dec(3000) });
      prisma.$executeRaw.mockRejectedValueOnce(new Error('log_audit indisponible'));

      await expect(
        service.transfererEntreComptes(USER, SRC, DST, '3000', 'Virement mensuel', null),
      ).rejects.toThrow('log_audit indisponible');
    });

    it('description omise → auto-générée', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'Compte A', soldeActuel: dec(10000) })
        .mockResolvedValueOnce({ id: DST, nom: 'Compte B', soldeActuel: dec(2000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-1', type: 'TRANSFERT', montant: dec(1000) });

      await service.transfererEntreComptes(USER, SRC, DST, '1000', undefined, null);

      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: expect.stringContaining('Compte A') }),
        }),
      );
    });

    it('avec pièce jointe : téléverse dans le bucket mouvements-financiers puis stocke le chemin', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'Compte A', soldeActuel: dec(10000) })
        .mockResolvedValueOnce({ id: DST, nom: 'Compte B', soldeActuel: dec(2000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-1', type: 'TRANSFERT', montant: dec(1000) });

      const fichier = { buffer: Buffer.from('x'), originalname: 'cheque.pdf', mimetype: 'application/pdf', size: 100 };
      await service.transfererEntreComptes(USER, SRC, DST, '1000', 'Virement', fichier);

      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/object/mouvements-financiers/'))).toBe(true);
      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pieceJointeUrl: expect.stringContaining('cheque.pdf') }) }),
      );
    });

    it('pièce jointe de type non autorisé → 400, aucune écriture', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst
        .mockResolvedValueOnce({ id: SRC, nom: 'Compte A', soldeActuel: dec(10000) })
        .mockResolvedValueOnce({ id: DST, nom: 'Compte B', soldeActuel: dec(2000) });
      const fichier = { buffer: Buffer.from('x'), originalname: 'virus.exe', mimetype: 'application/x-msdownload', size: 100 };
      await expect(
        service.transfererEntreComptes(USER, SRC, DST, '1000', 'Virement', fichier),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.mouvementFinancier.create).not.toHaveBeenCalled();
    });
  });

  describe('enregistrerDepense', () => {
    const CPT = '33333333-3333-4333-8333-333333333333';

    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.enregistrerDepense(USER, CPT, '1000', 'Achat fournitures', null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (jamais l’adjoint)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(
        service.enregistrerDepense(USER, CPT, '1000', 'Achat fournitures', null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.findFirst).not.toHaveBeenCalled();
    });

    it('description trop courte → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(service.enregistrerDepense(USER, CPT, '1000', 'ok', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('compte introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue(null);
      await expect(
        service.enregistrerDepense(USER, CPT, '1000', 'Achat fournitures', null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('solde insuffisant → 409, aucune écriture', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue({ id: CPT, nom: 'Caisse', soldeActuel: dec(200) });
      await expect(
        service.enregistrerDepense(USER, CPT, '1000', 'Achat fournitures', null),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
    });

    it('log_audit() échoue → la méthode rejette (PROMPT 4 : jamais avalé)', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue({ id: CPT, nom: 'Caisse', soldeActuel: dec(10000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-2', type: 'DEPENSE', montant: dec(1500) });
      prisma.$executeRaw.mockRejectedValueOnce(new Error('log_audit indisponible'));

      await expect(
        service.enregistrerDepense(USER, CPT, '1500', 'Fournitures de bureau', null),
      ).rejects.toThrow('log_audit indisponible');
    });

    it('dépense enregistrée : débite le compte, trace le mouvement DEPENSE', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue({ id: CPT, nom: 'Caisse', soldeActuel: dec(10000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-2', type: 'DEPENSE', montant: dec(1500) });

      const res = await service.enregistrerDepense(USER, CPT, '1500', 'Fournitures de bureau', null);

      expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
        where: { id: CPT },
        data: { soldeActuel: { decrement: '1500.00' } },
      });
      expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            compteSourceId: CPT,
            compteDestinationId: null,
            type: 'DEPENSE',
            montant: '1500.00',
            description: 'Fournitures de bureau',
            pieceJointeUrl: null,
          }),
        }),
      );
      expect(res.montant).toBe('1500.00');
    });

    it('avec pièce jointe (reçu) : téléversée puis chemin stocké', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue({ id: CPT, nom: 'Caisse', soldeActuel: dec(10000) });
      prisma.mouvementFinancier.create.mockResolvedValue({ id: 'mf-2', type: 'DEPENSE', montant: dec(1500) });

      const fichier = { buffer: Buffer.from('x'), originalname: 'recu.jpg', mimetype: 'image/jpeg', size: 100 };
      await service.enregistrerDepense(USER, CPT, '1500', 'Fournitures de bureau', fichier);

      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/object/mouvements-financiers/'))).toBe(true);
    });
  });

  describe('listerMouvementsFinanciers', () => {
    it('rôle non autorisé → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.listerMouvementsFinanciers(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 (piège d’héritage évité)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(service.listerMouvementsFinanciers(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.mouvementFinancier.findMany).not.toHaveBeenCalled();
    });

    it('liste dénormalisée, plus récents d’abord', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.mouvementFinancier.findMany.mockResolvedValue([
        {
          id: 'mf-1',
          type: 'TRANSFERT',
          montant: dec(3000),
          description: 'Virement',
          pieceJointeUrl: 'org-1/x.pdf',
          compteSource: { id: 'cf-1', nom: 'Compte A' },
          compteDestination: { id: 'cf-2', nom: 'Compte B' },
          effectuePar: { role: 'ASSUREUR_COMPTABLE' },
          createdAt: new Date('2026-09-20'),
        },
      ]);

      const res = await service.listerMouvementsFinanciers(USER);

      expect(res).toEqual([
        expect.objectContaining({
          id: 'mf-1',
          type: 'TRANSFERT',
          montant: '3000.00',
          aUnePieceJointe: true,
          compteSource: { id: 'cf-1', nom: 'Compte A' },
          compteDestination: { id: 'cf-2', nom: 'Compte B' },
        }),
      ]);
    });
  });

  describe('obtenirUrlPieceJointeMouvement', () => {
    it('rôle non autorisé → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.obtenirUrlPieceJointeMouvement(USER, 'mf-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('mouvement introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.mouvementFinancier.findFirst.mockResolvedValue(null);
      await expect(service.obtenirUrlPieceJointeMouvement(USER, 'mf-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mouvement sans pièce jointe → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.mouvementFinancier.findFirst.mockResolvedValue({ id: 'mf-1', pieceJointeUrl: null });
      await expect(service.obtenirUrlPieceJointeMouvement(USER, 'mf-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retourne une URL signée à durée limitée', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.mouvementFinancier.findFirst.mockResolvedValue({ id: 'mf-1', pieceJointeUrl: 'org-1/x.pdf' });

      const res = await service.obtenirUrlPieceJointeMouvement(USER, 'mf-1');

      expect(res.url).toContain('/object/sign/mouvements-financiers/');
      expect(res.expiresIn).toBe(3600);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  payerFacture — point de convergence le plus sensible : paiement RÉEL
  //  (débit exact d'un compte financier) d'une facture individuelle OU d'un
  //  paiement groupé. Débiter un compte est une opération de TRÉSORERIE —
  //  même périmètre EXCLUSIF que comptes/mouvements financiers (rôle EXACT
  //  ASSUREUR_COMPTABLE, jamais l'adjoint), PAS le périmètre plus large de
  //  validerPourPaiement/associerFacturesPourPaiement (roleChain, adjoint
  //  inclus) : choisir le compte à débiter n'est pas une étape du circuit de
  //  facturation, c'est un acte de gestion de trésorerie.
  // ═══════════════════════════════════════════════════════════════════════
  describe('payerFacture', () => {
    const futur = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ASSUREUR_COMPTABLE_ADJOINT → 403 MÊME si son roleChain inclut ASSUREUR_COMPTABLE (piège d’héritage évité)', async () => {
      identity.getMe.mockResolvedValue(comptableAdjoint());
      await expect(
        service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.compteFinancier.findFirst).not.toHaveBeenCalled();
    });

    it('ni factureMensuelleId ni paiementGroupeId → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(service.payerFacture(USER, { compteId: 'cf-1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('les deux fournis → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(
        service.payerFacture(USER, { factureMensuelleId: 'fe-1', paiementGroupeId: 'pg-1', compteId: 'cf-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dateProgrammee dans le passé → 400', async () => {
      identity.getMe.mockResolvedValue(comptable());
      await expect(
        service.payerFacture(USER, {
          factureMensuelleId: 'fe-1',
          compteId: 'cf-1',
          dateProgrammee: new Date(Date.now() - 1000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('compte financier introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(comptable());
      prisma.compteFinancier.findFirst.mockResolvedValue(null);
      await expect(
        service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('facture individuelle', () => {
      beforeEach(() => {
        prisma.compteFinancier.findFirst.mockResolvedValue({ id: 'cf-1', nom: 'Compte principal', soldeActuel: dec(500000) });
      });

      it('facture introuvable (ni établissement ni pharmacie) → 404', async () => {
        identity.getMe.mockResolvedValue(comptable());
        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-x', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('statut non payable (EN_PREPARATION) → 409', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'EN_PREPARATION', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('facture déjà groupée → 409, payer le groupe plutôt', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.paiementGroupeFacture.findFirst.mockResolvedValue({ id: 'pgf-1' });
        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('montant demandé > solde restant dû → 400', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1', montant: 999999 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('solde du compte insuffisant → 409, aucune écriture', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.compteFinancier.findFirst.mockResolvedValue({ id: 'cf-1', nom: 'Petit compte', soldeActuel: dec(100) });
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
        expect(prisma.mouvementFinancier.create).not.toHaveBeenCalled();
      });

      it('paiement intégral exact : compte à 500 000 F débité de 120 000 F → 380 000,00 F, facture PAYEE', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PAYEE', montantTotal: dec(120000), montantPaye: dec(120000),
        });

        const res: any = await service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' });

        expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
          where: { id: 'cf-1' },
          data: { soldeActuel: { decrement: '120000.00' } },
        });
        expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'fe-1' },
            data: expect.objectContaining({ statut: 'PAYEE', montantPaye: '120000.00', datePaiement: expect.any(Date) }),
          }),
        );
        expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ compteSourceId: 'cf-1', compteDestinationId: null, type: 'PAIEMENT_FACTURE', montant: '120000.00' }),
          }),
        );
        expect(res.montantTotal).toBe('120000.00');
        expect(res.montantPaye).toBe('120000.00');
        expect(res.montantRestant).toBe('0.00');
      });

      it('log_audit() échoue → la méthode rejette (PROMPT 4 : jamais avalé, aucun paiement ne doit survivre à un audit manqué)', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PAYEE', montantTotal: dec(120000), montantPaye: dec(120000),
        });
        prisma.$executeRaw.mockRejectedValueOnce(new Error('log_audit indisponible'));

        await expect(
          service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' }),
        ).rejects.toThrow('log_audit indisponible');
      });

      it('paiement partiel : montant < restant dû → PARTIELLEMENT_REGLEE, restant recalculé', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PARTIELLEMENT_REGLEE', montantTotal: dec(120000), montantPaye: dec(50000),
        });

        const res: any = await service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1', montant: 50000 });

        expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ statut: 'PARTIELLEMENT_REGLEE', montantPaye: '50000.00' }),
          }),
        );
        expect(res.montantRestant).toBe('70000.00');
      });

      it('paiement partiel puis complément : restant recalculé depuis montantPaye déjà existant', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PARTIELLEMENT_REGLEE', montantTotal: dec(120000), montantPaye: dec(50000),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PAYEE', montantTotal: dec(120000), montantPaye: dec(120000),
        });

        const res: any = await service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' });

        expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
          where: { id: 'cf-1' },
          data: { soldeActuel: { decrement: '70000.00' } },
        });
        expect(res.montantRestant).toBe('0.00');
      });

      it('dateProgrammee future : NE débite PAS, statut PAIEMENT_PROGRAMME, intention stockée', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PAIEMENT_PROGRAMME', montantTotal: dec(120000), montantPaye: dec(0),
        });

        const res = await service.payerFacture(USER, {
          factureMensuelleId: 'fe-1',
          compteId: 'cf-1',
          dateProgrammee: futur(),
          preuvePaiement: ['virement-2026-10.pdf'],
        });

        expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
        expect(prisma.mouvementFinancier.create).not.toHaveBeenCalled();
        expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              statut: 'PAIEMENT_PROGRAMME',
              paiementProgrammeCompteId: 'cf-1',
              paiementProgrammeMontant: '120000.00',
              paiementProgrammePreuves: ['virement-2026-10.pdf'],
            }),
          }),
        );
        expect(res.statut).toBe('PAIEMENT_PROGRAMME');
      });

      it('confirmation (facture déjà PAIEMENT_PROGRAMME, rappel sans date) : débite réellement maintenant', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
          id: 'fe-1', statut: 'PAIEMENT_PROGRAMME', montantTotal: dec(120000), montantPaye: dec(0),
          etablissement: { nom: 'FARAH' },
        });
        prisma.factureMensuelleEtablissement.update.mockResolvedValue({
          id: 'fe-1', statut: 'PAYEE', montantTotal: dec(120000), montantPaye: dec(120000),
        });

        const res = await service.payerFacture(USER, { factureMensuelleId: 'fe-1', compteId: 'cf-1' });

        expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
          where: { id: 'cf-1' },
          data: { soldeActuel: { decrement: '120000.00' } },
        });
        expect(prisma.mouvementFinancier.create).toHaveBeenCalled();
        expect(res.statut).toBe('PAYEE');
      });

      it('facture pharmacie (introuvable côté établissement, trouvée côté pharmacie)', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fp-1', statut: 'PROGRAMMEE_PAIEMENT', montantTotal: dec(30000), montantPaye: dec(0),
          pharmacie: { nom: 'Pharmacie Centrale' },
        });
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fp-1', statut: 'PAYEE', montantTotal: dec(30000), montantPaye: dec(30000),
        });

        const res = await service.payerFacture(USER, { factureMensuelleId: 'fp-1', compteId: 'cf-1' });

        expect(prisma.factureMensuellePharmacie.update).toHaveBeenCalled();
        expect(prisma.factureMensuelleEtablissement.update).not.toHaveBeenCalled();
        expect(res.statut).toBe('PAYEE');
      });
    });

    describe('paiement groupé', () => {
      beforeEach(() => {
        prisma.compteFinancier.findFirst.mockResolvedValue({ id: 'cf-1', nom: 'Compte principal', soldeActuel: dec(500000) });
      });

      it('groupe introuvable → 404', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.paiementGroupe.findFirst.mockResolvedValue(null);
        await expect(
          service.payerFacture(USER, { paiementGroupeId: 'pg-x', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('déjà PAYE → 409', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.paiementGroupe.findFirst.mockResolvedValue({ id: 'pg-1', statut: 'PAYE', montantTotal: dec(24000), factures: [] });
        await expect(
          service.payerFacture(USER, { paiementGroupeId: 'pg-1', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('montant fourni ≠ montant total du groupe → 400 (jamais de paiement partiel de groupe)', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.paiementGroupe.findFirst.mockResolvedValue({ id: 'pg-1', statut: 'PROGRAMME', montantTotal: dec(24000), factures: [] });
        await expect(
          service.payerFacture(USER, { paiementGroupeId: 'pg-1', compteId: 'cf-1', montant: 10000 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('solde insuffisant → 409, aucune écriture', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.compteFinancier.findFirst.mockResolvedValue({ id: 'cf-1', nom: 'Petit compte', soldeActuel: dec(100) });
        prisma.paiementGroupe.findFirst.mockResolvedValue({ id: 'pg-1', statut: 'PROGRAMME', montantTotal: dec(24000), factures: [] });
        await expect(
          service.payerFacture(USER, { paiementGroupeId: 'pg-1', compteId: 'cf-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
      });

      it('paiement intégral : débite le compte, cascade PAYEE (montantPaye = montantTotal) sur établissement ET pharmacie', async () => {
        identity.getMe.mockResolvedValue(comptable());
        const montant1 = dec(15000);
        const montant2 = dec(9000);
        prisma.paiementGroupe.findFirst.mockResolvedValue({
          id: 'pg-1',
          statut: 'PROGRAMME',
          montantTotal: dec(24000),
          beneficiaireType: 'ETABLISSEMENT',
          beneficiaireId: 'etab-1',
          factures: [
            {
              factureMensuelleEtablissementId: 'fe-1',
              factureMensuellePharmacieId: null,
              factureMensuelleEtablissement: { id: 'fe-1', montantTotal: montant1 },
              factureMensuellePharmacie: null,
            },
            {
              factureMensuelleEtablissementId: 'fe-2',
              factureMensuellePharmacieId: null,
              factureMensuelleEtablissement: { id: 'fe-2', montantTotal: montant2 },
              factureMensuellePharmacie: null,
            },
          ],
        });
        prisma.etablissementSante.findMany.mockResolvedValue([{ id: 'etab-1', nom: 'FARAH' }]);
        prisma.paiementGroupe.update.mockResolvedValue({ id: 'pg-1', statut: 'PAYE', montantTotal: dec(24000) });

        const res = await service.payerFacture(USER, { paiementGroupeId: 'pg-1', compteId: 'cf-1' });

        expect(prisma.compteFinancier.update).toHaveBeenCalledWith({
          where: { id: 'cf-1' },
          data: { soldeActuel: { decrement: '24000.00' } },
        });
        expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'fe-1' }, data: expect.objectContaining({ statut: 'PAYEE', montantPaye: montant1 }) }),
        );
        expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'fe-2' }, data: expect.objectContaining({ statut: 'PAYEE', montantPaye: montant2 }) }),
        );
        expect(prisma.mouvementFinancier.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ montant: '24000.00', type: 'PAIEMENT_FACTURE' }) }),
        );
        expect(res.statut).toBe('PAYE');
      });

      it('dateProgrammee future : NE débite PAS, statut PAIEMENT_PROGRAMME', async () => {
        identity.getMe.mockResolvedValue(comptable());
        prisma.paiementGroupe.findFirst.mockResolvedValue({ id: 'pg-1', statut: 'PROGRAMME', montantTotal: dec(24000), factures: [] });
        prisma.paiementGroupe.update.mockResolvedValue({ id: 'pg-1', statut: 'PAIEMENT_PROGRAMME', montantTotal: dec(24000) });

        const res = await service.payerFacture(USER, {
          paiementGroupeId: 'pg-1',
          compteId: 'cf-1',
          dateProgrammee: futur(),
        });

        expect(prisma.compteFinancier.update).not.toHaveBeenCalled();
        expect(res.statut).toBe('PAIEMENT_PROGRAMME');
      });
    });
  });
});
