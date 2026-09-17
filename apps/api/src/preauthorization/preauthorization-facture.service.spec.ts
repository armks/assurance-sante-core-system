import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';

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
    statutPreautorisation: 'NON_REQUISE',
    lignesFacturation: [],
    ...extra,
  };
}

describe('PreauthorizationService — Facturation par sélection d’actes (paiement partiel)', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      dossierSoins: { findFirst: jest.fn() },
      acteDossier: { findMany: jest.fn().mockResolvedValue([]) },
      garantie: { findMany: jest.fn().mockResolvedValue([]) },
      ligneFacturation: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      factureDossier: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
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

  describe('genererFactureSelection', () => {
    beforeEach(() => {
      prisma.factureDossier.create.mockImplementation(({ data }: any) => acteCreeParDefaut(data));
      prisma.garantie.findMany.mockResolvedValue([
        { categorieActe: 'CONSULTATION', tauxCouverture: dec(80), plafondParActe: null },
        { categorieActe: 'BIOLOGIE', tauxCouverture: dec(80), plafondParActe: null },
      ]);
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
          data: expect.objectContaining({ acteDossierId: 'acte-1', statut: 'A_PAYER', montantReclame: '25000.00' }),
        }),
      );
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

    it('EXCLUT automatiquement un acte EN_ATTENTE_VALIDATION même s’il est sélectionné', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossier());
      prisma.acteDossier.findMany.mockResolvedValue([
        acte('acte-ok', { montantPrescrit: dec(10000) }),
        acte('acte-attente', { montantPrescrit: dec(50000), categorieActe: 'BIOLOGIE', statutPreautorisation: 'EN_ATTENTE_VALIDATION' }),
      ]);

      const res = await service.genererFactureSelection(USER, 'dos-1', {
        acteIds: ['acte-ok', 'acte-attente'],
      });

      expect(res.montantTotal).toBe('10000.00');
      expect((res as any).acteIdsExclus).toEqual(['acte-attente']);
      expect(res.message).toMatch(/1 acte\(s\).*exclu/);
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
});
