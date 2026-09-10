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

function medecin(id = 'med-1', etab = 'etab-1') {
  return {
    profil: { id, organisationId: 'org-1', role: 'CENTRE_MEDICAL_MEDECIN', adherentId: null, etablissementId: etab, pharmacieId: null },
    permissions: { roleChain: ['CENTRE_MEDICAL_MEDECIN'] },
  };
}
function adherent(adh = 'adh-1') {
  return {
    profil: { id: 'a1', organisationId: 'org-1', role: 'ADHERENT_TITULAIRE', adherentId: adh, etablissementId: null, pharmacieId: null },
    permissions: { roleChain: ['ADHERENT_TITULAIRE'] },
  };
}
function pharmacien(pharm = 'pharm-1') {
  return {
    profil: { id: 'p1', organisationId: 'org-1', role: 'PHARMACIE_PHARMACIEN', adherentId: null, etablissementId: null, pharmacieId: pharm },
    permissions: { roleChain: ['PHARMACIE_PHARMACIEN'] },
  };
}

const DANS_7J = new Date(Date.now() + 7 * 86400 * 1000);
const LIGNES = [{ medicament: 'Amoxicilline', dosage: '500 mg', posologie: '1 gél. x3/j, 7 j' }];

describe('PreauthorizationService — Code Référence d’Ordonnance', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      consultationDossier: { findFirst: jest.fn() },
      ordonnance: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      codeOrdonnance: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      codeConsultation: { findUnique: jest.fn().mockResolvedValue(null) },
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

  const consultationOk = {
    id: 'cons-1',
    medecinId: 'med-1',
    statut: 'EN_COURS',
    dossier: {
      id: 'dos-1',
      organisationId: 'org-1',
      etablissementId: 'etab-1',
      adherentId: 'adh-1',
      beneficiaireId: null,
      numeroTraitement: 'TRT-2026-09-000001',
    },
  };

  it('refuse si le médecin de l’ordonnance ≠ médecin de la consultation', async () => {
    identity.getMe.mockResolvedValue(medecin('med-1'));
    prisma.consultationDossier.findFirst.mockResolvedValue({
      ...consultationOk,
      medecinId: 'med-AUTRE',
    });

    await expect(
      service.creerOrdonnance(USER, {
        consultationId: 'cons-1',
        medecinId: 'med-1',
        lignes: LIGNES,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ordonnance.create).not.toHaveBeenCalled();
  });

  it('crée l’ordonnance + le code dans la même transaction, et NE renvoie PAS le code', async () => {
    identity.getMe.mockResolvedValue(medecin('med-1'));
    prisma.consultationDossier.findFirst.mockResolvedValue(consultationOk);
    prisma.ordonnance.create.mockResolvedValue({
      id: 'ord-1',
      statut: 'ACTIVE',
      dateValidite: DANS_7J,
    });
    prisma.codeOrdonnance.create.mockImplementation(({ data }: any) => ({
      id: 'code-1',
      ...data,
    }));

    const res = await service.creerOrdonnance(USER, {
      consultationId: 'cons-1',
      medecinId: 'med-1',
      lignes: LIGNES,
    });

    expect(prisma.ordonnance.create).toHaveBeenCalled();
    expect(prisma.codeOrdonnance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ordonnanceId: 'ord-1',
          adherentId: 'adh-1',
          statut: 'EMIS',
        }),
      }),
    );
    expect(res).toMatchObject({ ordonnanceId: 'ord-1', nombreLignes: 1 });
    expect((res as any).code).toBeUndefined();
  });

  it('l’adhérent récupère ses codes AVEC la valeur du code', async () => {
    identity.getMe.mockResolvedValue(adherent('adh-1'));
    prisma.codeOrdonnance.findMany.mockResolvedValue([
      { id: 'code-1', ordonnanceId: 'ord-1', code: 'AB23CD45', statut: 'EMIS', dateEmission: new Date(), dateExpiration: DANS_7J },
    ]);

    const res = await service.listerMesCodesOrdonnance(USER);
    expect(res[0].code).toBe('AB23CD45');
  });

  it('VALIDATION par la pharmacie : code inconnu → 404', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.codeOrdonnance.findUnique.mockResolvedValue(null);

    await expect(
      service.validerCodeOrdonnance(USER, { code: 'AB23CD45', pharmacieId: 'pharm-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('VALIDATION OK → révèle les lignes de l’ordonnance et marque PRESENTE_PHARMACIE', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.codeOrdonnance.findUnique.mockResolvedValue({
      id: 'code-1',
      code: 'AB23CD45',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: DANS_7J,
      ordonnanceId: 'ord-1',
      pharmacieUtilisatriceId: null,
    });
    prisma.ordonnance.findUnique.mockResolvedValue({
      id: 'ord-1',
      statut: 'ACTIVE',
      datePrescription: new Date(),
      dateValidite: DANS_7J,
      medecinId: 'med-1',
      lignes: LIGNES,
      deletedAt: null,
      dossier: { numeroTraitement: 'TRT-2026-09-000001' },
      medecin: { id: 'med-1', role: 'CENTRE_MEDICAL_MEDECIN' },
    });

    const res = await service.validerCodeOrdonnance(USER, {
      code: 'ab23cd45',
      pharmacieId: 'pharm-1',
    });

    expect(res.ordonnance.lignes).toEqual(LIGNES);
    expect(res.code.statut).toBe('PRESENTE_PHARMACIE');
    expect(prisma.codeOrdonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'PRESENTE_PHARMACIE',
          pharmacieUtilisatriceId: 'pharm-1',
        }),
      }),
    );
  });

  it('VALIDATION d’un code déjà UTILISE_COMPLET → 409', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.codeOrdonnance.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'UTILISE_COMPLET',
      dateExpiration: DANS_7J,
      ordonnanceId: 'ord-1',
      pharmacieUtilisatriceId: 'pharm-1',
    });

    await expect(
      service.validerCodeOrdonnance(USER, { code: 'AB23CD45', pharmacieId: 'pharm-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('VALIDATION par une AUTRE pharmacie que celle qui a pris en charge → 403', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
    prisma.codeOrdonnance.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'PRESENTE_PHARMACIE',
      dateExpiration: DANS_7J,
      ordonnanceId: 'ord-1',
      pharmacieUtilisatriceId: 'pharm-1',
    });

    await expect(
      service.validerCodeOrdonnance(USER, { code: 'AB23CD45', pharmacieId: 'pharm-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DISPENSATION complète → code UTILISE_COMPLET + ordonnance COMPLETEMENT_DELIVREE', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.codeOrdonnance.findFirst.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'PRESENTE_PHARMACIE',
      pharmacieUtilisatriceId: 'pharm-1',
      ordonnanceId: 'ord-1',
    });

    const res = await service.marquerDispensation(USER, 'code-1', { type: 'COMPLETE' });

    expect(prisma.codeOrdonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'UTILISE_COMPLET' } }),
    );
    expect(prisma.ordonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'COMPLETEMENT_DELIVREE' } }),
    );
    expect(res.code.statut).toBe('UTILISE_COMPLET');
  });
});
