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

/** Microservice d'adjudication factice (simulation : 80 % par défaut). */
let adjudication: ReturnType<typeof adjudicationClientDeTest>;
beforeEach(() => {
  adjudication = adjudicationClientDeTest();
});

describe('PreauthorizationService — Code Référence d’Ordonnance', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      consultationDossier: { findFirst: jest.fn() },
      medicament: { findMany: jest.fn().mockResolvedValue([]) },
      ordonnance: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      ligneOrdonnance: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      codeOrdonnance: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      codeConsultation: { findUnique: jest.fn().mockResolvedValue(null) },
      beneficiaire: { findMany: jest.fn().mockResolvedValue([]) },
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

  const consultationOk = {
    id: 'cons-1',
    medecinId: 'med-1',
    statut: 'EN_COURS',
    dossier: {
      id: 'dos-1',
      organisationId: 'org-1',
      etablissementId: 'etab-1',
      statut: 'OUVERT',
      adherentId: 'adh-1',
      beneficiaireId: null,
      numeroTraitement: 'TRT-2026-09-000001',
    },
  };

  describe('accueil / administratif : prescription et recherche de médicaments', () => {
    const personnel = (role: string, etab = 'etab-1') => ({
      profil: { id: 'u-acc', organisationId: 'org-1', role, adherentId: null, etablissementId: etab, pharmacieId: null },
      permissions: { roleChain: [role] },
    });
    const creer = () =>
      service.creerOrdonnance(USER, {
        consultationId: 'cons-1',
        medecinId: 'med-1',
        lignes: [{ medicament: 'Paracétamol (Doliprane)', dosage: '500 mg', posologie: '1 cp x3/j', duree: '5 jours', quantite: 2 }],
      });

    it.each(['CENTRE_MEDICAL_ACCUEIL', 'CENTRE_MEDICAL_ADMINISTRATIF'])('%s de l’établissement établit l’ordonnance du médecin de la consultation', async (role) => {
      identity.getMe.mockResolvedValue(personnel(role));
      prisma.consultationDossier.findFirst.mockResolvedValue(consultationOk);
      prisma.ordonnance.create.mockResolvedValue({ id: 'ord-1', statut: 'ACTIVE', dateValidite: DANS_7J });
      prisma.codeOrdonnance.create.mockImplementation(({ data }: any) => ({ id: 'code-1', ...data }));
      const res = await creer();
      expect(res).toMatchObject({ ordonnanceId: 'ord-1', nombreLignes: 1 });
      expect(prisma.ligneOrdonnance.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ denominationMedicament: 'Paracétamol (Doliprane)', dosage: '500 mg', posologie: '1 cp x3/j', duree: '5 jours', quantitePrescrite: 2 })],
      });
    });

    it('accueil d’un AUTRE établissement → 403', async () => {
      identity.getMe.mockResolvedValue(personnel('CENTRE_MEDICAL_ACCUEIL', 'etab-2'));
      prisma.consultationDossier.findFirst.mockResolvedValue(consultationOk);
      await expect(creer()).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ordonnance.create).not.toHaveBeenCalled();
    });

    it.each(['CLOTURE', 'SUSPENDU', 'FORCE_CLOS'])('dossier %s : aucune ordonnance (409)', async (statut) => {
      identity.getMe.mockResolvedValue(personnel('CENTRE_MEDICAL_ACCUEIL'));
      prisma.consultationDossier.findFirst.mockResolvedValue({ ...consultationOk, dossier: { ...consultationOk.dossier, statut } });
      await expect(creer()).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.ordonnance.create).not.toHaveBeenCalled();
    });

    it('recherche de médicaments : catalogue NATIONAL homologué (sans condition d’activation), sans accent, 2 caractères minimum, AUCUN prix dans la réponse', async () => {
      identity.getMe.mockResolvedValue(personnel('CENTRE_MEDICAL_ACCUEIL'));
      prisma.$queryRaw = jest.fn().mockResolvedValue([
        { id: 'nat-1', denomination_commune: 'Paracétamol', nom_commercial: 'Doliprane', dosage: '500 mg', forme: 'Comprimé', conditionnement: 'Boîte de 16' },
      ]);
      expect(await service.rechercherMedicamentsCatalogue(USER, ' p ')).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      const res = await service.rechercherMedicamentsCatalogue(USER, 'parac');
      expect(res).toEqual([{ id: 'nat-1', denominationCommune: 'Paracétamol', nomCommercial: 'Doliprane', dosage: '500 mg', forme: 'Comprimé', conditionnement: 'Boîte de 16' }]);
      const { sql, values } = prisma.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
      expect(sql).toMatch(/FROM referentiel_national_medicaments n/);
      expect(sql).toMatch(/n\.statut_homologation = 'HOMOLOGUE'/);
      // prescrire n'est pas rembourser : aucune condition d'activation par l'organisation
      expect(sql).not.toMatch(/FROM medicaments m/);
      // casse et accents ignorés : « paracétamol » doit trouver « Paracetamol »
      expect(sql).toMatch(/public\.sans_accent/);
      expect(values).toEqual(expect.arrayContaining(['parac']));
      // seuls les champs d'identification sont lus : aucun prix, aucun taux
      const colonnes = sql.slice(sql.indexOf('SELECT'), sql.indexOf('FROM'));
      expect(colonnes).not.toMatch(/prix|taux|rembours/i);
      expect(JSON.stringify(res)).not.toMatch(/prix|taux|remboursement/i);
    });

    it.each(['CENTRE_MEDICAL_COMPTABLE', 'ASSUREUR_INFORMATIQUE', 'PHARMACIE_PHARMACIEN'])('%s ne recherche pas de médicament à prescrire (403)', async (role) => {
      identity.getMe.mockResolvedValue(personnel(role));
      await expect(service.rechercherMedicamentsCatalogue(USER, 'parac')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

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
    expect(res.items[0].code).toBe('AB23CD45');
  });

  it('inclut les codes d’ordonnance émis pour SES bénéficiaires (couverture bénéficiaires)', async () => {
    identity.getMe.mockResolvedValue(adherent('adh-1'));
    prisma.codeOrdonnance.findMany.mockResolvedValue([]);
    prisma.beneficiaire.findMany.mockResolvedValue([{ id: 'ben-1' }]);

    await service.listerMesCodesOrdonnance(USER);

    expect(prisma.codeOrdonnance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ adherentId: 'adh-1' }, { beneficiaireId: { in: ['ben-1'] } }] },
      }),
    );
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
      lignesOrdonnance: [
        {
          denominationMedicament: 'Amoxicilline',
          dosage: '500 mg',
          posologie: '1 gél. x3/j, 7 j',
          duree: null,
          quantitePrescrite: 1,
          statut: 'DISPONIBLE',
        },
      ],
      deletedAt: null,
      dossier: { numeroTraitement: 'TRT-2026-09-000001' },
      medecin: { id: 'med-1', role: 'CENTRE_MEDICAL_MEDECIN' },
    });

    const res = await service.validerCodeOrdonnance(USER, {
      code: 'ab23cd45',
      pharmacieId: 'pharm-1',
    });

    expect(res.ordonnance.lignes).toEqual([
      {
        medicament: 'Amoxicilline',
        dosage: '500 mg',
        posologie: '1 gél. x3/j, 7 j',
        duree: null,
        quantite: 1,
        statut: 'DISPONIBLE',
      },
    ]);
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

  // ═══════════════════════════════════════════════════════════════════════
  //  listerCodesOrdonnancePharmacie (audit dashboard pharmacie) — nouvel
  //  endpoint, scope strict sur ctx.pharmacieId, jamais un paramètre client.
  // ═══════════════════════════════════════════════════════════════════════
  it('liste les codes pris en charge par SA PROPRE pharmacie (scope ctx.pharmacieId)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.codeOrdonnance.findMany.mockResolvedValue([]);

    await service.listerCodesOrdonnancePharmacie(USER);

    expect(prisma.codeOrdonnance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pharmacieUtilisatriceId: 'pharm-1' },
      }),
    );
  });

  it('refuse un rôle non-pharmacie (adhérent) → 403', async () => {
    identity.getMe.mockResolvedValue(adherent());
    await expect(
      service.listerCodesOrdonnancePharmacie(USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.codeOrdonnance.findMany).not.toHaveBeenCalled();
  });

  it('refuse un rôle pharmacie sans pharmacieId propre (compte mal provisionné) → 403', async () => {
    identity.getMe.mockResolvedValue({
      profil: { id: 'p1', organisationId: 'org-1', role: 'PHARMACIE_PHARMACIEN', adherentId: null, etablissementId: null, pharmacieId: null },
      permissions: { roleChain: ['PHARMACIE_PHARMACIEN'] },
    });
    await expect(
      service.listerCodesOrdonnancePharmacie(USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
