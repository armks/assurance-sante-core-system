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
      acteDossier: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      garantie: { findFirst: jest.fn().mockResolvedValue(null) },
      referentielActe: { findFirst: jest.fn().mockResolvedValue(null) },
      tarifConventionne: { findFirst: jest.fn().mockResolvedValue(null) },
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

    it('sans montantPrescrit → aucune simulation (null sur les 3 colonnes)', async () => {
      await service.ajouterActe(USER, 'tkt-1', ACTE);
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: null,
            montantSimulePatient: null,
            ticketModerateurSimule: null,
          }),
        }),
      );
      expect(prisma.garantie.findFirst).not.toHaveBeenCalled();
    });

    it('sans garantie correspondant à la catégorie d’acte → aucune simulation', async () => {
      prisma.garantie.findFirst.mockResolvedValue(null);
      await service.ajouterActe(USER, 'tkt-1', ACTE_AVEC_MONTANT);
      expect(prisma.acteDossier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            montantSimuleAssurance: null,
            montantSimulePatient: null,
            ticketModerateurSimule: null,
          }),
        }),
      );
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
      categorieActe: 'BIOLOGIE',
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
});
