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
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function personnelCentre(role = 'CENTRE_MEDICAL_MEDECIN', etab = 'etab-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role, adherentId: null, etablissementId: etab, pharmacieId: null },
    permissions: { roleChain: [role] },
  };
}

const ACTE = { categorieActe: 'CONSULTATION' as const, libelle: 'Consultation généraliste', quantite: 1 };

describe('PreauthorizationService — Ticket de Soins (ajout d’acte)', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticketSoins: { findFirst: jest.fn() },
      consultationDossier: { findFirst: jest.fn() },
      acteDossier: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      dossierSoins: { findFirst: jest.fn().mockResolvedValue(null) },
      garantie: { findFirst: jest.fn().mockResolvedValue(null) },
      referentielActe: { findFirst: jest.fn().mockResolvedValue(null) },
      tarifConventionne: { findFirst: jest.fn().mockResolvedValue(null) },
      autorisationRepetitionActe: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      etablissementSante: { findFirst: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: CareEpisodeService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PreauthorizationService);
  });

  const ticket = (statut: string, typeVisite: string | null = null) => ({
    id: 'tkt-1',
    statut,
    dossierSoinsId: 'dos-1',
    dossier: {
      organisationId: 'org-1',
      etablissementId: 'etab-1',
      typeVisite,
      police: { produitId: 'prod-1' },
    },
  });

  it('ajoute un acte quand le ticket est OUVERT', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    prisma.acteDossier.create.mockResolvedValue({ id: 'acte-1' });
    prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', libelle: ACTE.libelle });

    const res = await service.ajouterActe(USER, 'tkt-1', ACTE);

    expect(prisma.acteDossier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketSoinsId: 'tkt-1',
          dossierSoinsId: 'dos-1',
          categorieActe: 'CONSULTATION',
        }),
      }),
    );
    expect(res).toMatchObject({ id: 'acte-1' });
  });

  it('REFUSE l’ajout d’un acte à un ticket CLOTURE (409, message clair)', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('CLOTURE'));

    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toMatchObject({
      response: { message: expect.stringContaining('CLOTURE') },
    });
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.acteDossier.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ajout d’un acte à un ticket ANNULE (409)', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('ANNULE'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('ticket introuvable → 404', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(null);
    await expect(service.ajouterActe(USER, 'tkt-x', ACTE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('personnel d’un AUTRE établissement → 403', async () => {
    identity.getMe.mockResolvedValue(
      personnelCentre('CENTRE_MEDICAL_MEDECIN', 'etab-AUTRE'),
    );
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rôle non autorisé (comptable pharmacie) → 403', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('PHARMACIE_COMPTABLE', null as any));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Simulation INDICATIVE (v3 §5 étendu) : ticket_moderateur, part_assure,
  //  part_assurance calculés à l'ajout de l'acte — tarif conventionné
  //  (s'il existe) plafonnant le montant facturé, puis taux de couverture de
  //  la garantie. Ne bloque JAMAIS l'ajout de l'acte (renvoie null si rien
  //  n'est simulable).
  // ═══════════════════════════════════════════════════════════════════════
  describe('simulation du montant (ajouterActe)', () => {
    const ACTE_AVEC_MONTANT = {
      categorieActe: 'CONSULTATION' as const,
      libelle: 'Consultation généraliste',
      quantite: 1,
      montantPrescrit: 10000,
    };

    beforeEach(() => {
      identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
      prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
      prisma.acteDossier.create.mockResolvedValue({ id: 'acte-1' });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1' });
    });

    it('sans montantPrescrit → aucun montant simulé, mais la couverture de la catégorie est annoncée', async () => {
      prisma.garantie.findFirst.mockResolvedValue(null);
      const res = await service.ajouterActe(USER, 'tkt-1', ACTE);
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: null,
            montantSimulePatient: null,
            ticketModerateurSimule: null,
          }),
        }),
      );
      expect(res.categorieCouverte).toBe(false);
    });

    it('sans garantie pour la catégorie → NON COUVERT annoncé dès l’ajout : assurance 0, patient 100 %', async () => {
      prisma.garantie.findFirst.mockResolvedValue(null);
      const res = await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: '0.00',
            montantSimulePatient: '10000.00',
            ticketModerateurSimule: '0.00',
          }),
        }),
      );
      expect(res.categorieCouverte).toBe(false);
    });

    it('catégorie absente du référentiel (ancien code BIOLOGIE) → 400, aucun acte créé', async () => {
      await expect(
        service.ajouterActe(USER, 'tkt-1', { ...ACTE, categorieActe: 'BIOLOGIE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.acteDossier.create).not.toHaveBeenCalled();
    });

    it('sans tarif conventionné → simule sur le montant facturé', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });

      await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);

      expect(prisma.tarifConventionne.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: '8000.00',
            montantSimulePatient: '2000.00',
            ticketModerateurSimule: '2000.00',
          }),
        }),
      );
    });

    it('sans codeActe → ne cherche pas de tarif conventionné (même avec une garantie)', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });

      await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);

      expect(prisma.referentielActe.findFirst).not.toHaveBeenCalled();
    });

    it('avec tarif conventionné INFÉRIEUR au montant facturé → plafonne la base de calcul', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });
      prisma.referentielActe.findFirst.mockResolvedValue({ id: 'ref-1' });
      prisma.tarifConventionne.findFirst.mockResolvedValue({
        tarifConvention: '6000.00',
      });

      await service.ajouterActe(USER, 'tkt-1', {
        ...ACTE_AVEC_MONTANT,
        codeActe: 'CONS-GEN',
      });

      expect(prisma.tarifConventionne.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            referentielActeId: 'ref-1',
            etablissementId: 'etab-1',
          }),
        }),
      );
      // Base plafonnée à 6000 (au lieu des 10000 facturés) × 80 % = 4800.
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: '4800.00',
            montantSimulePatient: '1200.00',
            ticketModerateurSimule: '1200.00',
          }),
        }),
      );
    });

    it('avec tarif conventionné SUPÉRIEUR au montant facturé → garde le montant facturé (jamais de majoration)', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });
      prisma.referentielActe.findFirst.mockResolvedValue({ id: 'ref-1' });
      prisma.tarifConventionne.findFirst.mockResolvedValue({
        tarifConvention: '50000.00',
      });

      await service.ajouterActe(USER, 'tkt-1', {
        ...ACTE_AVEC_MONTANT,
        codeActe: 'CONS-GEN',
      });

      // Base reste 10000 (le montant facturé, plus petit que le tarif conventionné) × 80 % = 8000.
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ montantSimuleAssurance: '8000.00' }),
        }),
      );
    });

    it('applique le plafond par acte de la garantie sur le montant simulé assurance', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: '3000.00',
      });

      await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);

      // 80 % de 10000 = 8000, plafonné à 3000.
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: '3000.00',
            montantSimulePatient: '7000.00',
          }),
        }),
      );
    });

    it('la simulation est incluse dans le détail de l’audit', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });

      await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('codeActe sans référentiel homologué dans l’organisation → simule sur le montant facturé (pas de blocage)', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: '80',
        ticketModerateur: '20',
        plafondParActe: null,
      });
      prisma.referentielActe.findFirst.mockResolvedValue(null);

      await expect(
        service.ajouterActe(USER, 'tkt-1', { ...ACTE_AVEC_MONTANT, codeActe: 'INCONNU' }),
      ).resolves.toMatchObject({ id: 'acte-1' });

      expect(prisma.tarifConventionne.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ montantSimuleAssurance: '8000.00' }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Pré-autorisation obligatoire (analyses/examens médicaux, v3 §5 étendu) :
  //  déclenchée UNIQUEMENT depuis dossier.typeVisite réel — jamais une valeur
  //  envoyée par le client (AjouterActeDto n'a d'ailleurs aucun champ pour ça).
  // ═══════════════════════════════════════════════════════════════════════
  describe('pré-autorisation obligatoire (déclenchement à l’ajout d’un acte)', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
      prisma.acteDossier.create.mockResolvedValue({ id: 'acte-1' });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1' });
    });

    it('force EN_ATTENTE_EXPLOITATION quand dossier.typeVisite = ANALYSES_EXAMENS_MEDICAUX', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(
        ticket('OUVERT', 'ANALYSES_EXAMENS_MEDICAUX'),
      );

      await service.ajouterActe(USER, 'tkt-1', ACTE);

      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statutPreautorisation: 'EN_ATTENTE_EXPLOITATION' }),
        }),
      );
    });

    it('force EN_ATTENTE_EXPLOITATION quand dossier.typeVisite = HOSPITALISATION_MEDICALE (élargi à ce Prompt)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(
        ticket('OUVERT', 'HOSPITALISATION_MEDICALE'),
      );

      await service.ajouterActe(USER, 'tkt-1', ACTE);

      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statutPreautorisation: 'EN_ATTENTE_EXPLOITATION' }),
        }),
      );
    });

    it('laisse NON_REQUISE pour tout autre type de visite', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(
        ticket('OUVERT', 'CONSULTATION_GENERALISTE'),
      );

      await service.ajouterActe(USER, 'tkt-1', ACTE);

      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statutPreautorisation: 'NON_REQUISE' }),
        }),
      );
    });

    it('laisse NON_REQUISE quand le type de visite n’est pas encore choisi (null)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT', null));

      await service.ajouterActe(USER, 'tkt-1', ACTE);

      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statutPreautorisation: 'NON_REQUISE' }),
        }),
      );
    });

    it('ignore toute tentative du client d’imposer un statut via le DTO (aucun champ de ce type dans AjouterActeDto)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT', 'ANALYSES_EXAMENS_MEDICAUX'));

      await service.ajouterActe(USER, 'tkt-1', {
        ...ACTE,
        // @ts-expect-error — le client ne peut pas influencer ce champ.
        statutPreautorisation: 'APPROUVEE',
      });

      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statutPreautorisation: 'EN_ATTENTE_EXPLOITATION' }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Règle anti-répétition (14 jours) — actes ajoutés dans un dossier
  //  ANALYSES_EXAMENS_MEDICAUX porteurs d'un codeActe, même patient, tous
  //  établissements confondus. Débloqué au cas par cas par le médecin
  //  conseil (`autoriserRepetition`), jamais l'exploitation elle-même.
  // ═══════════════════════════════════════════════════════════════════════
  describe('règle anti-répétition (14 jours)', () => {
    const ticketAnalyses = (typeVisite: string | null = 'ANALYSES_EXAMENS_MEDICAUX') => ({
      id: 'tkt-1',
      statut: 'OUVERT',
      dossierSoinsId: 'dos-1',
      dossier: {
        organisationId: 'org-1',
        etablissementId: 'etab-1',
        typeVisite,
        adherentId: 'adh-1',
        beneficiaireId: null,
        police: { produitId: 'prod-1' },
      },
    });
    const ACTE_ANALYSE = {
      categorieActe: 'ANALYSES' as const,
      libelle: 'Bilan sanguin complet',
      codeActe: 'BIO-01',
      quantite: 1,
    };

    beforeEach(() => {
      identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
      prisma.ticketSoins.findFirst.mockResolvedValue(ticketAnalyses());
      prisma.acteDossier.create.mockResolvedValue({ id: 'acte-2' });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-2' });
    });

    it('bloque (409) si un acte du même code existe pour ce patient dans les 14 jours', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue({
        id: 'acte-ancien',
        datePrescription: new Date('2026-09-10'),
      });

      await expect(
        service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.create).not.toHaveBeenCalled();
    });

    it('le message d’erreur montre la date de l’acte précédent et le code de l’acte', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue({
        id: 'acte-ancien',
        datePrescription: new Date('2026-09-10T00:00:00Z'),
      });

      try {
        await service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE);
        throw new Error('devait lever une ConflictException');
      } catch (e: any) {
        expect(e.response.message).toContain('BIO-01');
        expect(e.response.acteRepeteDetecte).toBe(true);
        expect(e.response.acteRepeteId).toBe('acte-ancien');
      }
    });

    it('autorise l’ajout si aucun acte du même code n’existe dans les 14 jours', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue(null);

      await service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE);

      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('ignore la règle si aucun codeActe n’est fourni (rien à comparer)', async () => {
      await service.ajouterActe(USER, 'tkt-1', { ...ACTE_ANALYSE, codeActe: undefined });

      expect(prisma.acteDossier.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('ignore la règle pour un autre type de visite (ex. HOSPITALISATION_MEDICALE)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(ticketAnalyses('HOSPITALISATION_MEDICALE'));

      await service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE);

      expect(prisma.acteDossier.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('une autorisation du médecin conseil (non utilisée, même ticket + code) débloque l’ajout — et est consommée', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue({
        id: 'acte-ancien',
        datePrescription: new Date(),
      });
      prisma.autorisationRepetitionActe.findFirst.mockResolvedValue({
        id: 'autor-1',
        utilisee: false,
      });
      prisma.autorisationRepetitionActe.update = jest.fn().mockResolvedValue({});

      await service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE);

      expect(prisma.acteDossier.create).toHaveBeenCalled();
      expect(prisma.autorisationRepetitionActe.update).toHaveBeenCalledWith({
        where: { id: 'autor-1' },
        data: { utilisee: true, utiliseeLe: expect.any(Date) },
      });
    });

    it('sans autorisation valable (findFirst filtre déjà utilisee:false) → toujours bloqué', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue({
        id: 'acte-ancien',
        datePrescription: new Date(),
      });
      prisma.autorisationRepetitionActe.findFirst.mockResolvedValue(null);

      await expect(
        service.ajouterActe(USER, 'tkt-1', ACTE_ANALYSE),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.create).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  autoriserRepetition — réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('autoriserRepetition', () => {
    beforeEach(() => {
      prisma.ticketSoins.findFirst.mockResolvedValue({ id: 'tkt-1' });
      prisma.autorisationRepetitionActe.create = jest
        .fn()
        .mockResolvedValue({ id: 'autor-1', codeActe: 'BIO-01' });
    });

    it('ASSUREUR_MEDECIN_CONSEIL crée une autorisation à usage unique', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));

      const res = await service.autoriserRepetition(USER, 'tkt-1', {
        codeActe: 'BIO-01',
        motif: 'Contrôle post-traitement cliniquement justifié.',
      });

      expect(prisma.autorisationRepetitionActe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketSoinsId: 'tkt-1',
            codeActe: 'BIO-01',
            autoriseParId: 'u1',
          }),
        }),
      );
      expect(res).toMatchObject({ id: 'autor-1' });
    });

    it('ASSUREUR_EXPLOITATION → 403 (ne peut pas débloquer sa propre décision)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));

      await expect(
        service.autoriserRepetition(USER, 'tkt-1', { codeActe: 'BIO-01', motif: 'Test suffisant ici.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.autorisationRepetitionActe.create).not.toHaveBeenCalled();
    });

    it('ticket introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));
      prisma.ticketSoins.findFirst.mockResolvedValue(null);

      await expect(
        service.autoriserRepetition(USER, 'tkt-x', { codeActe: 'BIO-01', motif: 'Test suffisant ici.' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Règle de fréquence des consultations (14 jours) — dossiers
  //  CONSULTATION_GENERALISTE/CONSULTATION_SPECIALISTE, compteurs séparés par
  //  type, évaluée uniquement au premier acte du ticket. Débloquée au cas par
  //  cas par le médecin conseil (`autoriserRepetitionConsultation`).
  // ═══════════════════════════════════════════════════════════════════════
  describe('règle de fréquence des consultations (14 jours)', () => {
    const ticketConsultation = (typeVisite: string | null = 'CONSULTATION_GENERALISTE') => ({
      id: 'tkt-1',
      statut: 'OUVERT',
      dossierSoinsId: 'dos-1',
      dossier: {
        organisationId: 'org-1',
        etablissementId: 'etab-1',
        typeVisite,
        adherentId: 'adh-1',
        beneficiaireId: null,
        police: { produitId: 'prod-1' },
      },
    });
    const ACTE_CONSULTATION = {
      categorieActe: 'CONSULTATION' as const,
      libelle: 'Consultation généraliste',
      quantite: 1,
    };

    beforeEach(() => {
      identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
      prisma.ticketSoins.findFirst.mockResolvedValue(ticketConsultation());
      prisma.acteDossier.create.mockResolvedValue({ id: 'acte-2' });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-2' });
      prisma.acteDossier.count.mockResolvedValue(0);
    });

    it('bloque (409) si une consultation du même type existe pour ce patient dans les 14 jours', async () => {
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-ancien',
        dateOuverture: new Date('2026-09-10'),
      });

      await expect(
        service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.create).not.toHaveBeenCalled();
    });

    it('le message d’erreur montre la date de la consultation précédente', async () => {
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-ancien',
        dateOuverture: new Date('2026-09-10T00:00:00Z'),
      });

      try {
        await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);
        throw new Error('devait lever une ConflictException');
      } catch (e: any) {
        expect(e.response.message).toContain('CONSULTATION_GENERALISTE');
        expect(e.response.consultationRepeteeDetectee).toBe(true);
        expect(e.response.dossierPrecedentId).toBe('dos-ancien');
      }
    });

    it('autorise l’ajout si aucune consultation du même type n’existe dans les 14 jours', async () => {
      prisma.dossierSoins.findFirst.mockResolvedValue(null);

      await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);

      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('une consultation spécialiste en parallèle n’est pas affectée par une consultation généraliste (compteurs séparés)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(ticketConsultation('CONSULTATION_SPECIALISTE'));
      // Le mock ne recevra jamais de dossier généraliste ici puisque le filtre
      // `typeVisite` est passé tel quel à la requête — on vérifie l'appel.
      prisma.dossierSoins.findFirst.mockResolvedValue(null);

      await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);

      expect(prisma.dossierSoins.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ typeVisite: 'CONSULTATION_SPECIALISTE' }),
        }),
      );
      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('ignore la règle pour un autre type de visite (ex. ANALYSES_EXAMENS_MEDICAUX)', async () => {
      prisma.ticketSoins.findFirst.mockResolvedValue(ticketConsultation('ANALYSES_EXAMENS_MEDICAUX'));

      await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);

      expect(prisma.dossierSoins.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('n’est évaluée qu’au premier acte du ticket — un 2e acte sur le même ticket ne redéclenche pas la règle', async () => {
      prisma.acteDossier.count.mockResolvedValue(1);
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-ancien',
        dateOuverture: new Date(),
      });

      await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);

      expect(prisma.dossierSoins.findFirst).not.toHaveBeenCalled();
      expect(prisma.acteDossier.create).toHaveBeenCalled();
    });

    it('une autorisation du médecin conseil (non utilisée, même ticket + type) débloque l’ajout — et est consommée', async () => {
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-ancien',
        dateOuverture: new Date(),
      });
      prisma.autorisationRepetitionActe.findFirst.mockResolvedValue({
        id: 'autor-conseil-1',
        utilisee: false,
      });
      prisma.autorisationRepetitionActe.update = jest.fn().mockResolvedValue({});

      await service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION);

      expect(prisma.acteDossier.create).toHaveBeenCalled();
      expect(prisma.autorisationRepetitionActe.update).toHaveBeenCalledWith({
        where: { id: 'autor-conseil-1' },
        data: { utilisee: true, utiliseeLe: expect.any(Date) },
      });
    });

    it('sans autorisation valable → toujours bloqué', async () => {
      prisma.dossierSoins.findFirst.mockResolvedValue({
        id: 'dos-ancien',
        dateOuverture: new Date(),
      });
      prisma.autorisationRepetitionActe.findFirst.mockResolvedValue(null);

      await expect(
        service.ajouterActe(USER, 'tkt-1', ACTE_CONSULTATION),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.create).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  autoriserRepetitionConsultation — réservé EXCLUSIVEMENT à
  //  ASSUREUR_MEDECIN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('autoriserRepetitionConsultation', () => {
    beforeEach(() => {
      prisma.ticketSoins.findFirst.mockResolvedValue({ id: 'tkt-1' });
      prisma.autorisationRepetitionActe.create = jest
        .fn()
        .mockResolvedValue({ id: 'autor-conseil-1', typeVisite: 'CONSULTATION_GENERALISTE' });
    });

    it('ASSUREUR_MEDECIN_CONSEIL crée une autorisation à usage unique', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));

      const res = await service.autoriserRepetitionConsultation(USER, 'tkt-1', {
        typeVisite: 'CONSULTATION_GENERALISTE',
        motif: 'Deux motifs sans rapport, cliniquement justifiés.',
      });

      expect(prisma.autorisationRepetitionActe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketSoinsId: 'tkt-1',
            typeVisite: 'CONSULTATION_GENERALISTE',
            autoriseParId: 'u1',
          }),
        }),
      );
      expect(res).toMatchObject({ id: 'autor-conseil-1' });
    });

    it('ASSUREUR_EXPLOITATION → 403 (ne peut pas débloquer sa propre décision)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));

      await expect(
        service.autoriserRepetitionConsultation(USER, 'tkt-1', {
          typeVisite: 'CONSULTATION_GENERALISTE',
          motif: 'Test suffisant ici.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.autorisationRepetitionActe.create).not.toHaveBeenCalled();
    });

    it('ticket introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));
      prisma.ticketSoins.findFirst.mockResolvedValue(null);

      await expect(
        service.autoriserRepetitionConsultation(USER, 'tkt-x', {
          typeVisite: 'CONSULTATION_GENERALISTE',
          motif: 'Test suffisant ici.',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Orientation — établissement EXÉCUTANT distinct de l'origine du dossier.
  //  Une fois renseigné, le tarif conventionné doit être recherché pour LUI,
  //  jamais pour l'établissement d'origine.
  // ═══════════════════════════════════════════════════════════════════════
  describe('orientation vers un établissement exécutant (traiterParExploitation)', () => {
    const acteAvecCode = () => ({
      id: 'acte-1',
      statutPreautorisation: 'EN_ATTENTE_EXPLOITATION',
      quantite: 1,
      libelle: 'Scanner cérébral',
      categorieActe: 'IMAGERIE',
      codeActe: 'IMG-01',
      montantPrescrit: 10000,
      dossier: { organisationId: 'org-1', etablissementId: 'etab-origine', police: { produitId: 'prod-1' } },
    });

    beforeEach(() => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteAvecCode());
      prisma.acteDossier.update = jest.fn().mockResolvedValue({});
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1' });
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: '80', ticketModerateur: '20', plafondParActe: null });
      prisma.referentielActe.findFirst.mockResolvedValue({ id: 'ref-1' });
      // Le tarif conventionné n'existe que pour l'établissement EXÉCUTANT —
      // preuve que c'est bien lui qui est utilisé, pas l'origine.
      prisma.tarifConventionne.findFirst.mockImplementation(({ where }: any) =>
        where.etablissementId === 'etab-exec'
          ? Promise.resolve({ tarifConvention: '4000' })
          : Promise.resolve(null),
      );
    });

    it('approuve en réorientant → tarif recherché pour l’établissement EXÉCUTANT, pas l’origine', async () => {
      prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'etab-exec' });

      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        etablissementExecutionId: 'etab-exec',
        motif: 'Réorienté vers un plateau technique disponible plus tôt.',
      });

      // Tarif conventionné plafonne à 4000 (au lieu de 10000) × 80 % = 3200.00.
      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            etablissementExecutionId: 'etab-exec',
            montantSimuleAssurance: '3200.00',
          }),
        }),
      );
      expect(prisma.tarifConventionne.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ etablissementId: 'etab-exec' }),
        }),
      );
    });

    it('sans réorientation, le tarif reste recherché pour l’établissement d’ORIGINE (pas de tarif → base pleine)', async () => {
      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        motif: 'Approuvé sans réorientation.',
      });

      // Pas de tarif pour 'etab-origine' dans ce mock → base = montantPrescrit plein (10000) × 80 % = 8000.00.
      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            etablissementExecutionId: null,
            montantSimuleAssurance: '8000.00',
          }),
        }),
      );
      expect(prisma.tarifConventionne.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ etablissementId: 'etab-origine' }),
        }),
      );
    });

    it('établissement exécutant introuvable → 404, aucune décision persistée', async () => {
      prisma.etablissementSante.findFirst.mockResolvedValue(null);

      await expect(
        service.traiterParExploitation(USER, 'acte-1', {
          decision: 'APPROUVE',
          etablissementExecutionId: 'etab-inconnu',
          motif: 'Test suffisant ici.',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.acteDossier.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  validerPreautorisation — réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL
  //  (pas ASSUREUR_INFORMATIQUE, pas ASSUREUR_EXPLOITATION).
  // ═══════════════════════════════════════════════════════════════════════
  describe('validerPreautorisation', () => {
    function medecinConseil() {
      return {
        profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_MEDECIN_CONSEIL', adherentId: null, etablissementId: null, pharmacieId: null },
        permissions: { roleChain: ['ASSUREUR_MEDECIN_CONSEIL'] },
      };
    }

    const acteEnAttente = (extra: Record<string, unknown> = {}) => ({
      id: 'acte-1',
      statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL',
      quantite: 1,
      libelle: 'Bilan sanguin',
      categorieActe: 'ANALYSES',
      codeActe: null,
      montantPrescrit: null,
      dossier: { organisationId: 'org-1', etablissementId: 'etab-1', police: { produitId: 'prod-1' } },
      ...extra,
    });

    it('APPROUVE par ASSUREUR_MEDECIN_CONSEIL → statut APPROUVEE, audit avec motif', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttente());
      prisma.acteDossier.update = jest.fn().mockResolvedValue({});
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'APPROUVEE' });

      const res = await service.validerPreautorisation(USER, 'acte-1', {
        decision: 'APPROUVE',
        motif: 'Conforme au protocole médical.',
      });

      expect(prisma.acteDossier.update).toHaveBeenCalledWith({
        where: { id: 'acte-1' },
        data: {
          statutPreautorisation: 'APPROUVEE',
          quantiteApprouvee: null,
          typeActeApprouve: null,
          ticketModerateurAjuste: null,
          etablissementExecutionId: null,
        },
      });
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(res).toMatchObject({ statutPreautorisation: 'APPROUVEE' });
    });

    it('REFUSE par ASSUREUR_MEDECIN_CONSEIL → statut REFUSEE', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttente());
      prisma.acteDossier.update = jest.fn().mockResolvedValue({});
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'REFUSEE' });

      await service.validerPreautorisation(USER, 'acte-1', {
        decision: 'REFUSE',
        motif: 'Analyse non justifiée cliniquement.',
      });

      expect(prisma.acteDossier.update).toHaveBeenCalledWith({
        where: { id: 'acte-1' },
        data: { statutPreautorisation: 'REFUSEE' },
      });
    });

    it('ASSUREUR_INFORMATIQUE → 403 (rôle exclu, même s’il gère par ailleurs le référentiel)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_INFORMATIQUE', null as any));
      await expect(
        service.validerPreautorisation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.acteDossier.findFirst).not.toHaveBeenCalled();
    });

    it('ASSUREUR_EXPLOITATION → 403 (rôle exclu)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      await expect(
        service.validerPreautorisation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('acte introuvable (mauvaise organisation) → 404', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.acteDossier.findFirst.mockResolvedValue(
        acteEnAttente({ dossier: { organisationId: 'autre-org' } }),
      );
      await expect(
        service.validerPreautorisation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant.' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('acte déjà tranché (APPROUVEE) → 409, on ne rejoue pas une décision', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.acteDossier.findFirst.mockResolvedValue(
        acteEnAttente({ statutPreautorisation: 'APPROUVEE' }),
      );
      await expect(
        service.validerPreautorisation(USER, 'acte-1', { decision: 'REFUSE', motif: 'Test suffisant.' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.update).not.toHaveBeenCalled();
    });

    it('acte NON_REQUISE (pas d’analyse) → 409, rien à valider', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      prisma.acteDossier.findFirst.mockResolvedValue(
        acteEnAttente({ statutPreautorisation: 'NON_REQUISE' }),
      );
      await expect(
        service.validerPreautorisation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant.' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  traiterParExploitation — premier niveau du circuit à deux niveaux.
  //  Réservé EXCLUSIVEMENT à ASSUREUR_EXPLOITATION/ASSUREUR_EXPLOITATION_
  //  CONJOINTE. APPROUVE/REFUSE finalisent directement ; ESCALADE_MEDECIN_
  //  CONSEIL transfère au second niveau sans statuer sur le fond.
  // ═══════════════════════════════════════════════════════════════════════
  describe('traiterParExploitation', () => {
    const acteEnAttenteExploitation = (extra: Record<string, unknown> = {}) => ({
      id: 'acte-1',
      statutPreautorisation: 'EN_ATTENTE_EXPLOITATION',
      quantite: 3,
      libelle: 'Hospitalisation médicale',
      categorieActe: 'HOSPITALISATION',
      codeActe: null,
      montantPrescrit: 5000, // par jour
      dossier: { organisationId: 'org-1', etablissementId: 'etab-1', police: { produitId: 'prod-1' } },
      ...extra,
    });

    beforeEach(() => {
      prisma.acteDossier.update = jest.fn().mockResolvedValue({});
    });

    it('APPROUVE intégral (aucun ajustement) → APPROUVEE, pas de recalcul de quantité', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: '80', ticketModerateur: '20', plafondParActe: null });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'APPROUVEE' });

      const res = await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        motif: 'Hospitalisation justifiée, durée conforme au protocole.',
      });

      // 3 jours × 5000 × 80 % = 12000 (base = quantité DEMANDÉE, aucun ajustement).
      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statutPreautorisation: 'APPROUVEE',
            montantSimuleAssurance: '12000.00',
          }),
        }),
      );
      expect(res).toMatchObject({ statutPreautorisation: 'APPROUVEE' });
    });

    it('APPROUVE PARTIEL (2 jours accordés sur 3 demandés) → APPROUVEE_PARTIELLEMENT, recalcul sur la base APPROUVÉE', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: '80', ticketModerateur: '20', plafondParActe: null });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'APPROUVEE_PARTIELLEMENT' });

      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        quantiteApprouvee: 2,
        motif: 'Seuls 2 jours cliniquement justifiés sur les 3 demandés.',
      });

      // Base = 2 jours (APPROUVÉS), pas 3 (demandés) : 5000 × 2 × 80 % = 8000.
      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statutPreautorisation: 'APPROUVEE_PARTIELLEMENT',
            quantiteApprouvee: 2,
            montantSimuleAssurance: '8000.00',
            montantSimulePatient: '2000.00',
          }),
        }),
      );
    });

    it('typeApprouve différent du libellé demandé → APPROUVEE_PARTIELLEMENT même à quantité égale', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: '80', ticketModerateur: '20', plafondParActe: null });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1' });

      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        typeApprouve: 'Mise en observation',
        motif: 'Hospitalisation non justifiée, mise en observation suffisante.',
      });

      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statutPreautorisation: 'APPROUVEE_PARTIELLEMENT',
            typeActeApprouve: 'Mise en observation',
          }),
        }),
      );
    });

    it('ticketModerateurAjuste surcharge le pourcentage de la garantie pour CET acte', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: '80', ticketModerateur: '20', plafondParActe: null });
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1' });

      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'APPROUVE',
        ticketModerateurAjuste: 10,
        motif: 'Ticket modérateur réduit à titre exceptionnel pour ce dossier.',
      });

      // 3 × 5000 = 15000 ; ticket modérateur à 10 % (surchargé, pas les 20 % de la garantie) = 1500.
      expect(prisma.acteDossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketModerateurAjuste: '10.00',
            ticketModerateurSimule: '1500.00',
          }),
        }),
      );
    });

    it('REFUSE → REFUSEE (pas de recalcul, pas de champs d’approbation)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'REFUSEE' });

      await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'REFUSE',
        motif: 'Hospitalisation non couverte par la garantie souscrite.',
      });

      expect(prisma.acteDossier.update).toHaveBeenCalledWith({
        where: { id: 'acte-1' },
        data: { statutPreautorisation: 'REFUSEE' },
      });
      expect(prisma.garantie.findFirst).not.toHaveBeenCalled();
    });

    it('ESCALADE_MEDECIN_CONSEIL → EN_ATTENTE_MEDECIN_CONSEIL, sans passer par la finalisation', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL' });

      const res = await service.traiterParExploitation(USER, 'acte-1', {
        decision: 'ESCALADE_MEDECIN_CONSEIL',
        motif: 'Dossier médical complexe, avis du médecin conseil requis.',
      });

      expect(prisma.acteDossier.update).toHaveBeenCalledWith({
        where: { id: 'acte-1' },
        data: { statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL' },
      });
      expect(res).toMatchObject({ statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL' });
    });

    it('ASSUREUR_EXPLOITATION_CONJOINTE est également autorisée (pas exclusive au titulaire)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION_CONJOINTE', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(acteEnAttenteExploitation());
      prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', statutPreautorisation: 'REFUSEE' });

      await expect(
        service.traiterParExploitation(USER, 'acte-1', { decision: 'REFUSE', motif: 'Test suffisant ici.' }),
      ).resolves.toMatchObject({ statutPreautorisation: 'REFUSEE' });
    });

    it('ASSUREUR_MEDECIN_CONSEIL → 403 (exclu du premier niveau)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));
      await expect(
        service.traiterParExploitation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant ici.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.acteDossier.findFirst).not.toHaveBeenCalled();
    });

    it('ASSUREUR_INFORMATIQUE → 403 (exclu du premier niveau)', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_INFORMATIQUE', null as any));
      await expect(
        service.traiterParExploitation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant ici.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('acte déjà escaladé (EN_ATTENTE_MEDECIN_CONSEIL) → 409, l’exploitation ne peut plus le retraiter', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));
      prisma.acteDossier.findFirst.mockResolvedValue(
        acteEnAttenteExploitation({ statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL' }),
      );
      await expect(
        service.traiterParExploitation(USER, 'acte-1', { decision: 'APPROUVE', motif: 'Test suffisant ici.' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.acteDossier.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  statistiquesExploitation — GrilleCartes de /dashboard-assureur/exploitation.
  //  Agrégation directe sur statutPreautorisation/updatedAt, aucune nouvelle
  //  table. `escalades` = actuellement EN_ATTENTE_MEDECIN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('statistiquesExploitation', () => {
    // Horloge figée sur un vendredi (2026-09-18) pour que les bornes de
    // semaine (lundi) / mois / année soient déterministes quel que soit le
    // jour réel d'exécution des tests.
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T12:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('ventile les actes par période et par issue', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_EXPLOITATION', null as any));

      prisma.acteDossier.findMany.mockResolvedValue([
        { statutPreautorisation: 'APPROUVEE', updatedAt: new Date('2026-09-18T08:00:00Z') }, // aujourd'hui
        { statutPreautorisation: 'APPROUVEE_PARTIELLEMENT', updatedAt: new Date('2026-09-17T08:00:00Z') }, // hier, même semaine (lundi 14/09)
        { statutPreautorisation: 'REFUSEE', updatedAt: new Date('2026-09-08T08:00:00Z') }, // il y a 10 jours, même mois, semaine précédente
        { statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL', updatedAt: new Date('2026-03-01T08:00:00Z') }, // même année, mois différent
      ]);

      const stats = await service.statistiquesExploitation(USER);

      expect(stats.jour).toEqual({ approuves: 1, refuses: 0, escalades: 0 });
      expect(stats.semaine).toEqual({ approuves: 2, refuses: 0, escalades: 0 });
      expect(stats.mois).toEqual({ approuves: 2, refuses: 1, escalades: 0 });
      expect(stats.annee).toEqual({ approuves: 2, refuses: 1, escalades: 1 });
    });

    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(personnelCentre('ASSUREUR_MEDECIN_CONSEIL', null as any));
      await expect(service.statistiquesExploitation(USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.acteDossier.findMany).not.toHaveBeenCalled();
    });
  });
});
