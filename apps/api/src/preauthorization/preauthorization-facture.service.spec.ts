import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import {
  AdjudicationClientService,
  MESSAGES_INDISPONIBILITE,
} from '../adjudication-client/adjudication-client.service';
import {
  adjudicationClientDeTest,
  reponseSimulation,
} from '../adjudication-client/adjudication-client.testing';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const ADH = 'adh-1';

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

/** Prisma Decimal-like : suffit d'avoir toFixed / toString pour le service. */
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

/** Un acte facturable typique — surcharger au besoin dans chaque test. */
function acte(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    montantPrescrit: dec(10000),
    quantite: 1,
    categorieActe: 'CONSULTATION',
    codeActe: null,
    datePrescription: new Date('2026-09-01T10:00:00Z'),
    dateRealisation: new Date('2026-09-01T11:00:00Z'),
    statut: 'REALISE',
    statutPreautorisation: 'NON_REQUISE',
    lignesFacturation: [],
    ...extra,
  };
}

/** Microservice d'adjudication factice (simulation : 80 % par défaut). */
let adjudication: ReturnType<typeof adjudicationClientDeTest>;
beforeEach(() => {
  adjudication = adjudicationClientDeTest();
});

describe('PreauthorizationService — Facturation par sélection d’actes (paiement partiel)', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      dossierSoins: { findFirst: jest.fn() },
      acteDossier: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(({ where, data }: any) => ({ id: where.id, ...data })),
      },
      contestationActe: { findMany: jest.fn().mockResolvedValue([]) },
      // count : garanties à plafond FAMILLE du produit (verrou famille) — aucune par défaut
      garantie: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      ligneFacturation: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      factureDossier: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      beneficiaire: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AdjudicationClientService, useValue: adjudication },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: CareEpisodeService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PreauthorizationService);
  });

  const dossier = (extra: Record<string, unknown> = {}) => ({
    id: 'dos-1',
    organisationId: 'org-1',
    etablissementId: 'etab-1',
    adherentId: ADH,
    beneficiaireId: null,
    police: { produitId: 'prod-1' },
    ticket: { id: 'tkt-1', statut: 'OUVERT' },
    ...extra,
  });

  const acteCreeParDefaut = (data: any) => ({
    id: 'fac-1',
    ...data,
    montantTotal: dec(Number(data.montantTotal)),
    montantAssurance: dec(Number(data.montantAssurance)),
    montantPatient: dec(Number(data.montantPatient)),
  });

  describe('marquerActeRealise', () => {
    const OUVERTURE = new Date('2026-09-01T08:00:00Z');
    const acteEnBase = (extra: Record<string, unknown> = {}) => ({
      id: 'acte-1',
      statut: 'PRESCRIT',
      dossierSoinsId: 'dos-1',
      dossier: { organisationId: 'org-1', etablissementId: 'etab-1', dateOuverture: OUVERTURE },
      ticket: { statut: 'OUVERT' },
      ...extra,
    });
    const medecin = (extra: Record<string, unknown> = {}) =>
      profil('CENTRE_MEDICAL_MEDECIN', { etablissementId: 'etab-1', ...extra });

    it('médecin de l’établissement : PRESCRIT → REALISE, date = maintenant par défaut, audité', async () => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase());
      const avant = Date.now();

      const res = await service.marquerActeRealise(USER, 'acte-1', {});

      expect(res.statut).toBe('REALISE');
      expect(res.dateRealisation!.getTime()).toBeGreaterThanOrEqual(avant);
      expect(prisma.acteDossier.update).toHaveBeenCalledWith({
        where: { id: 'acte-1' },
        data: { statut: 'REALISE', dateRealisation: expect.any(Date) },
      });
      expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
    });

    it('date de réalisation antérieure à la saisie acceptée (acte fait avant d’être saisi)', async () => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase());

      const res = await service.marquerActeRealise(USER, 'acte-1', { dateRealisation: '2026-09-02T10:30:00Z' });
      expect(res.dateRealisation!.toISOString()).toBe('2026-09-02T10:30:00.000Z');
    });

    it.each([
      ['CENTRE_MEDICAL_ACCUEIL'],
      ['CENTRE_MEDICAL_COMPTABLE'],
      ['ASSUREUR_MEDECIN_CONSEIL'],
      ['ASSUREUR_INFORMATIQUE'],
    ])('%s → 403 (réservé au médecin traitant)', async (role) => {
      identity.getMe.mockResolvedValue(profil(role, { etablissementId: 'etab-1' }));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase());
      await expect(service.marquerActeRealise(USER, 'acte-1', {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.acteDossier.update).not.toHaveBeenCalled();
    });

    it('médecin d’un AUTRE établissement → 403', async () => {
      identity.getMe.mockResolvedValue(medecin({ etablissementId: 'etab-2' }));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase());
      await expect(service.marquerActeRealise(USER, 'acte-1', {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('acte d’une autre organisation → 404', async () => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(
        acteEnBase({ dossier: { organisationId: 'org-2', etablissementId: 'etab-1', dateOuverture: OUVERTURE } }),
      );
      await expect(service.marquerActeRealise(USER, 'acte-1', {})).rejects.toThrow('Acte introuvable.');
    });

    it.each([['REALISE'], ['ANNULE'], ['LIQUIDE']])('acte déjà %s → 409', async (statut) => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase({ statut }));
      await expect(service.marquerActeRealise(USER, 'acte-1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('ticket ANNULÉ → 409', async () => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase({ ticket: { statut: 'ANNULE' } }));
      await expect(service.marquerActeRealise(USER, 'acte-1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('date dans le futur, ou avant l’ouverture du dossier → 400', async () => {
      identity.getMe.mockResolvedValue(medecin());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnBase());
      const demain = new Date(Date.now() + 24 * 3600_000).toISOString();
      await expect(service.marquerActeRealise(USER, 'acte-1', { dateRealisation: demain })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.marquerActeRealise(USER, 'acte-1', { dateRealisation: '2026-08-31T23:00:00Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.acteDossier.update).not.toHaveBeenCalled();
    });
  });

  describe('genererFactureSelection', () => {
    beforeEach(() => {
      prisma.factureDossier.create.mockImplementation(({ data }: any) => acteCreeParDefaut(data));
      prisma.garantie.findMany.mockResolvedValue([
        { categorieActe: 'CONSULTATION', tauxCouverture: dec(80), plafondParActe: null },
        { categorieActe: 'ANALYSES', tauxCouverture: dec(80), plafondParActe: null },
      ]);
    });

    it('REFUSE explicitement un acte encore PRESCRIT (non réalisé) — 409, aucun cycle créé', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { statut: 'PRESCRIT' })]);

      const err = await service
        .genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        message: expect.stringContaining('marqué « réalisé »'),
        exclusions: [{ acteId: 'acte-1', motif: 'NON_REALISE' }],
      });
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
      expect(prisma.ligneFacturation.create).not.toHaveBeenCalled();
    });

    it('EXCLUT l’acte non réalisé d’une sélection mixte et ne facture que l’acte réalisé', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-1', { montantPrescrit: dec(15000) }),
        acte('acte-2', { statut: 'PRESCRIT' }),
      ]);

      const res: any = await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1', 'acte-2'] });

      expect(res.acteIdsInclus).toEqual(['acte-1']);
      expect(res.exclusions).toEqual([{ acteId: 'acte-2', motif: 'NON_REALISE' }]);
      expect(res.montantTotal).toBe('15000.00');
      expect(res.message).toContain('1 non marqué(s) « réalisé »');
      expect(prisma.ligneFacturation.create).toHaveBeenCalledTimes(1);
    });

    it('génère un cycle pour les actes sélectionnés, même si le ticket est encore OUVERT (facturation en cours de traitement)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(25000) })]);

      const res = await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      expect(res.montantTotal).toBe('25000.00');
      expect(res.montantAssurance).toBe('20000.00');
      expect(res.montantPatient).toBe('5000.00');
      expect(res.statut).toBe('EMISE');
      expect((res as any).code).toBeUndefined();
      expect(prisma.ligneFacturation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ acteDossierId: 'acte-1', statut: 'A_PAYER', montantReclame: '20000.00' }),
        }),
      );
    });

    it("chaque ligne réclame la PART ASSURANCE de son acte (jamais le montant total) — somme des lignes = montantAssurance", async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.garantie.findMany.mockResolvedValue([
        { categorieActe: 'CONSULTATION', tauxCouverture: dec(80), plafondParActe: null },
        { categorieActe: 'ANALYSES', tauxCouverture: dec(50), plafondParActe: dec(3000) },
      ]);
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-1', { montantPrescrit: dec(15000) }),
        acte('acte-2', { montantPrescrit: dec(10000), categorieActe: 'ANALYSES' }),
      ]);
      // calcul du microservice (ADR-005) : 80 % ; 50 % plafonné à 3 000
      adjudication.simuler.mockResolvedValueOnce(reponseSimulation(12000, 3000));

      const res = await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1', 'acte-2'] });

      // montants BRUTS envoyés, dans l'ordre des actes
      expect(adjudication.simuler.mock.calls[0][0].lignes.map((l: any) => [l.acte_dossier_id, l.montant]))
        .toEqual([['acte-1', '15000.00'], ['acte-2', '10000.00']]);
      const reclames = prisma.ligneFacturation.create.mock.calls.map((c: any) => c[0].data.montantReclame);
      expect(reclames).toEqual(['12000.00', '3000.00']);
      expect(res.montantAssurance).toBe('15000.00');
    });

    // --- Concurrence : verrou de la personne assurée (même clé que le Java) ---
    const appelsVerrou = () =>
      prisma.$executeRaw.mock.calls.filter((c: any) =>
        Array.isArray(c[0]) && c[0].join('?').includes('pg_advisory_xact_lock'),
      );

    it('pose le verrou de l’ADHÉRENT dans la transaction, AVANT de demander le calcul au microservice', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier({ policeId: 'pol-1' }));
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);

      await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      const verrous = appelsVerrou();
      expect(verrous).toHaveLength(1);
      expect(verrous[0][0].join('?')).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))');
      expect(verrous[0][1]).toBe(ADH);
      const ordreVerrou = prisma.$executeRaw.mock.invocationCallOrder[prisma.$executeRaw.mock.calls.indexOf(verrous[0])];
      expect(ordreVerrou).toBeLessThan(adjudication.simuler.mock.invocationCallOrder[0]);
      // la transaction couvre l'appel HTTP : délai supérieur au timeout du microservice
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: expect.any(Number) });
      expect(prisma.$transaction.mock.calls[0][1].timeout).toBeGreaterThan(12_000);
    });

    it('dossier d’un BÉNÉFICIAIRE : verrou sur le bénéficiaire (clé du Java)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(
        dossier({ adherentId: null, beneficiaireId: 'benef-1', policeId: 'pol-1' }),
      );
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);

      await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      expect(appelsVerrou()[0][1]).toBe('benef-1');
    });

    it('produit AVEC plafond famille : verrou sur le TITULAIRE du bénéficiaire (famille, clé du Java)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(
        dossier({ adherentId: null, beneficiaireId: 'benef-1', policeId: 'pol-1' }),
      );
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);
      prisma.garantie.count.mockResolvedValue(1);
      prisma.beneficiaire.findUnique.mockResolvedValue({ adherentId: ADH });

      await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      expect(prisma.garantie.count).toHaveBeenCalledWith({
        where: { produitId: 'prod-1', deletedAt: null, plafondAnnuelFamille: { not: null } },
      });
      expect(appelsVerrou()[0][1]).toBe(ADH);
    });

    it('deux BÉNÉFICIAIRES d’une même famille (plafond famille) : même clé, leurs factures sont sérialisées', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.garantie.count.mockResolvedValue(1);
      prisma.beneficiaire.findUnique.mockResolvedValue({ adherentId: ADH });
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);

      for (const beneficiaireId of ['benef-1', 'benef-2']) {
        prisma.dossierSoins.findFirst.mockResolvedValueOnce(
          dossier({ adherentId: null, beneficiaireId, policeId: 'pol-1' }),
        );
        await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });
      }

      expect(appelsVerrou().map((c: any) => c[1])).toEqual([ADH, ADH]);
    });

    it('produit SANS plafond famille : le bénéficiaire garde son propre verrou (aucune lecture du titulaire)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(
        dossier({ adherentId: null, beneficiaireId: 'benef-1', policeId: 'pol-1' }),
      );
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);

      await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      expect(appelsVerrou()[0][1]).toBe('benef-1');
      expect(prisma.beneficiaire.findUnique).not.toHaveBeenCalled();
    });

    it('microservice indisponible → 503 avec un message clair en français, sans détail technique ; aucune facture', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier({ policeId: 'pol-1' }));
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1', { montantPrescrit: dec(10000) })]);
      adjudication.simuler.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED 127.0.0.1:8899'));

      const err = await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] }).catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.message).toBe(MESSAGES_INDISPONIBILITE.facturation);
      expect(err.message).not.toMatch(/microservice|ECONNREFUSED|8899|HTTP/i);
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
    });

    it('somme correctement PLUSIEURS actes sélectionnés (paiement partiel — 2 sur 3)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-1', { montantPrescrit: dec(10000) }),
        acte('acte-2', { montantPrescrit: dec(15000) }),
      ]);

      const res = await service.genererFactureSelection(USER, 'dos-1', {
        acteIds: ['acte-1', 'acte-2'],
      });

      expect(res.montantTotal).toBe('25000.00');
      expect((res as any).acteIdsInclus).toEqual(['acte-1', 'acte-2']);
      expect(prisma.ligneFacturation.create).toHaveBeenCalledTimes(2);
    });

    it('EXCLUT automatiquement un acte EN_ATTENTE_EXPLOITATION même s’il est sélectionné', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-ok', { montantPrescrit: dec(10000) }),
        acte('acte-attente', { montantPrescrit: dec(50000), categorieActe: 'ANALYSES', statutPreautorisation: 'EN_ATTENTE_EXPLOITATION' }),
      ]);

      const res = await service.genererFactureSelection(USER, 'dos-1', {
        acteIds: ['acte-ok', 'acte-attente'],
      });

      expect(res.montantTotal).toBe('10000.00');
      expect((res as any).acteIdsExclus).toEqual(['acte-attente']);
      expect(res.message).toMatch(/1 acte\(s\).*exclu/);
    });

    it('EXCLUT automatiquement un acte EN LITIGE (contestation ouverte) même s’il est sélectionné', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-ok', { montantPrescrit: dec(10000) }),
        acte('acte-conteste', { montantPrescrit: dec(50000), categorieActe: 'ANALYSES' }),
      ]);
      prisma.contestationActe.findMany.mockResolvedValue([{ acteDossierId: 'acte-conteste' }]);

      const res = await service.genererFactureSelection(USER, 'dos-1', {
        acteIds: ['acte-ok', 'acte-conteste'],
      });

      expect(res.montantTotal).toBe('10000.00');
      expect((res as any).acteIdsExclus).toEqual(['acte-conteste']);
      expect(res.message).toMatch(/en litige/);
    });

    it('EXCLUT automatiquement un acte déjà PAYE même s’il est resélectionné', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-paye', { lignesFacturation: [{ id: 'lf-1', statut: 'PAYE' }] }),
      ]);

      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-paye'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
    });

    it('REFUSE (409) si AUCUN acte sélectionné n’est facturable', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-refuse', { statutPreautorisation: 'REFUSEE' }),
      ]);

      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-refuse'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('réattache une ligne A_PAYER orpheline (cycle abandonné) au lieu d’en créer une seconde', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-1', { montantPrescrit: dec(12000), lignesFacturation: [{ id: 'lf-orpheline', statut: 'A_PAYER' }] }),
      ]);

      await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });

      expect(prisma.ligneFacturation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lf-orpheline' },
          data: expect.objectContaining({ factureDossierId: 'fac-1' }),
        }),
      );
      expect(prisma.ligneFacturation.create).not.toHaveBeenCalled();
    });

    it('rejette un acteId qui n’appartient pas à ce dossier (pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([]); // l'ID demandé n'existe pas dans CE dossier

      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-etranger'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
    });

    it('ticket ANNULE → facturation impossible', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier({ ticket: { id: 'tkt-1', statut: 'ANNULE' } }));

      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('CENTRE_MEDICAL_COMPTABLE de l’établissement du dossier → OK', async () => {
      identity.getMe.mockResolvedValue(profil('CENTRE_MEDICAL_COMPTABLE', { etablissementId: 'etab-1' }));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([acte('acte-1')]);

      const res = await service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] });
      expect(res.statut).toBe('EMISE');
    });

    it('CENTRE_MEDICAL_COMPTABLE d’un AUTRE établissement → 403', async () => {
      identity.getMe.mockResolvedValue(profil('CENTRE_MEDICAL_COMPTABLE', { etablissementId: 'autre-etab' }));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());

      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
    });

    it('CENTRE_MEDICAL_MEDECIN → 403 (rôle non habilité à facturer)', async () => {
      identity.getMe.mockResolvedValue(profil('CENTRE_MEDICAL_MEDECIN', { etablissementId: 'etab-1' }));
      await expect(
        service.genererFactureSelection(USER, 'dos-1', { acteIds: ['acte-1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.dossierSoins.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---- LE test à ne pas rater : garde bloquante de paiement ----

  it('confirmerPaiement AVANT validation du code → ForbiddenException (appel direct du service)', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_COMPTABLE'));
    prisma.factureDossier.findFirst.mockResolvedValue({
      id: 'fac-1',
      organisationId: 'org-1',
      statut: 'EMISE',
      codeValideParPatient: false,
      montantAssurance: dec(20000),
      montantPatient: dec(5000),
    });

    await expect(
      service.confirmerPaiement(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.confirmerPaiement(USER, 'fac-1'),
    ).rejects.toThrow(/n'a pas été validé par l'adhérent/);
    expect(prisma.factureDossier.update).not.toHaveBeenCalled();
  });

  it('confirmerPaiement par un rôle ≠ ASSUREUR_COMPTABLE → 403', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
    await expect(
      service.confirmerPaiement(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.factureDossier.findFirst).not.toHaveBeenCalled();
  });

  it('validerCodeFacturation par l’adhérent concerné → code_valide_par_patient = true', async () => {
    identity.getMe.mockResolvedValue(
      profil('ADHERENT_TITULAIRE', { adherentId: ADH }),
    );
    prisma.factureDossier.findUnique.mockResolvedValue({
      id: 'fac-1',
      organisationId: 'org-1',
      adherentId: ADH,
      statut: 'EMISE',
      codeValideParPatient: false,
    });
    prisma.factureDossier.update.mockImplementation(({ data }: any) => ({
      id: 'fac-1',
      statut: data.statut,
      montantPatient: dec(5000),
      ...data,
    }));

    const res = await service.validerCodeFacturation(USER, { code: 'AB23CD45' });
    expect(res.codeValideParPatient).toBe(true);
    expect(res.statut).toBe('VALIDEE');
  });

  it('validerCodeFacturation par un rôle non-adhérent (établissement) → 403', async () => {
    identity.getMe.mockResolvedValue(
      profil('CENTRE_MEDICAL_ADMINISTRATIF', { etablissementId: 'etab-1' }),
    );
    await expect(
      service.validerCodeFacturation(USER, { code: 'AB23CD45' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('confirmerPaiement — marque uniquement les lignes du cycle, expose le solde restant', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_COMPTABLE'));
      prisma.factureDossier.findFirst.mockResolvedValue({
        id: 'fac-1',
        dossierSoinsId: 'dos-1',
        organisationId: 'org-1',
        statut: 'VALIDEE',
        codeValideParPatient: true,
        montantAssurance: dec(20000),
        montantPatient: dec(5000),
      });
      prisma.factureDossier.update.mockImplementation(({ data }: any) => ({
        id: 'fac-1',
        dossierSoinsId: 'dos-1',
        statut: data.statut,
        montantAssurance: dec(20000),
        montantPatient: dec(5000),
        dateReglement: new Date(),
        ...data,
      }));
    });

    it('confirmerPaiement APRÈS validation → REGLEE, lignes de CE cycle marquées PAYE', async () => {
      prisma.acteDossier.findMany.mockResolvedValue([]); // solde nul après paiement

      const res = await service.confirmerPaiement(USER, 'fac-1');

      expect(res.statut).toBe('REGLEE');
      expect(prisma.factureDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'REGLEE', reglePar: 'u1' }),
        }),
      );
      expect(prisma.ligneFacturation.updateMany).toHaveBeenCalledWith({
        where: { factureDossierId: 'fac-1', statut: 'A_PAYER' },
        data: expect.objectContaining({ statut: 'PAYE' }),
      });
      expect((res as any).soldeRestantDu).toBe('0.00');
    });

    it('expose le solde restant dû (actes jamais sélectionnés ou pas encore payés)', async () => {
      // `calculerSoldeRestantDu` ne relit que les actes dont AUCUNE ligne
      // n'est à PAYE (filtré côté requête réelle) — on simule ici le résultat
      // déjà filtré : un seul acte reste non réglé.
      prisma.acteDossier.findMany.mockResolvedValue([
        { ...acte('acte-non-paye', { montantPrescrit: dec(7000) }), lignesFacturation: [] },
      ]);

      const res = await service.confirmerPaiement(USER, 'fac-1');
      expect((res as any).soldeRestantDu).toBe('7000.00');
    });
  });

  it('confirmerPaiement sur une facture déjà REGLEE → 409', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_COMPTABLE'));
    prisma.factureDossier.findFirst.mockResolvedValue({
      id: 'fac-1',
      organisationId: 'org-1',
      statut: 'REGLEE',
      codeValideParPatient: true,
      montantAssurance: dec(20000),
      montantPatient: dec(5000),
    });
    await expect(
      service.confirmerPaiement(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  obtenirFacture — fuite inter-adhérent corrigée (audit dashboard
  //  adhérent) : ne vérifiait QUE organisationId, exposait montants +
  //  adherentId à n'importe quel compte de l'organisation.
  // ═══════════════════════════════════════════════════════════════════
  const FACTURE = {
    id: 'fac-1',
    organisationId: 'org-1',
    adherentId: ADH,
    etablissementId: 'etab-1',
    statut: 'EMISE',
    codeFacturation: 'AB23CD45',
    codeValideParPatient: false,
    montantTotal: dec(25000),
    montantAssurance: dec(20000),
    montantPatient: dec(5000),
  };

  it('obtenirFacture par l’adhérent propriétaire → 200, code inclus', async () => {
    identity.getMe.mockResolvedValue(
      profil('ADHERENT_TITULAIRE', { adherentId: ADH }),
    );
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE);
    const res = await service.obtenirFacture(USER, 'fac-1');
    expect((res as any).codeFacturation).toBe('AB23CD45');
  });

  it('obtenirFacture par un AUTRE adhérent de la même organisation → 403 (pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      profil('ADHERENT_TITULAIRE', { adherentId: 'adh-2' }),
    );
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE);
    await expect(
      service.obtenirFacture(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('obtenirFacture par ASSUREUR_EXPLOITATION (staff habilité) → 200, code masqué', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_EXPLOITATION'));
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE);
    const res = await service.obtenirFacture(USER, 'fac-1');
    expect((res as any).codeFacturation).toBeUndefined();
    expect(res.montantTotal).toBeDefined();
  });

  it('obtenirFacture par CENTRE_MEDICAL_COMPTABLE d’un AUTRE établissement → 403', async () => {
    identity.getMe.mockResolvedValue(
      profil('CENTRE_MEDICAL_COMPTABLE', { etablissementId: 'autre-etab' }),
    );
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE);
    await expect(
      service.obtenirFacture(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('obtenirFacture par CENTRE_MEDICAL_MEDECIN (non habilité facturation) → 403', async () => {
    identity.getMe.mockResolvedValue(
      profil('CENTRE_MEDICAL_MEDECIN', { etablissementId: 'etab-1' }),
    );
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE);
    await expect(
      service.obtenirFacture(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Couverture bénéficiaires (audit du 2026-09-24) : obtenirFacture ne
  //  vérifiait que `ctx.adherentId === facture.adherentId`, refusant l'accès
  //  à l'adhérent consultant la facture d'un de ses propres bénéficiaires
  //  (adherentId alors null, beneficiaireId renseigné) — même incohérence que
  //  chargerCodeAdherent.
  // ═══════════════════════════════════════════════════════════════════════
  const FACTURE_BENEFICIAIRE = {
    ...FACTURE,
    adherentId: null,
    beneficiaireId: 'ben-1',
  };

  it('obtenirFacture par l’adhérent pour la facture de SON bénéficiaire → 200, code inclus', async () => {
    identity.getMe.mockResolvedValue(profil('ADHERENT_TITULAIRE', { adherentId: ADH }));
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE_BENEFICIAIRE);
    prisma.beneficiaire.findFirst.mockResolvedValue({ id: 'ben-1' });

    const res = await service.obtenirFacture(USER, 'fac-1');

    expect(prisma.beneficiaire.findFirst).toHaveBeenCalledWith({
      where: { id: 'ben-1', adherentId: ADH, deletedAt: null },
      select: { id: true },
    });
    expect((res as any).codeFacturation).toBe('AB23CD45');
  });

  it('obtenirFacture pour la facture du bénéficiaire d’un AUTRE adhérent → 403 (pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(profil('ADHERENT_TITULAIRE', { adherentId: 'adh-2' }));
    prisma.factureDossier.findFirst.mockResolvedValue(FACTURE_BENEFICIAIRE);
    prisma.beneficiaire.findFirst.mockResolvedValue(null); // ben-1 n'appartient pas à adh-2

    await expect(
      service.obtenirFacture(USER, 'fac-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Couverture bénéficiaires (audit dashboard adhérent) : `listerMesFactures`
  //  ne filtrait QUE `adherentId` — une facture ouverte pour un bénéficiaire
  //  (adherentId = null) n'apparaissait jamais.
  // ═══════════════════════════════════════════════════════════════════════
  it('listerMesFactures inclut les factures de SES bénéficiaires (couverture bénéficiaires)', async () => {
    identity.getMe.mockResolvedValue(profil('ADHERENT_TITULAIRE', { adherentId: ADH }));
    prisma.beneficiaire.findMany.mockResolvedValue([{ id: 'ben-1' }]);

    await service.listerMesFactures(USER);

    expect(prisma.beneficiaire.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ adherentId: ADH }) }),
    );
    expect(prisma.factureDossier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ adherentId: ADH }, { beneficiaireId: { in: ['ben-1'] } }],
          deletedAt: null,
        },
      }),
    );
  });
});
