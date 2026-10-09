import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { TarifsProposesService } from '../tarifs-proposes/tarifs-proposes.service';
import { tarifsProposesDeTest } from '../tarifs-proposes/tarifs-proposes.testing';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import { AdjudicationClientService } from '../adjudication-client/adjudication-client.service';
import { adjudicationClientDeTest } from '../adjudication-client/adjudication-client.testing';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function profil(role: string, extra: Record<string, unknown> = {}) {
  return {
    profil: {
      id: 'u1',
      organisationId: 'org-1',
      role,
      adherentId: null,
      etablissementId: null,
      pharmacieId: null,
      ...extra,
    },
    permissions: { roleChain: [role] },
  };
}
const comptableEtab = (etablissementId = 'etab-1') =>
  profil('CENTRE_MEDICAL_COMPTABLE', { etablissementId });
const administratifEtab = (etablissementId = 'etab-1') =>
  profil('CENTRE_MEDICAL_ADMINISTRATIF', { etablissementId });
const medecinEtab = (etablissementId = 'etab-1') =>
  profil('CENTRE_MEDICAL_MEDECIN', { etablissementId });
const medecinConseil = () => profil('ASSUREUR_MEDECIN_CONSEIL');
const comptableAssureur = () => profil('ASSUREUR_COMPTABLE');

/** Prisma Decimal-like : suffit d'avoir toFixed / toString pour le service. */
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

/** Microservice d'adjudication factice (simulation : 80 % par défaut). */
let adjudication: ReturnType<typeof adjudicationClientDeTest>;
beforeEach(() => {
  adjudication = adjudicationClientDeTest();
});

