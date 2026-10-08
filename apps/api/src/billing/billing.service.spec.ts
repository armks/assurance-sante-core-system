import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});


/** Prisma Decimal-like : suffit d'avoir toFixed / toString pour le service. */
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'compta@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[]) {
  return {
    profil: {
      id: 'u1',
      organisationId: 'org-1',
      entite: 'ASSUREUR',
      societeId: null,
    },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

const POLICE = {
  id: 'po1',
  organisationId: 'org-1',
  souscripteurId: 's1',
  produitId: 'pr1',
  statut: 'ACTIVE',
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      police: { findFirst: jest.fn() },
      produit: { findFirst: jest.fn() },
      souscripteur: { findFirst: jest.fn(), findUnique: jest.fn() },
      grilleTarifaire: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      adherent: { findFirst: jest.fn(), findMany: jest.fn() },
      planPaiementCollectivite: { findFirst: jest.fn() },
      cotisation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  it('calcule avec le tarif STANDARD par tranche d’âge', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst
      .mockResolvedValueOnce(null) // pas de tarif négocié
      .mockResolvedValueOnce({
        id: 'g-std',
        montantMensuel: '12000',
        trancheAgeMin: 18,
        trancheAgeMax: 59,
      });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 35,
    });

    expect(res).toEqual({
      montantDu: '12000.00',
      tarifBase: '12000.00',
      source: 'STANDARD',
      partMembrePourcent: 100,
      grilleTarifaireId: 'g-std',
    });
  });

  it('le tarif NÉGOCIÉ société prend priorité sur le standard', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst.mockResolvedValueOnce({
      id: 'g-nego',
      montantMensuel: '9500',
      trancheAgeMin: 18,
      trancheAgeMax: 59,
    });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 35,
    });

    expect(res.source).toBe('NEGOCIE');
    expect(res.montantDu).toBe('9500.00');
    // le tarif standard n'a même pas été interrogé
    expect(prisma.grilleTarifaire.findFirst).toHaveBeenCalledTimes(1);
  });

  it('applique part_membre_pourcent pour une COLLECTIVITE subventionnée', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'g-std', montantMensuel: '10000' });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'COLLECTIVITE' });
    prisma.planPaiementCollectivite.findFirst.mockResolvedValue({
      partMembrePourcent: '70.00',
    });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 40,
    });

    // 10000 * 70 / 100 = 7000.00 (part du membre)
    expect(res.montantDu).toBe('7000.00');
    expect(res.tarifBase).toBe('10000.00');
    expect(res.partMembrePourcent).toBe(70);
  });

  it('passe en EN_RETARD les cotisations échues (pénalité 0 par défaut)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.cotisation.findMany.mockResolvedValue([
      {
        id: 'c1',
        montantDu: '5000',
        statut: 'A_PAYER',
        police: { produitId: 'pr1' },
      },
    ]);

    const res = await service.marquerEnRetard(USER);

    expect(res).toEqual({ misEnRetard: 1 });
    expect(prisma.cotisation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { statut: 'EN_RETARD', penaliteAppliquee: '0.00' },
    });
  });

  it('refuse la facturation à un rôle non habilité (exploitation)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    await expect(
      service.marquerEnRetard(USER),
    ).rejects.toMatchObject({ status: 403 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Grilles tarifaires — périmètre EXCLUSIF ASSUREUR_INFORMATIQUE (prisma/sql/052) :
  //  ASSUREUR_COMPTABLE peut désormais générer des cotisations mais ne doit
  //  jamais pouvoir créer/modifier une grille tarifaire.
  // ═══════════════════════════════════════════════════════════════════════
  describe('creerGrille', () => {
    const DTO = { produitId: 'pr1', trancheAgeMin: 18, trancheAgeMax: 59, montantMensuel: 10000 };

    it('refuse ASSUREUR_COMPTABLE (exclu des grilles tarifaires)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      await expect(service.creerGrille(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.grilleTarifaire.create).not.toHaveBeenCalled();
    });

    it('autorise ASSUREUR_INFORMATIQUE', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.produit.findFirst.mockResolvedValue({ id: 'pr1' });
      prisma.grilleTarifaire.findFirst.mockResolvedValue(null);
      prisma.grilleTarifaire.create.mockResolvedValue({ id: 'g-1' });

      const res = await service.creerGrille(USER, DTO);
      expect(res.id).toBe('g-1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Coupure de facturation mensuelle (prisma/sql/052) — adhérent PRINCIPAL
  //  validé par ASSUREUR_EXPLOITATION avant le 1er du mois inclus dans la
  //  facturation de ce mois ; validé après (ou jamais) → reporté.
  // ═══════════════════════════════════════════════════════════════════════
  describe('genererCotisationsPeriode — coupure de facturation', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.police.findFirst.mockResolvedValue(POLICE);
      prisma.cotisation.findFirst.mockResolvedValue(null);
      prisma.grilleTarifaire.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'g-std', montantMensuel: '10000' });
      prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });
      prisma.cotisation.create.mockResolvedValue({ id: 'c-1', montantDu: dec(10000) });
    });

    it('adhérent validé AVANT le 1er du mois → cotisation générée', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ id: 'a1', dateValidation: new Date('2026-08-25T00:00:00Z') });

      const res = await service.genererCotisationsPeriode(USER, 'po1', {
        periode: '2026-09-01',
        adherents: [{ adherentId: 'a1', age: 35 }],
      });

      expect(res.generees).toBe(1);
      expect(res.reportees).toBe(0);
      expect(prisma.cotisation.create).toHaveBeenCalledTimes(1);
    });

    it('adhérent validé APRÈS le 1er du mois → reporté, aucune cotisation créée', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ id: 'a2', dateValidation: new Date('2026-09-02T00:00:00Z') });

      const res = await service.genererCotisationsPeriode(USER, 'po1', {
        periode: '2026-09-01',
        adherents: [{ adherentId: 'a2', age: 35 }],
      });

      expect(res.generees).toBe(0);
      expect(res.reportees).toBe(1);
      expect(prisma.cotisation.create).not.toHaveBeenCalled();
      expect(res.cotisations).toEqual([expect.objectContaining({ adherentId: 'a2', reportee: true })]);
    });

    it('même adhérent (validé le 2) redemandé pour le mois SUIVANT → généré', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ id: 'a2', dateValidation: new Date('2026-09-02T00:00:00Z') });

      const res = await service.genererCotisationsPeriode(USER, 'po1', {
        periode: '2026-10-01',
        adherents: [{ adherentId: 'a2', age: 35 }],
      });

      expect(res.generees).toBe(1);
      expect(res.reportees).toBe(0);
    });

    it('adhérent jamais validé (dateValidation null) → reporté', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ id: 'a3', dateValidation: null });

      const res = await service.genererCotisationsPeriode(USER, 'po1', {
        periode: '2026-09-01',
        adherents: [{ adherentId: 'a3', age: 35 }],
      });

      expect(res.reportees).toBe(1);
      expect(prisma.cotisation.create).not.toHaveBeenCalled();
    });

    it('adhérent introuvable → 404', async () => {
      prisma.adherent.findFirst.mockResolvedValue(null);

      await expect(
        service.genererCotisationsPeriode(USER, 'po1', {
          periode: '2026-09-01',
          adherents: [{ adherentId: 'a-x', age: 35 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cotisation déjà existante → dedup, jamais reportée ni recréée', async () => {
      prisma.cotisation.findFirst.mockResolvedValue({ id: 'c-existe', montantDu: dec(10000) });

      const res = await service.genererCotisationsPeriode(USER, 'po1', {
        periode: '2026-09-01',
        adherents: [{ adherentId: 'a1', age: 35 }],
      });

      expect(res.generees).toBe(0);
      expect(res.reportees).toBe(0);
      expect(res.cotisations).toEqual([expect.objectContaining({ deja: true })]);
      expect(prisma.adherent.findFirst).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Écran comptable « Liste des adhérents pour facturation » + « Consolider
  //  et valider la facture société ».
  // ═══════════════════════════════════════════════════════════════════════
  describe('listerAdherentsPourFacturation', () => {
    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      await expect(
        service.listerAdherentsPourFacturation(USER, 's1', '2026-09-01'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('souscripteur introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue(null);
      await expect(
        service.listerAdherentsPourFacturation(USER, 's-x', '2026-09-01'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne renvoie que les adhérents validés avant la coupure, avec âge et nbBeneficiaires', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 's1' });
      prisma.adherent.findMany.mockResolvedValue([
        {
          id: 'a1',
          numeroAdherent: 'ADH-1',
          nom: 'Yao',
          prenom: 'Awa',
          dateNaissance: new Date('1990-06-15T00:00:00Z'),
          dateValidation: new Date('2026-08-25T00:00:00Z'),
          policeId: 'po1',
          police: { id: 'po1', numeroPolice: 'POL-1', statut: 'ACTIVE' },
          beneficiaires: [{ id: 'b1' }, { id: 'b2' }],
        },
      ]);

      const res = await service.listerAdherentsPourFacturation(USER, 's1', '2026-09-01');

      expect(prisma.adherent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            souscripteurId: 's1',
            statut: 'ACTIF',
            dateValidation: { not: null, lt: new Date('2026-09-01T00:00:00.000Z') },
          }),
        }),
      );
      expect(res).toEqual([
        expect.objectContaining({ id: 'a1', age: 36, nbBeneficiaires: 2 }),
      ]);
    });
  });

  describe('consoliderFacturationSociete', () => {
    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      await expect(
        service.consoliderFacturationSociete(USER, 's1', '2026-09-01'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('aucune police ACTIVE → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 's1' });
      prisma.police.findFirst.mockResolvedValue(null);
      await expect(
        service.consoliderFacturationSociete(USER, 's1', '2026-09-01'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('facture société déjà consolidée pour cette période → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 's1' });
      prisma.police.findFirst.mockResolvedValue(POLICE);
      prisma.cotisation.findFirst.mockResolvedValue({ id: 'c-deja', montantDu: dec(50000) });
      await expect(
        service.consoliderFacturationSociete(USER, 's1', '2026-09-01'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('aucun adhérent éligible (tous après la coupure) → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 's1' });
      prisma.police.findFirst.mockResolvedValue(POLICE);
      prisma.cotisation.findFirst.mockResolvedValue(null);
      prisma.adherent.findMany.mockResolvedValue([]);
      await expect(
        service.consoliderFacturationSociete(USER, 's1', '2026-09-01'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('consolide : génère les cotisations individuelles éligibles puis une cotisation société sommant leurs montants', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 's1' });
      prisma.police.findFirst.mockResolvedValue(POLICE);
      // 1er findFirst cotisation : vérif « déjà consolidée » → aucune.
      prisma.cotisation.findFirst.mockResolvedValueOnce(null);
      prisma.adherent.findMany.mockResolvedValue([
        { id: 'a1', dateNaissance: new Date('1990-06-15T00:00:00Z') },
        { id: 'a2', dateNaissance: new Date('1985-01-01T00:00:00Z') },
      ]);
      // Boucle genererCotisationsPeriode (dedup interne) : aucune cotisation existante pour a1/a2.
      prisma.cotisation.findFirst.mockResolvedValue(null);
      prisma.adherent.findFirst
        .mockResolvedValueOnce({ id: 'a1', dateValidation: new Date('2026-08-01T00:00:00Z') })
        .mockResolvedValueOnce({ id: 'a2', dateValidation: new Date('2026-08-15T00:00:00Z') });
      prisma.grilleTarifaire.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'g-std', montantMensuel: '10000' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'g-std', montantMensuel: '10000' });
      prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });
      prisma.cotisation.create.mockResolvedValue({ id: 'c-ind', montantDu: dec(10000) });
      // Somme finale des cotisations individuelles créées pour a1/a2.
      prisma.cotisation.findMany.mockResolvedValue([
        { id: 'c-a1', montantDu: dec(10000) },
        { id: 'c-a2', montantDu: dec(10000) },
      ]);

      const consolideeCreee = { id: 'c-societe', montantDu: dec(20000) };
      prisma.cotisation.create.mockResolvedValueOnce({ id: 'c-ind1', montantDu: dec(10000) });
      prisma.cotisation.create.mockResolvedValueOnce({ id: 'c-ind2', montantDu: dec(10000) });
      prisma.cotisation.create.mockResolvedValueOnce(consolideeCreee);

      const res = await service.consoliderFacturationSociete(USER, 's1', '2026-09-01');

      expect(prisma.cotisation.create).toHaveBeenCalledTimes(3);
      expect(prisma.cotisation.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            societeId: 's1',
            adherentId: null,
            montantDu: '20000.00',
            statut: 'A_PAYER',
          }),
        }),
      );
      expect(res.montantDu).toBe('20000.00');
      expect(res.nbAdherentsFactures).toBe(2);
      expect(res.nbAdherentsReportes).toBe(0);
    });
  });
});
