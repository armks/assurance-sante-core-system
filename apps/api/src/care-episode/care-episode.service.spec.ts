import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CareEpisodeService } from './care-episode.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'accueil@centre.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(
  roleChain: string[],
  organisationId: string | null = 'org-1',
  etablissementId: string | null = null,
) {
  return {
    profil: { id: 'u1', organisationId, etablissementId },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

const POLICE_ACTIVE = {
  id: 'pol-1',
  organisationId: 'org-1',
  statut: 'ACTIVE',
  dateDebut: new Date('2020-01-01'),
  dateFin: new Date('2999-12-31'),
  produitId: 'prod-1',
  deletedAt: null,
};
const ETAB_ACTIF = { id: 'etab-1', organisationId: 'org-1', statut: 'ACTIF', deletedAt: null };

describe('CareEpisodeService', () => {
  let service: CareEpisodeService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      etablissementSante: { findFirst: jest.fn().mockResolvedValue(ETAB_ACTIF) },
      police: { findFirst: jest.fn().mockResolvedValue(POLICE_ACTIVE) },
      garantie: { findFirst: jest.fn().mockResolvedValue({ id: 'gar-1', delaiCarenceJours: null }) },
      dossierSoins: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      consultationDossier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      ticketSoins: {
        create: jest.fn().mockResolvedValue({ id: 'tkt-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      profil: { findFirst: jest.fn() },
      adherent: {
        findFirst: jest.fn().mockResolvedValue({ statut: 'ACTIF' }),
      },
      beneficiaire: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ statut: 'ACTIF', adherent: { statut: 'ACTIF' } }),
      },
      acteDossier: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CareEpisodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(CareEpisodeService);
  });

  const dtoOuverture = {
    adherentId: 'aaaaaaaa-1111-4111-8111-111111111111',
    etablissementId: 'etab-1',
    policeId: 'pol-1',
    motifConsultation: 'Fièvre',
  };

  it('ouvre un dossier quand toutes les conditions sont réunies', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.dossierSoins.create.mockResolvedValue({
      id: 'dos-1',
      numeroTraitement: 'TRT-2026-09-000001',
    });
    prisma.dossierSoins.findFirst
      .mockResolvedValueOnce(null) // pas de dossier ouvert (évaluation)
      .mockResolvedValueOnce({ id: 'dos-1', statut: 'OUVERT', consultations: [] }); // chargerDossier

    const res = await service.ouvrirDossier(USER, dtoOuverture);

    expect(prisma.dossierSoins.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'OUVERT',
          carteValide: true,
          aucunDossierOuvert: true,
        }),
      }),
    );
    // le Ticket de Soins est créé automatiquement, dans la même transaction
    expect(prisma.ticketSoins.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dossierSoinsId: 'dos-1', statut: 'OUVERT' }),
      }),
    );
    expect(res.statut).toBe('OUVERT');
  });

  it('REFUSE l’ouverture si un dossier est déjà OUVERT pour ce patient (blocage précis)', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-0',
      numeroTraitement: 'TRT-2026-09-000009',
      statut: 'OUVERT',
    });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toMatchObject({
      response: {
        blocages: expect.arrayContaining([
          expect.stringContaining('déjà ouvert'),
        ]),
      },
    });
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ouverture pour un adhérent RADIE (contrôle de statut réel, PROMPT 12)', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.adherent.findFirst.mockResolvedValue({ statut: 'RADIE' });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toMatchObject({
      response: {
        blocages: expect.arrayContaining([
          expect.stringContaining('RADIE'),
        ]),
      },
    });
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ouverture pour un adhérent SUSPENDU', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.adherent.findFirst.mockResolvedValue({ statut: 'SUSPENDU' });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ouverture pour un bénéficiaire dont l’adhérent titulaire est RADIE', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.beneficiaire.findFirst.mockResolvedValue({
      statut: 'ACTIF',
      adherent: { statut: 'RADIE' },
    });

    await expect(
      service.ouvrirDossier(USER, {
        beneficiaireId: 'bbbbbbbb-1111-4111-8111-111111111111',
        etablissementId: 'etab-1',
        policeId: 'pol-1',
        motifConsultation: 'Toux',
      }),
    ).rejects.toMatchObject({
      response: {
        blocages: expect.arrayContaining([
          expect.stringContaining('titulaire'),
        ]),
      },
    });
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ouverture si la police n’est pas ACTIVE (carte non valide)', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.police.findFirst.mockResolvedValue({
      ...POLICE_ACTIVE,
      statut: 'RESILIEE',
    });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toBeInstanceOf(
      ConflictException,
    );
    try {
      await service.ouvrirDossier(USER, dtoOuverture);
    } catch (e: any) {
      expect(e.response.blocages.join(' ')).toContain('Carte non valide');
      expect(e.response.evaluation.carteValide).toBe(false);
    }
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE d’ajouter une consultation avec un médecin d’un AUTRE établissement', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-1'));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-1',
      organisationId: 'org-1',
      statut: 'OUVERT',
      etablissementId: 'etab-1',
    });
    prisma.profil.findFirst.mockResolvedValue({
      id: 'med-2',
      role: 'CENTRE_MEDICAL_MEDECIN',
      etablissementId: 'etab-2', // autre établissement
    });

    await expect(
      service.ajouterConsultation(USER, 'dos-1', {
        medecinId: 'med-2',
        motif: 'Suivi',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.consultationDossier.create).not.toHaveBeenCalled();
  });

  it('ajoute une consultation avec un médecin du bon établissement', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-1',
      organisationId: 'org-1',
      statut: 'OUVERT',
      etablissementId: 'etab-1',
    });
    prisma.profil.findFirst.mockResolvedValue({
      id: 'med-1',
      role: 'CENTRE_MEDICAL_MEDECIN',
      etablissementId: 'etab-1',
    });
    prisma.consultationDossier.create.mockResolvedValue({
      id: 'cons-1',
      numeroConsultation: 'CST-2026-09-000001',
    });
    prisma.consultationDossier.findUnique.mockResolvedValue({ id: 'cons-1' });

    const res = await service.ajouterConsultation(USER, 'dos-1', {
      medecinId: 'med-1',
      motif: 'Consultation initiale',
    });
    expect(prisma.consultationDossier.create).toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'cons-1' });
  });

  it('la clôture forcée est refusée à un rôle non ASSUREUR_EXPLOITATION', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    await expect(
      service.clotureForcee(USER, 'dos-1', { motif: 'Abandon de soins constaté' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la clôture forcée par ASSUREUR_EXPLOITATION passe le dossier en FORCE_CLOS', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.dossierSoins.findFirst
      .mockResolvedValueOnce({ id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT' })
      .mockResolvedValueOnce({ id: 'dos-1', statut: 'FORCE_CLOS', consultations: [] });
    prisma.dossierSoins.update.mockResolvedValue({});
    prisma.consultationDossier.updateMany.mockResolvedValue({});

    const res = await service.clotureForcee(USER, 'dos-1', {
      motif: 'Abandon de soins constaté',
    });
    expect(prisma.dossierSoins.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'FORCE_CLOS', clotureType: 'FORCEE' }),
      }),
    );
    // le Ticket de Soins est clôturé automatiquement avec le dossier
    expect(prisma.ticketSoins.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dossierSoinsId: 'dos-1', statut: 'OUVERT' },
        data: expect.objectContaining({ statut: 'CLOTURE' }),
      }),
    );
    expect(res.statut).toBe('FORCE_CLOS');
  });

  it('la clôture normale clôture aussi le Ticket de Soins', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-1'));
    prisma.dossierSoins.findFirst
      .mockResolvedValueOnce({ id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1' })
      .mockResolvedValueOnce({ id: 'dos-1', statut: 'CLOTURE', consultations: [] });
    prisma.dossierSoins.update.mockResolvedValue({});
    prisma.consultationDossier.updateMany.mockResolvedValue({});

    await service.clotureNormale(USER, 'dos-1', { motif: 'Fin de prise en charge' });

    expect(prisma.ticketSoins.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'CLOTURE' }),
      }),
    );
  });

  it('refuse l’ouverture à un rôle non autorisé (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.ouvrirDossier(USER, dtoOuverture),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Solde restant dû — décision actée : un dossier reste ouvert
  //  indéfiniment tant qu'il n'est pas intégralement soldé (facturation par
  //  sélection d'actes, paiement partiel).
  // ═══════════════════════════════════════════════════════════════════════
  describe('clôture bloquée tant que le solde restant dû n’est pas nul', () => {
    it('REFUSE clotureNormale si un acte n’a jamais été réglé (jamais sélectionné dans aucun cycle)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1',
      });
      prisma.acteDossier.findMany.mockResolvedValue([
        { montantPrescrit: { toString: () => '15000' }, quantite: 1, lignesFacturation: [] },
      ]);

      await expect(
        service.clotureNormale(USER, 'dos-1', { motif: 'tentative' }),
      ).rejects.toMatchObject({ response: { message: expect.stringContaining('15000.00') } });
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });

    it('REFUSE clotureNormale si un acte a une ligne A_PAYER (facture générée, pas encore réglée)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1',
      });
      prisma.acteDossier.findMany.mockResolvedValue([
        { montantPrescrit: { toString: () => '8000' }, quantite: 1, lignesFacturation: [] },
      ]);

      await expect(
        service.clotureNormale(USER, 'dos-1', { motif: 'tentative' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('AUTORISE clotureNormale quand tous les actes ont une ligne PAYE (solde nul)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst
        .mockResolvedValueOnce({ id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1' })
        .mockResolvedValueOnce({ id: 'dos-1', statut: 'CLOTURE', consultations: [] });
      prisma.dossierSoins.update.mockResolvedValue({});
      prisma.consultationDossier.updateMany.mockResolvedValue({});
      // Acte réglé : une ligne PAYE existe → exclu du calcul du solde.
      prisma.acteDossier.findMany.mockResolvedValue([]);

      const res = await service.clotureNormale(USER, 'dos-1', { motif: 'Solde réglé' });
      expect(res.statut).toBe('CLOTURE');
    });

    it('REFUSE clotureForcee elle aussi si le solde restant dû n’est pas nul', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT',
      });
      prisma.acteDossier.findMany.mockResolvedValue([
        { montantPrescrit: { toString: () => '5000' }, quantite: 2, lignesFacturation: [] },
      ]);

      await expect(
        service.clotureForcee(USER, 'dos-1', { motif: 'Abandon de soins constaté' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Fuite inter-établissement corrigée (audit dashboard administratif) :
  //  listerDossiers/obtenirDossier ne vérifiaient QUE organisationId (aucun
  //  rôle, aucun établissement) ; ajouterConsultation/clotureNormale ne
  //  vérifiaient l'établissement que du médecin référencé, jamais celui de
  //  l'APPELANT.
  // ═══════════════════════════════════════════════════════════════════════
  describe('scope établissement (lecture ET écriture)', () => {
    it('CENTRE_MEDICAL_ACCUEIL d’un AUTRE établissement ne peut PAS clôturer un dossier (403, pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-2'));
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1',
      });
      await expect(
        service.clotureNormale(USER, 'dos-1', { motif: 'tentative' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });

    it('CENTRE_MEDICAL_ACCUEIL d’un AUTRE établissement ne peut PAS ajouter de consultation (403)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-2'));
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT', etablissementId: 'etab-1',
      });
      await expect(
        service.ajouterConsultation(USER, 'dos-1', { medecinId: 'med-1', motif: 'Suivi' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.profil.findFirst).not.toHaveBeenCalled();
    });

    it('ASSUREUR_EXPLOITATION (staff) liste TOUS les dossiers de l’organisation', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.dossierSoins.findMany = jest.fn().mockResolvedValue([]);
      await service.listerDossiers(USER, {});
      expect(prisma.dossierSoins.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ etablissementId: expect.anything() }),
        }),
      );
    });

    it('ASSUREUR_MEDECIN_CONSEIL (staff, revue médicale) peut lister les dossiers', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
      prisma.dossierSoins.findMany = jest.fn().mockResolvedValue([]);
      await expect(service.listerDossiers(USER, {})).resolves.toEqual([]);
    });

    it('CENTRE_MEDICAL_MEDECIN ne liste QUE les dossiers de SON établissement', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findMany = jest.fn().mockResolvedValue([]);
      await service.listerDossiers(USER, {});
      expect(prisma.dossierSoins.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ etablissementId: 'etab-1' }),
        }),
      );
    });

    it('CENTRE_MEDICAL_MEDECIN ne peut PAS élargir sa lecture via ?etablissementId= (le scope propre écrase le filtre client)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findMany = jest.fn().mockResolvedValue([]);
      await service.listerDossiers(USER, { etablissementId: 'etab-2' });
      expect(prisma.dossierSoins.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ etablissementId: 'etab-1' }),
        }),
      );
    });

    it('un rôle sans droit sur les dossiers (adhérent) → 403 sur listerDossiers/obtenirDossier', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE']));
      await expect(service.listerDossiers(USER, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.obtenirDossier(USER, 'dos-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('CENTRE_MEDICAL_ACCUEIL ne peut PAS lire le dossier d’un AUTRE établissement (404, pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL'], 'org-1', 'etab-2'));
      // Le mock Prisma est scopé par etablissementId dans le `where` : un
      // dossier d'un autre établissement ne matche jamais → findFirst renvoie null.
      prisma.dossierSoins.findFirst.mockResolvedValue(null);
      await expect(service.obtenirDossier(USER, 'dos-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Type de visite — choisi UNE FOIS, à l'intérieur du dossier, après son
  //  ouverture (jamais avant : l'ouverture reste conditionnée au seul code
  //  de consultation, inchangée).
  // ═══════════════════════════════════════════════════════════════════════
  describe('definirTypeVisite', () => {
    const dossierOuvert = (extra: Record<string, unknown> = {}) => ({
      id: 'dos-1',
      organisationId: 'org-1',
      statut: 'OUVERT',
      etablissementId: 'etab-1',
      typeVisite: null,
      ...extra,
    });

    it('définit le type de visite sur un dossier OUVERT sans type déjà choisi', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossierOuvert());

      await service.definirTypeVisite(USER, 'dos-1', {
        typeVisite: 'CONSULTATION_GENERALISTE',
      });

      expect(prisma.dossierSoins.update).toHaveBeenCalledWith({
        where: { id: 'dos-1' },
        data: { typeVisite: 'CONSULTATION_GENERALISTE' },
      });
    });

    it('REFUSE de redéfinir un type de visite déjà choisi (409)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst.mockResolvedValue(
        dossierOuvert({ typeVisite: 'CONSULTATION_GENERALISTE' }),
      );

      await expect(
        service.definirTypeVisite(USER, 'dos-1', { typeVisite: 'HOSPITALISATION_MEDICALE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });

    it('REFUSE de définir le type de visite sur un dossier non OUVERT (409)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-1'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossierOuvert({ statut: 'CLOTURE' }));

      await expect(
        service.definirTypeVisite(USER, 'dos-1', { typeVisite: 'CONSULTATION_GENERALISTE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });

    it('personnel d’un AUTRE établissement → 403 (pas de fuite inter-établissement)', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN'], 'org-1', 'etab-2'));
      prisma.dossierSoins.findFirst.mockResolvedValue(dossierOuvert());

      await expect(
        service.definirTypeVisite(USER, 'dos-1', { typeVisite: 'CONSULTATION_GENERALISTE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.dossierSoins.update).not.toHaveBeenCalled();
    });

    it('rôle non habilité à gérer les dossiers (adhérent) → 403', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE']));
      await expect(
        service.definirTypeVisite(USER, 'dos-1', { typeVisite: 'CONSULTATION_GENERALISTE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.dossierSoins.findFirst).not.toHaveBeenCalled();
    });
  });
});
