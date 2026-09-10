import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
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

describe('PreauthorizationService — Code de Facturation (garde de paiement)', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticketSoins: { findFirst: jest.fn() },
      acteDossier: { findMany: jest.fn().mockResolvedValue([]) },
      garantie: { findMany: jest.fn().mockResolvedValue([]) },
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

  const ticket = (statut: string, facture: unknown = null) => ({
    id: 'tkt-1',
    statut,
    dossierSoinsId: 'dos-1',
    facture,
    dossier: {
      organisationId: 'org-1',
      etablissementId: 'etab-1',
      adherentId: ADH,
      beneficiaireId: null,
      police: { produitId: 'prod-1' },
    },
  });

  it('REFUSE genererFacture si le ticket est encore OUVERT', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));

    await expect(service.genererFacture(USER, 'tkt-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.factureDossier.create).not.toHaveBeenCalled();
  });

  it('genererFacture sur ticket CLOTURE → facture EMISE, montants calculés, code NON renvoyé', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_INFORMATIQUE'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('CLOTURE'));
    prisma.acteDossier.findMany.mockResolvedValue([
      { montantPrescrit: dec(25000), quantite: 1, categorieActe: 'CONSULTATION' },
    ]);
    prisma.garantie.findMany.mockResolvedValue([
      { categorieActe: 'CONSULTATION', tauxCouverture: dec(80), plafondParActe: null },
    ]);
    prisma.factureDossier.create.mockImplementation(({ data }: any) => ({
      id: 'fac-1',
      ...data,
      montantTotal: dec(Number(data.montantTotal)),
      montantAssurance: dec(Number(data.montantAssurance)),
      montantPatient: dec(Number(data.montantPatient)),
    }));

    const res = await service.genererFacture(USER, 'tkt-1');

    expect(res.montantTotal).toBe('25000.00');
    expect(res.montantAssurance).toBe('20000.00');
    expect(res.montantPatient).toBe('5000.00');
    expect(res.statut).toBe('EMISE');
    expect((res as any).code).toBeUndefined();
    expect((res as any).codeFacturation).toBeUndefined();
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

  it('confirmerPaiement APRÈS validation → REGLEE', async () => {
    identity.getMe.mockResolvedValue(profil('ASSUREUR_COMPTABLE'));
    prisma.factureDossier.findFirst.mockResolvedValue({
      id: 'fac-1',
      organisationId: 'org-1',
      statut: 'VALIDEE',
      codeValideParPatient: true,
      montantAssurance: dec(20000),
      montantPatient: dec(5000),
    });
    prisma.factureDossier.update.mockImplementation(({ data }: any) => ({
      id: 'fac-1',
      statut: data.statut,
      montantAssurance: dec(20000),
      montantPatient: dec(5000),
      dateReglement: new Date(),
      ...data,
    }));

    const res = await service.confirmerPaiement(USER, 'fac-1');
    expect(res.statut).toBe('REGLEE');
    expect(prisma.factureDossier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'REGLEE', reglePar: 'u1' }),
      }),
    );
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
});