describe('PreauthorizationService — Consolidation mensuelle des factures établissement', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      etablissementSante: { findUnique: jest.fn().mockResolvedValue({ nom: 'Centre A', statut: 'ACTIF', deletedAt: null }) },
      acteDossier: { findMany: jest.fn().mockResolvedValue([]) },
      contestationActe: { findMany: jest.fn().mockResolvedValue([]) },
      tarifPropose: { findMany: jest.fn().mockResolvedValue([]) },
      ligneFacturation: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      factureMensuelleEtablissement: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      paiementGroupeFacture: { findFirst: jest.fn().mockResolvedValue(null) },
      factureDossier: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AdjudicationClientService, useValue: adjudication },
        { provide: TarifsProposesService, useValue: tarifsProposesDeTest() },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: CareEpisodeService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PreauthorizationService);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Horloge figée (2026-09-18) : mois précédent = août 2026.
  // ═══════════════════════════════════════════════════════════════════════
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-18T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('soumettreFactureMensuelleEtablissement', () => {
    it('rôle non autorisé (médecin) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinEtab());
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ligneFacturation.findMany).not.toHaveBeenCalled();
    });

    it('rôle non autorisé (comptable assureur, pas établissement) → 403', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('périodes autres que le mois précédent → 400', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-07-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-09-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('établissement ARCHIVÉ : aucune nouvelle facture mensuelle (409)', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Centre A', statut: 'RESILIE', deletedAt: null });
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' }),
      ).rejects.toThrow(/Centre A.*archivé.*aucune nouvelle facture mensuelle/);
      expect(prisma.factureMensuelleEtablissement.create).not.toHaveBeenCalled();
    });

    it('facture déjà SOUMISE pour cette période → 409', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({ id: 'fact-0', statut: 'SOUMISE' });
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("l'administratif peut aussi soumettre", async () => {
      identity.getMe.mockResolvedValue(administratifEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
      prisma.factureMensuelleEtablissement.create.mockResolvedValue({ id: 'fact-1' });
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        statut: 'SOUMISE',
        montantTotal: dec(0),
        periode: new Date('2026-08-01'),
        dateSoumission: new Date(),
      });
      await expect(
        service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' }),
      ).resolves.toMatchObject({ statut: 'SOUMISE' });
    });

    it('agrège les LigneFacturation PAYE, exclut celles en litige, et ne stampe que les facturables', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
      prisma.ligneFacturation.findMany.mockResolvedValue([
        { id: 'lf-1', acteDossierId: 'acte-1', montantReclame: dec(4000) },
        { id: 'lf-2', acteDossierId: 'acte-2', montantReclame: dec(1500) },
        { id: 'lf-3', acteDossierId: 'acte-3', montantReclame: dec(2000) },
      ]);
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-2' }]); // acte-2 en litige
      prisma.factureMensuelleEtablissement.create.mockResolvedValue({ id: 'fact-1' });
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        periode: new Date('2026-08-01'),
        statut: 'SOUMISE',
        montantTotal: dec(6000),
        dateSoumission: new Date('2026-09-18T12:00:00Z'),
      });

      const res = await service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' });

      // 4000 (acte-1) + 2000 (acte-3) = 6000 — acte-2 (1500, en litige) exclu.
      expect(prisma.factureMensuelleEtablissement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ montantTotal: '6000.00' }) }),
      );
      expect(prisma.ligneFacturation.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['lf-1', 'lf-3'] } },
        data: { factureMensuelleEtablissementId: 'fact-1', reporteeMoisSuivant: false },
      });
      expect(res.nbLignesIncluses).toBe(2);
      expect(res.nbLignesExclues).toBe(1);
    });

    it("n'inclut jamais une ligne déjà réclamée par une facture mensuelle précédente (déjà filtrée côté requête)", async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
      prisma.ligneFacturation.findMany.mockResolvedValue([]);
      prisma.factureMensuelleEtablissement.create.mockResolvedValue({ id: 'fact-2' });
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({ id: 'fact-2', statut: 'SOUMISE', montantTotal: dec(0) });

      const res = await service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' });

      expect(prisma.ligneFacturation.updateMany).not.toHaveBeenCalled();
      expect(res.nbLignesIncluses).toBe(0);
      // Le filtre factureMensuelleEtablissementId: null est bien appliqué à la requête.
      expect(prisma.ligneFacturation.findMany.mock.calls[0][0].where.factureMensuelleEtablissementId).toBeNull();
    });

    it('réintègre une ligne reportée (litige résolu VALIDEE) indépendamment de son datePaiement d’origine', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
      prisma.ligneFacturation.findMany.mockResolvedValue([
        { id: 'lf-1', acteDossierId: 'acte-1', montantReclame: dec(1500) },
      ]);
      prisma.contestationActe.findMany.mockResolvedValue([]); // litige résolu (VALIDEE, plus dans la liste)
      prisma.factureMensuelleEtablissement.create.mockResolvedValue({ id: 'fact-3' });
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({ id: 'fact-3', statut: 'SOUMISE', montantTotal: dec(1500) });

      const res = await service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' });

      expect(prisma.ligneFacturation.findMany.mock.calls[0][0].where.OR).toEqual([
        { datePaiement: expect.anything() },
        { reporteeMoisSuivant: true },
      ]);
      expect(res.nbLignesIncluses).toBe(1);
    });

    it('réutilise (ne duplique pas) une facture EN_PREPARATION existante pour la même période (après un A_CORRIGER)', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({ id: 'fact-existante', statut: 'EN_PREPARATION' });
      prisma.ligneFacturation.findMany.mockResolvedValue([
        { id: 'lf-1', acteDossierId: 'acte-1', montantReclame: dec(3000) },
      ]);
      prisma.factureMensuelleEtablissement.update
        .mockResolvedValueOnce({ id: 'fact-existante', montantTotal: dec(3000) })
        .mockResolvedValueOnce({
          id: 'fact-existante',
          statut: 'SOUMISE',
          montantTotal: dec(3000),
          periode: new Date('2026-08-01'),
          dateSoumission: new Date(),
        });

      const res = await service.soumettreFactureMensuelleEtablissement(USER, { periode: '2026-08-01' });

      expect(prisma.factureMensuelleEtablissement.create).not.toHaveBeenCalled();
      expect(res.id).toBe('fact-existante');
    });
  });

  describe('verifierFactureMensuelleEtablissement', () => {
    it('rôle non autorisé (comptable assureur) → 403', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      await expect(
        service.verifierFactureMensuelleEtablissement(USER, 'fact-1', { decision: 'VALIDEE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.factureMensuelleEtablissement.findFirst).not.toHaveBeenCalled();
    });

    it('facture introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(null);
      await expect(
        service.verifierFactureMensuelleEtablissement(USER, 'fact-x', { decision: 'VALIDEE' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('facture pas SOUMISE (déjà vérifiée) → 409', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'VERIFIEE_MEDECIN_CONSEIL',
        lignes: [],
      });
      await expect(
        service.verifierFactureMensuelleEtablissement(USER, 'fact-1', { decision: 'VALIDEE' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('double sécurité : une ligne devenue en litige APRÈS soumission bloque la vérification (409)', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'SOUMISE',
        lignes: [{ id: 'lf-1', acteDossierId: 'acte-1' }, { id: 'lf-2', acteDossierId: 'acte-2' }],
      });
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-2' }]);

      await expect(
        service.verifierFactureMensuelleEtablissement(USER, 'fact-1', { decision: 'VALIDEE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.factureMensuelleEtablissement.update).not.toHaveBeenCalled();
    });

    it('VALIDEE → VERIFIEE_MEDECIN_CONSEIL quand aucune ligne incluse n’est en litige', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'SOUMISE',
        lignes: [{ id: 'lf-1', acteDossierId: 'acte-1' }],
      });
      prisma.contestationActe.findMany.mockResolvedValue([]);
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        statut: 'VERIFIEE_MEDECIN_CONSEIL',
        montantTotal: dec(6000),
      });

      const res = await service.verifierFactureMensuelleEtablissement(USER, 'fact-1', { decision: 'VALIDEE' });

      expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'VERIFIEE_MEDECIN_CONSEIL', verifieParId: 'u1' }),
        }),
      );
      expect(res.statut).toBe('VERIFIEE_MEDECIN_CONSEIL');
    });

    it('A_CORRIGER libère les lignes stampées et remet la facture à EN_PREPARATION', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'SOUMISE',
        lignes: [{ id: 'lf-1', acteDossierId: 'acte-1' }, { id: 'lf-2', acteDossierId: 'acte-2' }],
      });
      prisma.contestationActe.findMany.mockResolvedValue([]);
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        statut: 'EN_PREPARATION',
        montantTotal: dec(6000),
      });

      const res = await service.verifierFactureMensuelleEtablissement(USER, 'fact-1', { decision: 'A_CORRIGER' });

      expect(prisma.ligneFacturation.updateMany).toHaveBeenCalledWith({
        where: { factureMensuelleEtablissementId: 'fact-1' },
        data: { factureMensuelleEtablissementId: null },
      });
      expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'EN_PREPARATION', dateSoumission: null }),
        }),
      );
      expect(res.statut).toBe('EN_PREPARATION');
    });
  });

  describe('validerPourPaiementEtablissement / marquerFactureMensuelleEtablissementPayee', () => {
    it("réservé exclusivement à ASSUREUR_COMPTABLE — médecin conseil → 403", async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(
        service.validerPourPaiementEtablissement(USER, 'fact-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuse tant que non VERIFIEE_MEDECIN_CONSEIL', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({ id: 'fact-1', statut: 'SOUMISE', lignes: [] });
      await expect(
        service.validerPourPaiementEtablissement(USER, 'fact-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse si une ligne encore en litige non décochée subsiste', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'VERIFIEE_MEDECIN_CONSEIL',
        lignes: [{ id: 'lf-1', acteDossierId: 'acte-1' }],
      });
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-1' }]);
      await expect(
        service.validerPourPaiementEtablissement(USER, 'fact-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.factureMensuelleEtablissement.update).not.toHaveBeenCalled();
    });

    it('programme pour paiement une fois VERIFIEE_MEDECIN_CONSEIL et litige-free', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue({
        id: 'fact-1',
        statut: 'VERIFIEE_MEDECIN_CONSEIL',
        lignes: [],
      });
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        statut: 'PROGRAMMEE_PAIEMENT',
        montantTotal: dec(6000),
      });

      const res = await service.validerPourPaiementEtablissement(USER, 'fact-1');
      expect(res.statut).toBe('PROGRAMMEE_PAIEMENT');
    });

    // Le paiement RÉEL (marquerFactureMensuelleEtablissementPayee, symbolique,
    // retiré) est désormais couvert par `PaymentService.payerFacture`
    // (payment.service.spec.ts).
  });

  describe('decocherLigneContestee (établissement)', () => {
    const factureAvecLigne = (statut: string) => ({
      id: 'fact-1',
      statut,
      montantTotal: dec(6000),
      lignes: [{ id: 'lf-1', acteDossierId: 'acte-1', montantReclame: dec(1500) }],
    });

    it('rôle non autorisé (médecin établissement) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinEtab());
      await expect(
        service.decocherLigneContestee(USER, 'fact-1', 'lf-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('facture déjà PROGRAMMEE_PAIEMENT → 409 (trop tard)', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLigne('PROGRAMMEE_PAIEMENT'));
      await expect(
        service.decocherLigneContestee(USER, 'fact-1', 'lf-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ligne introuvable sur cette facture → 404', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
      await expect(
        service.decocherLigneContestee(USER, 'fact-1', 'lf-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ligne pas en litige → 400 (rien à retirer)', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
      prisma.contestationActe.findMany.mockResolvedValue([]);
      await expect(
        service.decocherLigneContestee(USER, 'fact-1', 'lf-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('retire la ligne en litige, recalcule le montant, marque reportée', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-1' }]);
      prisma.factureMensuelleEtablissement.update.mockResolvedValue({
        id: 'fact-1',
        montantTotal: dec(4500),
        nbLignesReportees: 1,
      });

      const res = await service.decocherLigneContestee(USER, 'fact-1', 'lf-1');

      expect(prisma.ligneFacturation.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: { factureMensuelleEtablissementId: null, reporteeMoisSuivant: true },
      });
      expect(prisma.factureMensuelleEtablissement.update).toHaveBeenCalledWith({
        where: { id: 'fact-1' },
        data: { montantTotal: '4500.00', nbLignesReportees: { increment: 1 } },
      });
      expect(res.montantTotal).toBe('4500.00');
    });
  });

  describe('obtenirFactureMensuelleEtablissement — verrou d’accès comptable', () => {
    const factureAvecLignes = (statut: string) => ({
      id: 'fact-1',
      etablissementId: 'etab-1',
      statut,
      montantTotal: dec(6000),
      nbLignesReportees: 0,
      dateSoumission: new Date(),
      dateVerification: null,
      dateProgrammation: null,
      datePaiement: null,
      etablissement: { nom: 'FARAH' },
      lignes: [],
    });

    it('comptable assureur accède désormais à toute facture, quel que soit son statut (accès en revue global)', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLignes('SOUMISE'));
      await expect(
        service.obtenirFactureMensuelleEtablissement(USER, 'fact-1'),
      ).resolves.toMatchObject({ statut: 'SOUMISE' });
    });

    it('comptable assureur → 200 une fois VERIFIEE_MEDECIN_CONSEIL', async () => {
      identity.getMe.mockResolvedValue(comptableAssureur());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLignes('VERIFIEE_MEDECIN_CONSEIL'));
      await expect(
        service.obtenirFactureMensuelleEtablissement(USER, 'fact-1'),
      ).resolves.toMatchObject({ statut: 'VERIFIEE_MEDECIN_CONSEIL' });
    });

    it("l'établissement concerné voit toujours SA facture, tout statut", async () => {
      identity.getMe.mockResolvedValue(comptableEtab('etab-1'));
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLignes('SOUMISE'));
      await expect(
        service.obtenirFactureMensuelleEtablissement(USER, 'fact-1'),
      ).resolves.toMatchObject({ statut: 'SOUMISE' });
    });

    it('un AUTRE établissement → 403', async () => {
      identity.getMe.mockResolvedValue(comptableEtab('etab-2'));
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLignes('SOUMISE'));
      await expect(
        service.obtenirFactureMensuelleEtablissement(USER, 'fact-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('le médecin conseil voit tout, tout statut', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.factureMensuelleEtablissement.findFirst.mockResolvedValue(factureAvecLignes('EN_PREPARATION'));
      await expect(
        service.obtenirFactureMensuelleEtablissement(USER, 'fact-1'),
      ).resolves.toMatchObject({ statut: 'EN_PREPARATION' });
    });
  });

  describe('listerActesDuMoisEtablissement', () => {
    it('rôle non autorisé (médecin) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinEtab());
      await expect(service.listerActesDuMoisEtablissement(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.acteDossier.findMany).not.toHaveBeenCalled();
    });

    it('renvoie les actes du mois en cours avec enLitige/dejaFacture', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.acteDossier.findMany.mockResolvedValue([
        {
          id: 'acte-1',
          categorieActe: 'CONSULTATION',
          libelle: 'Consultation généraliste',
          codeActe: null,
          montantPrescrit: dec(15000),
          statutPreautorisation: 'NON_REQUISE',
          datePrescription: new Date('2026-09-05'),
          dossier: { numeroTraitement: 'TRT-1', adherent: { nom: 'Yao', prenom: 'Awa' }, beneficiaire: null },
          lignesFacturation: [],
        },
        {
          id: 'acte-2',
          categorieActe: 'HOSPITALISATION',
          libelle: 'Hospitalisation',
          codeActe: null,
          montantPrescrit: dec(80000),
          statutPreautorisation: 'APPROUVEE',
          datePrescription: new Date('2026-09-10'),
          dossier: { numeroTraitement: 'TRT-2', adherent: { nom: 'Konan', prenom: 'Yves' }, beneficiaire: null },
          lignesFacturation: [{ statut: 'PAYE' }],
        },
      ]);
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-2' }]);

      const res = await service.listerActesDuMoisEtablissement(USER);

      expect(res).toEqual([
        expect.objectContaining({ id: 'acte-1', patient: 'Awa Yao', dejaFacture: false, enLitige: false }),
        expect.objectContaining({ id: 'acte-2', patient: 'Yves Konan', dejaFacture: true, enLitige: true }),
      ]);
    });
  });

  describe('listerFacturesDossierEtablissement', () => {
    it('rôle non autorisé (médecin) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinEtab());
      await expect(service.listerFacturesDossierEtablissement(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.factureDossier.findMany).not.toHaveBeenCalled();
    });

    it("scope strictement sur l'établissement de l'appelant", async () => {
      identity.getMe.mockResolvedValue(comptableEtab('etab-9'));
      prisma.factureDossier.findMany.mockResolvedValue([]);
      await service.listerFacturesDossierEtablissement(USER);
      expect(prisma.factureDossier.findMany.mock.calls[0][0].where).toMatchObject({ etablissementId: 'etab-9' });
    });

    it('renvoie société cliente + patient pour le filtrage multicritère côté client', async () => {
      identity.getMe.mockResolvedValue(comptableEtab());
      prisma.factureDossier.findMany.mockResolvedValue([
        {
          id: 'fd-1',
          statut: 'REGLEE',
          montantTotal: dec(15000),
          montantAssurance: dec(12000),
          montantPatient: dec(3000),
          createdAt: new Date('2026-08-01'),
          dateReglement: new Date('2026-08-05'),
          dossier: { numeroTraitement: 'TRT-1', police: { souscripteur: { nom: 'Société Alpha' } } },
          adherent: { nom: 'Yao', prenom: 'Awa' },
          beneficiaire: null,
        },
      ]);

      const res = await service.listerFacturesDossierEtablissement(USER);

      expect(res).toEqual([
        expect.objectContaining({ societeCliente: 'Société Alpha', patient: 'Awa Yao', statut: 'REGLEE' }),
      ]);
    });
  });
});
