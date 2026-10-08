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
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'expl@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (
  roleChain: string[],
  extra: {
    organisationId?: string | null;
    societeId?: string | null;
    entite?: string | null;
    adherentId?: string | null;
  } = {},
) => ({
  profil: {
    id: 'u1',
    organisationId:
      extra.organisationId === undefined ? 'org-1' : extra.organisationId,
    societeId: extra.societeId ?? null,
    entite: extra.entite ?? null,
    adherentId: extra.adherentId ?? null,
  },
  permissions: roleChain.length ? { roleChain } : null,
});

const SOUSCRIPTEUR = { id: 'sous-1', organisationId: 'org-1', deletedAt: null };

const ADHERENT_CREE = {
  id: 'adh-1',
  organisationId: 'org-1',
  souscripteurId: 'sous-1',
  numeroAdherent: 'ADH-2026-000007',
  numeroCarte: 'CM-0000000042',
  nom: 'Konan',
  prenom: 'Yao',
  statut: 'ACTIF',
};

describe('AdherentService — fichier des membres', () => {
  let service: AdherentService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let cartes: { genererCarteAdherent: jest.Mock; genererCarteBeneficiaire: jest.Mock };

  beforeEach(async () => {
    prisma = {
      souscripteur: { findFirst: jest.fn().mockResolvedValue(SOUSCRIPTEUR) },
      police: { findFirst: jest.fn() },
      adherent: {
        create: jest.fn().mockResolvedValue(ADHERENT_CREE),
        findFirst: jest.fn().mockResolvedValue({
          ...ADHERENT_CREE,
          beneficiaires: [],
          souscripteur: { id: 'sous-1', nom: 'ACME', type: 'ENTREPRISE' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      beneficiaire: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'ben-1', numeroCarte: 'CM-0000000043' }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'ben-1', statut: 'ACTIF' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ numero_carte: 'CM-0000000099' }]),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_EXPLOITATION'])),
    };
    cartes = {
      genererCarteAdherent: jest.fn().mockResolvedValue({ url: 'https://signed' }),
      genererCarteBeneficiaire: jest.fn().mockResolvedValue({ url: 'https://signed' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdherentService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
        { provide: MemberCarteService, useValue: cartes },
      ],
    }).compile();
    service = moduleRef.get(AdherentService);
  });

  it('crée un adhérent et expose les numéros générés en base', async () => {
    const res = await service.creerAdherent(USER, {
      souscripteurId: 'sous-1',
      nom: 'Konan',
      prenom: 'Yao',
      dateNaissance: '1990-05-14',
      sexe: 'M',
    });

    expect(prisma.adherent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-1',
          souscripteurId: 'sous-1',
          nom: 'Konan',
        }),
      }),
    );
    // pas de numero_adherent/numero_carte fournis : générés par la DB
    expect(prisma.adherent.create.mock.calls[0][0].data).not.toHaveProperty(
      'numeroAdherent',
    );
    expect(res.numeroAdherent).toBe('ADH-2026-000007');
    expect(res.numeroCarte).toBe('CM-0000000042');
    expect(prisma.$executeRaw).toHaveBeenCalled(); // audit
  });

  it('ajoute un bénéficiaire à un adhérent', async () => {
    const res = await service.ajouterBeneficiaire(USER, 'adh-1', {
      lienParente: 'ENFANT',
      nom: 'Konan',
      prenom: 'Awa',
      dateNaissance: '2015-03-02',
      sexe: 'F',
    });

    expect(prisma.beneficiaire.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adherentId: 'adh-1',
          lienParente: 'ENFANT',
        }),
      }),
    );
    expect(res).toMatchObject({ id: 'ben-1' });
  });

  it('refuse la création par un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.creerAdherent(USER, {
        souscripteurId: 'sous-1',
        nom: 'X',
        prenom: 'Y',
        dateNaissance: '1990-01-01',
        sexe: 'M',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('SOCIETE_ADMINISTRATION crée un adhérent pour SON souscripteur', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }),
    );
    await service.creerAdherent(USER, {
      souscripteurId: 'sous-1',
      nom: 'A',
      prenom: 'B',
      dateNaissance: '1990-01-01',
      sexe: 'F',
    });
    expect(prisma.adherent.create).toHaveBeenCalled();
  });

  it('SOCIETE_ADMINISTRATION ne peut PAS créer pour un autre souscripteur', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], { societeId: 'un-autre' }),
    );
    await expect(
      service.creerAdherent(USER, {
        souscripteurId: 'sous-1',
        nom: 'A',
        prenom: 'B',
        dateNaissance: '1990-01-01',
        sexe: 'F',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('change le statut d’un adhérent en RADIE (avec audit)', async () => {
    const res = await service.changerStatutAdherent(USER, 'adh-1', {
      statut: 'RADIE',
      motif: 'Départ',
    });

    expect(prisma.adherent.update).toHaveBeenCalledWith({
      where: { id: 'adh-1' },
      data: { statut: 'RADIE' },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(res).toBeDefined();
  });

  it('refuse un compte sans organisation', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_EXPLOITATION'], { organisationId: null }),
    );
    await expect(
      service.listerAdherents(USER, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Lecture scopée à TOUT rôle SOCIETE_AFFILIEE (pas seulement
  //  SOCIETE_ADMINISTRATION, qui seul a le droit d'écrire) — régression du
  //  filtrage étroit sur ROLE_GESTION_MEMBRE_SOCIETE (audit filière société).
  // ═══════════════════════════════════════════════════════════════════
  it('SOCIETE_ASSUREE ne liste que les adhérents de SA société', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ASSUREE'], {
        societeId: 'sous-1',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    await service.listerAdherents(USER, {});
    expect(prisma.adherent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ souscripteurId: 'sous-1' }),
      }),
    );
  });

  it('un souscripteurId fourni par une société n’élargit jamais son périmètre (filtre statut combiné)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], {
        societeId: 'sous-1',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    await service.listerAdherents(USER, {
      statut: 'PROPOSE_SORTANT',
      souscripteurId: 'sous-autre',
    });
    expect(prisma.adherent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          souscripteurId: 'sous-1',
          statut: 'PROPOSE_SORTANT',
        }),
      }),
    );
  });

  it('SOCIETE_COMPTABLE ne peut PAS lire un adhérent d’une autre société (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_COMPTABLE'], {
        societeId: 'une-autre-societe',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    await expect(
      service.obtenirAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SOCIETE_RECEPTION lit un adhérent de SA société', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_RECEPTION'], {
        societeId: 'sous-1',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    const res = await service.obtenirAdherent(USER, 'adh-1');
    expect(res).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Fuite inter-adhérent corrigée (audit dashboard adhérent, même famille
  //  que le fix reclamations du 2026-09-11) : un compte ADHERENT ne doit
  //  jamais voir/lister un adhérent autre que lui-même, même par ID direct.
  // ═══════════════════════════════════════════════════════════════════
  it('ADHERENT_TITULAIRE lit son propre enregistrement', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], {
        entite: 'ADHERENT',
        adherentId: 'adh-1',
      }),
    );
    const res = await service.obtenirAdherent(USER, 'adh-1');
    expect(res).toBeDefined();
  });

  it('ADHERENT_TITULAIRE ne peut PAS lire un autre adhérent par ID direct (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], {
        entite: 'ADHERENT',
        adherentId: 'adh-2',
      }),
    );
    await expect(
      service.obtenirAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ADHERENT_TITULAIRE ne liste que lui-même (jamais le fichier des membres)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], {
        entite: 'ADHERENT',
        adherentId: 'adh-1',
      }),
    );
    await service.listerAdherents(USER, {});
    expect(prisma.adherent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'adh-1' }),
      }),
    );
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Validation d'un adhérent PRINCIPAL — réservée EXCLUSIVEMENT à
  //  ASSUREUR_EXPLOITATION (jamais DIRECTION/INFORMATIQUE, qui peuvent
  //  pourtant créer l'adhérent — deux étapes distinctes). Gouverne la
  //  coupure de facturation mensuelle (billing/).
  // ═══════════════════════════════════════════════════════════════════
  describe('validerAdherent', () => {
    it('refuse ASSUREUR_DIRECTION (peut créer l’adhérent, pas le valider)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));
      await expect(service.validerAdherent(USER, 'adh-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adherent.update).not.toHaveBeenCalled();
    });

    it('refuse ASSUREUR_INFORMATIQUE', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      await expect(service.validerAdherent(USER, 'adh-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('adhérent introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.adherent.findFirst.mockResolvedValue(null);
      await expect(service.validerAdherent(USER, 'adh-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('déjà validé → 409, aucune écriture', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT_CREE, dateValidation: new Date('2026-08-01') });
      await expect(service.validerAdherent(USER, 'adh-1')).rejects.toMatchObject({ status: 409 });
      expect(prisma.adherent.update).not.toHaveBeenCalled();
    });

    it('ASSUREUR_EXPLOITATION valide : stampe dateValidation et valideParId', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.adherent.findFirst.mockResolvedValueOnce({ ...ADHERENT_CREE, dateValidation: null });

      await service.validerAdherent(USER, 'adh-1');

      expect(prisma.adherent.update).toHaveBeenCalledWith({
        where: { id: 'adh-1' },
        data: { dateValidation: expect.any(Date), valideParId: 'u1' },
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Recherche par numéro de carte (accueil centre médical) — ADDITIF au
  //  code de consultation, purement informatif, réservé à
  //  CENTRE_MEDICAL_ACCUEIL exclusivement.
  // ═══════════════════════════════════════════════════════════════════
  describe('rechercherParNumeroCarte', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(
        identite(['CENTRE_MEDICAL_ACCUEIL']),
      );
      prisma.adherent.findFirst.mockResolvedValue(null);
      prisma.beneficiaire = {
        ...prisma.beneficiaire,
        findFirst: jest.fn().mockResolvedValue(null),
      };
    });

    it('renvoie le statut d’un adhérent titulaire trouvé par numéro de carte', async () => {
      prisma.adherent.findFirst.mockResolvedValue({
        id: 'adh-1',
        nom: 'Konan',
        prenom: 'Yao',
        statut: 'ACTIF',
        numeroCarte: 'CM-0000000042',
        numeroAdherent: 'ADH-2026-000007',
      });

      const res = await service.rechercherParNumeroCarte(USER, 'CM-0000000042');

      expect(res).toMatchObject({ type: 'ADHERENT_TITULAIRE', statut: 'ACTIF' });
      expect(prisma.beneficiaire.findFirst).not.toHaveBeenCalled();
    });

    it('renvoie le statut d’un bénéficiaire trouvé par numéro de carte (adhérent introuvable)', async () => {
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1',
        nom: 'Konan',
        prenom: 'Awa',
        statut: 'SUSPENDU',
        numeroCarte: 'CM-0000000043',
        lienParente: 'CONJOINT',
        adherent: { id: 'adh-1', nom: 'Konan', prenom: 'Yao', statut: 'ACTIF' },
      });

      const res = await service.rechercherParNumeroCarte(USER, 'CM-0000000043');

      expect(res).toMatchObject({ type: 'BENEFICIAIRE', statut: 'SUSPENDU' });
    });

    it('aucun membre trouvé → 404', async () => {
      await expect(
        service.rechercherParNumeroCarte(USER, 'CM-9999999999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('numéro de carte vide → 400 (sans jamais appeler Prisma)', async () => {
      await expect(
        service.rechercherParNumeroCarte(USER, '  '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.adherent.findFirst).not.toHaveBeenCalled();
    });

    it('rôle non habilité (médecin du même centre) → 403', async () => {
      identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN']));
      await expect(
        service.rechercherParNumeroCarte(USER, 'CM-0000000042'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adherent.findFirst).not.toHaveBeenCalled();
    });

    it('personnel ASSUREUR → 403 (réservé exclusivement à l’accueil du centre médical)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      await expect(
        service.rechercherParNumeroCarte(USER, 'CM-0000000042'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('scope par organisation : ne trouve pas un adhérent d’une autre organisation', async () => {
      await service.rechercherParNumeroCarte(USER, 'CM-0000000042').catch(() => {});
      expect(prisma.adherent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organisationId: 'org-1' }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Bénéficiaires proposés par l'ADHÉRENT lui-même — double validation
  //  (EN_ATTENTE_SOCIETE → EN_ATTENTE_ASSUREUR → ACTIF, carte attribuée au
  //  tout dernier moment) + immutabilité post-carte + photo sans validation.
  // ═══════════════════════════════════════════════════════════════════════
  describe('proposerMonBeneficiaire', () => {
    it('refuse un compte non ADHERENT (ex. SOCIETE_ADMINISTRATION)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      await expect(
        service.proposerMonBeneficiaire(USER, {
          lienParente: 'ENFANT', nom: 'Petit', prenom: 'Yao', dateNaissance: '2015-03-10', sexe: 'M',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.beneficiaire.create).not.toHaveBeenCalled();
    });

    it('crée le bénéficiaire EN_ATTENTE_SOCIETE, sans numéro de carte', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.create.mockResolvedValue({ id: 'ben-1', statut: 'EN_ATTENTE_SOCIETE', numeroCarte: null });
      prisma.beneficiaire.findFirst.mockResolvedValue({ id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_SOCIETE', numeroCarte: null });

      await service.proposerMonBeneficiaire(USER, {
        lienParente: 'ENFANT', nom: 'Petit', prenom: 'Yao', dateNaissance: '2015-03-10', sexe: 'M',
      });

      expect(prisma.beneficiaire.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ adherentId: 'adh-1', numeroCarte: null, statut: 'EN_ATTENTE_SOCIETE' }),
        }),
      );
    });
  });

  describe('modifierMonBeneficiaire', () => {
    it('refuse un compte non ADHERENT', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      await expect(
        service.modifierMonBeneficiaire(USER, 'ben-1', { nom: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('autorise la modification tant que numeroCarte est null (EN_ATTENTE_SOCIETE ou EN_ATTENTE_ASSUREUR)', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_ASSUREUR', numeroCarte: null,
      });
      prisma.beneficiaire.update.mockResolvedValue({});

      await service.modifierMonBeneficiaire(USER, 'ben-1', { nom: 'Corrige' });

      expect(prisma.beneficiaire.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ben-1' }, data: expect.objectContaining({ nom: 'Corrige' }) }),
      );
    });

    it('refuse (409) dès que numeroCarte est renseigné — immuable pour l’adhérent', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', statut: 'ACTIF', numeroCarte: 'CM-0000000099',
      });

      await expect(
        service.modifierMonBeneficiaire(USER, 'ben-1', { nom: 'Trop-tard' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.beneficiaire.update).not.toHaveBeenCalled();
    });

    it('404 si le bénéficiaire n’appartient pas à l’appelant', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue(null);
      await expect(
        service.modifierMonBeneficiaire(USER, 'ben-autre', { nom: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('validerBeneficiaireSociete', () => {
    it('refuse un rôle autre que SOCIETE_ADMINISTRATION', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], { societeId: 'sous-1' }));
      await expect(
        service.validerBeneficiaireSociete(USER, 'ben-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si le bénéficiaire appartient à une AUTRE société (pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_SOCIETE',
        adherent: { organisationId: 'org-1', souscripteurId: 'sous-AUTRE' },
      });
      await expect(
        service.validerBeneficiaireSociete(USER, 'ben-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 si le bénéficiaire n’est pas EN_ATTENTE_SOCIETE', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_ASSUREUR',
        adherent: { organisationId: 'org-1', souscripteurId: 'sous-1' },
      });
      await expect(
        service.validerBeneficiaireSociete(USER, 'ben-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('EN_ATTENTE_SOCIETE → EN_ATTENTE_ASSUREUR, sans carte', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.beneficiaire.findFirst
        .mockResolvedValueOnce({
          id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_SOCIETE',
          adherent: { organisationId: 'org-1', souscripteurId: 'sous-1' },
        })
        .mockResolvedValueOnce({ id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_ASSUREUR', numeroCarte: null });
      prisma.beneficiaire.update.mockResolvedValue({});

      const res = await service.validerBeneficiaireSociete(USER, 'ben-1');

      expect(prisma.beneficiaire.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ben-1' }, data: { statut: 'EN_ATTENTE_ASSUREUR' } }),
      );
      expect(res.statut).toBe('EN_ATTENTE_ASSUREUR');
    });
  });

  describe('validerBeneficiaireAssureur', () => {
    it('refuse un rôle non habilité (ex. SOCIETE_ADMINISTRATION)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      await expect(
        service.validerBeneficiaireAssureur(USER, 'ben-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409 si le bénéficiaire n’est pas EN_ATTENTE_ASSUREUR', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_SOCIETE',
        adherent: { id: 'adh-1', organisationId: 'org-1' },
      });
      await expect(
        service.validerBeneficiaireAssureur(USER, 'ben-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('EN_ATTENTE_ASSUREUR → ACTIF : attribue le numéro de carte et génère la carte automatiquement', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.beneficiaire.findFirst
        .mockResolvedValueOnce({
          id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_ASSUREUR',
          adherent: { id: 'adh-1', organisationId: 'org-1' },
        })
        .mockResolvedValueOnce({ id: 'ben-1', adherentId: 'adh-1', statut: 'ACTIF', numeroCarte: 'CM-0000000099' });
      prisma.$queryRaw.mockResolvedValue([{ numero_carte: 'CM-0000000099' }]);

      const res = await service.validerBeneficiaireAssureur(USER, 'ben-1');

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(cartes.genererCarteBeneficiaire).toHaveBeenCalledWith(USER, 'adh-1', 'ben-1');
      expect(res.statut).toBe('ACTIF');
      expect(res.echecCarte).toBeNull();
    });

    it('un échec de génération de carte ne bloque pas la validation (tolérant, comme validerImportAdherents)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.beneficiaire.findFirst
        .mockResolvedValueOnce({
          id: 'ben-1', adherentId: 'adh-1', statut: 'EN_ATTENTE_ASSUREUR',
          adherent: { id: 'adh-1', organisationId: 'org-1' },
        })
        .mockResolvedValueOnce({ id: 'ben-1', adherentId: 'adh-1', statut: 'ACTIF', numeroCarte: 'CM-0000000099' });
      prisma.$queryRaw.mockResolvedValue([{ numero_carte: 'CM-0000000099' }]);
      cartes.genererCarteBeneficiaire.mockRejectedValue(new Error('Storage indisponible'));

      const res = await service.validerBeneficiaireAssureur(USER, 'ben-1');

      expect(res.statut).toBe('ACTIF');
      expect(res.echecCarte).toBe('Storage indisponible');
    });
  });

  describe('photo de profil (adhérent + bénéficiaires)', () => {
    const okFetch = () =>
      jest
        .fn()
        .mockResolvedValueOnce({ ok: true }) // upload
        .mockResolvedValueOnce({ ok: true, json: async () => ({ signedURL: '/object/sign/photos/x?token=abc' }) }); // sign

    beforeEach(() => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    });

    it('televerserPhotoAdherent : refuse pour un adhérent autre que soi-même', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      await expect(
        service.televerserPhotoAdherent(USER, 'adh-AUTRE', {
          buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('televerserPhotoAdherent : refuse un format non image', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      await expect(
        service.televerserPhotoAdherent(USER, 'adh-1', {
          buffer: Buffer.from('x'), originalname: 'p.pdf', mimetype: 'application/pdf', size: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('televerserPhotoAdherent : téléverse dans le dossier famille, nommé {NOM}-{2 lettres société}-{numeroCarte}', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      global.fetch = okFetch() as any;

      // Mock par défaut (beforeEach) : nom 'Konan', numeroCarte 'CM-0000000042',
      // souscripteur 'ACME' → dossier attendu KONAN-AC-CM0000000042 (le tiret
      // du numéro de carte disparaît, cf. exemple DIALLO-AC-CM0000000007).
      const res = await service.televerserPhotoAdherent(USER, 'adh-1', {
        buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100,
      });

      expect(prisma.adherent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adh-1' },
          data: { photoUrl: 'org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-CM0000000042.jpg' },
        }),
      );
      expect(res.url).toContain('/object/sign/photos/x');
    });

    it('televerserPhotoAdherent : normalise accents/espaces/ponctuation du nom (jamais un chemin dangereux)', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT_CREE,
        nom: "N'Guessan Éric",
        numeroCarte: 'CM-0000000099',
        beneficiaires: [],
        souscripteur: { id: 'sous-1', nom: 'Assurance Côte-Ivoire', type: 'ENTREPRISE' },
      });
      global.fetch = okFetch() as any;

      await service.televerserPhotoAdherent(USER, 'adh-1', {
        buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100,
      });

      expect(prisma.adherent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { photoUrl: 'org-1/familles/NGUESSAN_ERIC-AS-CM0000000099/NGUESSAN_ERIC-AS-CM0000000099.jpg' },
        }),
      );
    });

    it('televerserPhotoBeneficiaire : refuse si le bénéficiaire n’appartient pas à l’appelant', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue(null);
      await expect(
        service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-autre', {
          buffer: Buffer.from('img'), originalname: 'p.png', mimetype: 'image/png', size: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('televerserPhotoBeneficiaire : téléverse DANS LE MÊME dossier famille que l’adhérent, nommé avec SES propres nom/numéro', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', nom: 'Konan', numeroCarte: 'CM-0000000043',
      });
      global.fetch = okFetch() as any;

      await service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-1', {
        buffer: Buffer.from('img'), originalname: 'p.png', mimetype: 'image/png', size: 100,
      });

      // Même dossier famille (KONAN-AC-CM0000000042, dérivé de l'ADHÉRENT) mais
      // un fichier au nom du BÉNÉFICIAIRE (son propre numéro de carte, ici
      // volontairement différent : CM0000000043 ≠ celui de l'adhérent).
      expect(prisma.beneficiaire.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ben-1' },
          data: { photoUrl: 'org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-CM0000000043.png' },
        }),
      );
    });

    it('televerserPhotoBeneficiaire : numeroCarte pas encore attribué (double validation en cours) → repli sur son id, jamais bloqué', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-en-attente', adherentId: 'adh-1', nom: 'Konan', numeroCarte: null,
      });
      global.fetch = okFetch() as any;

      await service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-en-attente', {
        buffer: Buffer.from('img'), originalname: 'p.png', mimetype: 'image/png', size: 100,
      });

      // L'id de repli est normalisé comme tout le reste (majuscules, tirets
      // retirés) — cohérent avec le traitement d'un numeroCarte réel.
      expect(prisma.beneficiaire.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { photoUrl: 'org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-BENENATTENTE.png' },
        }),
      );
    });

    it('sans collision possible par construction : adhérent et bénéficiaire ayant le même NOM restent distincts (numeroCarte, déjà unique en base, diffère forcément)', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      // Même nom de famille que l'adhérent (Konan) ET même société — seul le
      // numeroCarte distingue les deux fichiers, exactement le scénario du
      // point 5 de la demande.
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', nom: 'Konan', numeroCarte: 'CM-0000000050',
      });
      global.fetch = okFetch() as any;

      await service.televerserPhotoAdherent(USER, 'adh-1', {
        buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100,
      });
      const cheminAdherent = (prisma.adherent.update as jest.Mock).mock.calls[0][0].data.photoUrl;

      global.fetch = okFetch() as any;
      await service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-1', {
        buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100,
      });
      const cheminBeneficiaire = (prisma.beneficiaire.update as jest.Mock).mock.calls[0][0].data.photoUrl;

      expect(cheminAdherent).not.toBe(cheminBeneficiaire);
      expect(cheminAdherent).toBe('org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-CM0000000042.jpg');
      expect(cheminBeneficiaire).toBe('org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-CM0000000050.jpg');
    });

    // --- Personnel habilité (ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION) ---

    const PHOTO = { buffer: Buffer.from('img'), originalname: 'p.jpg', mimetype: 'image/jpeg', size: 100 };

    it.each(['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE_ADJOINT'])(
      'personnel %s : photo d’un adhérent de SON organisation → même dossier/nom que le self-service',
      async (role) => {
        const chaine = role.endsWith('_ADJOINT') ? [role, role.replace('_ADJOINT', '')] : [role];
        identity.getMe.mockResolvedValue(identite(chaine));
        global.fetch = okFetch() as any;

        await service.televerserPhotoAdherent(USER, 'adh-1', PHOTO);

        expect(prisma.adherent.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'adh-1', organisationId: 'org-1', deletedAt: null } }),
        );
        expect(prisma.adherent.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { photoUrl: 'org-1/familles/KONAN-AC-CM0000000042/KONAN-AC-CM0000000042.jpg' },
          }),
        );
      },
    );

    it('personnel : photo d’un bénéficiaire → MÊME dossier famille, nommé avec ses propres nom/numéro (identique au self-service)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.beneficiaire.findFirst.mockResolvedValue({
        id: 'ben-1', adherentId: 'adh-1', nom: 'Aya Konan', numeroCarte: 'CM-0000000043',
      });
      global.fetch = okFetch() as any;

      await service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-1', PHOTO);

      expect(prisma.beneficiaire.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ben-1', adherentId: 'adh-1', deletedAt: null } }),
      );
      expect(prisma.beneficiaire.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { photoUrl: 'org-1/familles/KONAN-AC-CM0000000042/AYA_KONAN-AC-CM0000000043.jpg' },
        }),
      );
    });

    it('personnel : adhérent d’une AUTRE organisation → 404, rien n’est téléversé ni modifié', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE'], { organisationId: 'org-2' }));
      prisma.adherent.findFirst.mockResolvedValue(null); // filtré par organisationId: 'org-2'
      global.fetch = jest.fn() as any;

      await expect(service.televerserPhotoAdherent(USER, 'adh-1', PHOTO)).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-1', PHOTO),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.adherent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-2' }) }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(prisma.adherent.update).not.toHaveBeenCalled();
      expect(prisma.beneficiaire.update).not.toHaveBeenCalled();
    });

    it('personnel : bénéficiaire rattaché à un AUTRE adhérent → 404 (jamais de confiance dans le couple d’ids)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.beneficiaire.findFirst.mockResolvedValue(null); // where { adherentId: 'adh-1' } ne trouve rien
      global.fetch = jest.fn() as any;

      await expect(
        service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-dun-autre', PHOTO),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each([
      ['ASSUREUR_COMPTABLE', {}],
      ['ASSUREUR_DIRECTION', {}],
      ['SOCIETE_ADMINISTRATION', { entite: 'SOCIETE_AFFILIEE', societeId: 'sous-1' }],
      ['CENTRE_MEDICAL_ACCUEIL', {}],
    ])('rôle non habilité %s → 403, rien n’est téléversé', async (role, extra) => {
      identity.getMe.mockResolvedValue(identite([role], extra));
      global.fetch = jest.fn() as any;

      await expect(service.televerserPhotoAdherent(USER, 'adh-1', PHOTO)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.televerserPhotoBeneficiaire(USER, 'adh-1', 'ben-1', PHOTO),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('self-service inchangé : un adhérent ne peut toujours pas viser le dossier d’un autre, même avec le nouveau chemin personnel', async () => {
      identity.getMe.mockResolvedValue(
        identite(['ADHERENT_TITULAIRE', 'ASSUREUR_INFORMATIQUE'], { entite: 'ADHERENT', adherentId: 'adh-1' }),
      );
      await expect(service.televerserPhotoAdherent(USER, 'adh-AUTRE', PHOTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('obtenirPhotoAdherent : 404 si aucune photo', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT_CREE, id: 'adh-1', beneficiaires: [], souscripteur: null, photoUrl: null,
      });
      await expect(service.obtenirPhotoAdherent(USER, 'adh-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('obtenirPhotoAdherent : renvoie une URL signée fraîche à partir du chemin stocké', async () => {
      identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE'], { entite: 'ADHERENT', adherentId: 'adh-1' }));
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT_CREE, id: 'adh-1', beneficiaires: [], souscripteur: null, photoUrl: 'org-1/adherents/adh-1/photo.jpg',
      });
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ signedURL: '/object/sign/photos/y?token=zzz' }) }) as any;

      const res = await service.obtenirPhotoAdherent(USER, 'adh-1');
      expect(res.url).toContain('/object/sign/photos/y');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Mouvements de personnel — SORTANTS (prisma/sql/056) : proposition
  //  immédiate (statut PROPOSE_SORTANT), effective seulement après validation
  //  ASSUREUR_INFORMATIQUE/EXPLOITATION — aucun report au mois suivant ici
  //  (à la différence des entrants, cf. import-adherents.service.spec.ts).
  // ═══════════════════════════════════════════════════════════════════════
  describe('proposerSortants', () => {
    const DTO = {
      souscripteurId: 'sous-1',
      sortants: [{ adherentId: 'adh-1', statutCible: 'RADIE', motif: 'Départ de l’entreprise' }],
    };

    it('refuse un rôle autre que SOCIETE_ADMINISTRATION (ex. SOCIETE_ASSUREE)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], { societeId: 'sous-1' }));
      await expect(service.proposerSortants(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adherent.update).not.toHaveBeenCalled();
    });

    it('refuse une AUTRE société que la sienne', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-AUTRE' }));
      await expect(service.proposerSortants(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si un adherentId n’appartient pas à ce souscripteur', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.adherent.findFirst.mockResolvedValue(null);
      await expect(service.proposerSortants(USER, DTO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 si l’adhérent n’est pas ACTIF', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT_CREE, statut: 'SUSPENDU' });
      await expect(service.proposerSortants(USER, DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.adherent.update).not.toHaveBeenCalled();
    });

    it('statut → PROPOSE_SORTANT, statutSortantCible et motif enregistrés', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT_CREE, statut: 'ACTIF' });
      prisma.adherent.update.mockResolvedValue({});

      const res = await service.proposerSortants(USER, DTO);

      expect(prisma.adherent.update).toHaveBeenCalledWith({
        where: { id: 'adh-1' },
        data: { statut: 'PROPOSE_SORTANT', statutSortantCible: 'RADIE', motifSortie: 'Départ de l’entreprise' },
      });
      expect(res.propositions).toEqual([{ adherentId: 'adh-1', statut: 'PROPOSE_SORTANT' }]);
    });

    it('applique plusieurs sortants du même lot', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT_CREE, statut: 'ACTIF' });
      prisma.adherent.update.mockResolvedValue({});

      const res = await service.proposerSortants(USER, {
        souscripteurId: 'sous-1',
        sortants: [
          { adherentId: 'adh-1', statutCible: 'RADIE', motif: 'Départ' },
          { adherentId: 'adh-2', statutCible: 'SUSPENDU', motif: 'Congé longue durée' },
        ],
      });
      expect(res.propositions).toHaveLength(2);
      expect(prisma.adherent.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('validerSortants', () => {
    const DTO = { adherentIds: ['adh-1'] };

    it('refuse un rôle non habilité (SOCIETE_ADMINISTRATION lui-même)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }));
      await expect(service.validerSortants(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuse ASSUREUR_COMPTABLE (importeur, jamais validateur)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      await expect(service.validerSortants(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si l’adhérent est introuvable', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.adherent.findFirst.mockResolvedValue(null);
      await expect(service.validerSortants(USER, DTO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 si l’adhérent n’est pas PROPOSE_SORTANT', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT_CREE, statut: 'ACTIF', statutSortantCible: null });
      await expect(service.validerSortants(USER, DTO)).rejects.toBeInstanceOf(ConflictException);
    });

    it('PROPOSE_SORTANT → statutSortantCible (RADIE), immédiatement', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT_CREE, statut: 'PROPOSE_SORTANT', statutSortantCible: 'RADIE', motifSortie: 'Départ',
      });
      prisma.adherent.update.mockResolvedValue({});

      const res = await service.validerSortants(USER, DTO);

      expect(prisma.adherent.update).toHaveBeenCalledWith({
        where: { id: 'adh-1' },
        data: { statut: 'RADIE' },
      });
      expect(res.validations).toEqual([{ adherentId: 'adh-1', statut: 'RADIE' }]);
    });

    it('PROPOSE_SORTANT → statutSortantCible (SUSPENDU)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT_CREE, statut: 'PROPOSE_SORTANT', statutSortantCible: 'SUSPENDU', motifSortie: 'Congé',
      });
      prisma.adherent.update.mockResolvedValue({});

      const res = await service.validerSortants(USER, { adherentIds: ['adh-1'] });
      expect(res.validations).toEqual([{ adherentId: 'adh-1', statut: 'SUSPENDU' }]);
    });
  });
});
