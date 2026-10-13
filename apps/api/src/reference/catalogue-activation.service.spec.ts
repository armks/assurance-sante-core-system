import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueActivationService } from './catalogue-activation.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'x@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};
const ID = '11111111-1111-4111-8111-111111111111';

const identite = (role: string) => ({
  profil: { id: 'u1', organisationId: 'org-1' },
  permissions: { roleChain: [role] },
});

describe('CatalogueActivationService — le référentiel de l’assureur est le catalogue national (ADR-009)', () => {
  let service: CatalogueActivationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: ReturnType<typeof dependancesDeTest>;

  const nationalActe = { id: ID, code: 'CI-CONS-GEN', libelle: 'Consultation générale', categorie: 'CONSULTATION', versionNomenclature: 'CI-2026', statut: 'HOMOLOGUE', lettreCleCode: null, coefficient: null, modeCotation: 'ISOLE', categorieGarantie: 'CONSULTATION', groupeCode: null };
  const nationalMedicament = { id: ID, denominationCommune: 'Paracétamol', nomCommercial: 'Doliprane', codeEan: null, forme: 'Comprimé', dosage: '500 mg', conditionnement: null, classeTherapeutique: 'Antalgique', remboursable: true, tauxRemboursementStd: '65', prixReferenceXof: '750', prixMaxRemboursable: '900', medicamentEssentiel: true, generiqueDisponible: true, ordonnanceObligatoire: false, medicamentControle: false, usage: 'AMBULATOIRE', statutHomologation: 'HOMOLOGUE' };

  beforeEach(async () => {
    dependances = dependancesDeTest();
    prisma = {
      referentielNationalActe: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      referentielNationalMedicament: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      referentielActe: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(({ data }: any) => ({ id: 'loc-1', ...data })), update: jest.fn(({ where, data }: any) => ({ id: where.id, ...data })) },
      medicament: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(({ data }: any) => ({ id: 'loc-2', ...data })), update: jest.fn(({ where, data }: any) => ({ id: where.id, ...data })) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogueActivationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
      ],
    }).compile();
    service = moduleRef.get(CatalogueActivationService);
  });

  describe('rôles : informatique, médecin conseil et pharmacien conseil — et eux seuls', () => {
    it.each(['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL'])('%s active un acte ET un médicament', async (role) => {
      identity.getMe.mockResolvedValue(identite(role));
      prisma.referentielNationalActe.findFirst.mockResolvedValue(nationalActe);
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue(nationalMedicament);
      await expect(service.activer(USER, 'actes', ID)).resolves.toMatchObject({ actif: true });
      await expect(service.activer(USER, 'medicaments', ID)).resolves.toMatchObject({ actif: true });
    });

    it.each(['ASSUREUR_COMPTABLE', 'ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'CENTRE_MEDICAL_ACCUEIL', 'SOCIETE_ADMINISTRATION', 'PHARMACIE_PHARMACIEN'])('%s : refusé (403), rien d’écrit', async (role) => {
      identity.getMe.mockResolvedValue(identite(role));
      await expect(service.activer(USER, 'actes', ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.desactiver(USER, 'medicaments', ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.activationMasse(USER, 'actes', { tous: true, actif: true })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.referentielActe.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('actes', () => {
    beforeEach(() => identity.getMe.mockResolvedValue(identite('ASSUREUR_MEDECIN_CONSEIL')));

    it('active un acte jamais activé : ligne HOMOLOGUE créée, contenu COPIÉ du catalogue national, lien posé, audité', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue(nationalActe);
      const res = await service.activer(USER, 'actes', ID);
      expect(res).toEqual({ type: 'actes', localId: 'loc-1', actif: true });
      expect(prisma.referentielActe.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organisationId: 'org-1', code: 'CI-CONS-GEN', libelle: 'Consultation générale', catalogueNationalId: ID, statut: 'HOMOLOGUE', homologuePar: 'u1' }),
      });
      expect(prisma.$executeRaw.mock.calls.some((c: unknown[]) => c[1] === 'ACTIVATION_ACTE_CATALOGUE_NATIONAL')).toBe(true);
    });

    it('seul un acte HOMOLOGUÉ au catalogue national s’active (409) ; inconnu → 404', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValueOnce({ ...nationalActe, statut: 'SUSPENDU' });
      await expect(service.activer(USER, 'actes', ID)).rejects.toBeInstanceOf(ConflictException);
      prisma.referentielNationalActe.findFirst.mockResolvedValueOnce(null);
      await expect(service.activer(USER, 'actes', ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.referentielActe.create).not.toHaveBeenCalled();
    });

    it('déjà actif → 409 ; désactivé (SUSPENDU) → réactivé sur la même ligne, contenu rafraîchi', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue(nationalActe);
      prisma.referentielActe.findFirst.mockResolvedValueOnce({ id: 'loc-9', statut: 'HOMOLOGUE', code: 'CI-CONS-GEN' });
      await expect(service.activer(USER, 'actes', ID)).rejects.toBeInstanceOf(ConflictException);
      prisma.referentielActe.findFirst.mockResolvedValueOnce({ id: 'loc-9', statut: 'SUSPENDU', code: 'CI-CONS-GEN' });
      await service.activer(USER, 'actes', ID);
      expect(prisma.referentielActe.create).not.toHaveBeenCalled();
      expect(prisma.referentielActe.update).toHaveBeenCalledWith({ where: { id: 'loc-9' }, data: expect.objectContaining({ statut: 'HOMOLOGUE', catalogueNationalId: ID, dateRetrait: null }) });
    });

    it('un acte RETIRÉ (archivé) repasse par le registre des dépendances avant d’être réactivé (ADR-007)', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue(nationalActe);
      prisma.referentielActe.findFirst.mockResolvedValueOnce({ id: 'loc-9', statut: 'RETIRE', code: 'CI-CONS-GEN' });
      await service.activer(USER, 'actes', ID);
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'referentielActe', 'loc-9', 'desarchiver');
    });

    it('désactive : HOMOLOGUE → SUSPENDU (réversible, aucune suppression) ; non actif → 409', async () => {
      prisma.referentielActe.findFirst.mockResolvedValueOnce({ id: 'loc-9', statut: 'HOMOLOGUE', code: 'CI-CONS-GEN' });
      await expect(service.desactiver(USER, 'actes', ID, 'Hors garantie')).resolves.toEqual({ type: 'actes', localId: 'loc-9', actif: false });
      expect(prisma.referentielActe.update).toHaveBeenCalledWith({ where: { id: 'loc-9' }, data: { statut: 'SUSPENDU' } });
      prisma.referentielActe.findFirst.mockResolvedValueOnce({ id: 'loc-9', statut: 'SUSPENDU' });
      await expect(service.desactiver(USER, 'actes', ID)).rejects.toBeInstanceOf(ConflictException);
      prisma.referentielActe.findFirst.mockResolvedValueOnce(null);
      await expect(service.desactiver(USER, 'actes', ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('médicaments', () => {
    beforeEach(() => identity.getMe.mockResolvedValue(identite('ASSUREUR_PHARMACIEN_CONSEIL')));

    it('active un médicament : ligne HOMOLOGUE créée avec le contenu du catalogue national, lien posé', async () => {
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue(nationalMedicament);
      await service.activer(USER, 'medicaments', ID);
      expect(prisma.medicament.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organisationId: 'org-1', denominationCommune: 'Paracétamol', dosage: '500 mg', catalogueNationalId: ID, statutHomologation: 'HOMOLOGUE' }),
      });
    });

    it('désactive : HOMOLOGUE → SUSPENDU ; seul un médicament homologué au catalogue national s’active', async () => {
      prisma.medicament.findFirst.mockResolvedValueOnce({ id: 'loc-3', statutHomologation: 'HOMOLOGUE', denominationCommune: 'Paracétamol' });
      await service.desactiver(USER, 'medicaments', ID);
      expect(prisma.medicament.update).toHaveBeenCalledWith({ where: { id: 'loc-3' }, data: { statutHomologation: 'SUSPENDU' } });
      prisma.referentielNationalMedicament.findFirst.mockResolvedValueOnce({ ...nationalMedicament, statutHomologation: 'RETIRE' });
      await expect(service.activer(USER, 'medicaments', ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('liste du catalogue national avec l’état d’activation', () => {
    it('acte : actif / désactivé / jamais activé, rapprochés par lien puis par code', async () => {
      identity.getMe.mockResolvedValue(identite('ASSUREUR_INFORMATIQUE'));
      prisma.referentielNationalActe.findMany.mockResolvedValue([
        { id: 'n1', code: 'A', libelle: 'A' },
        { id: 'n2', code: 'B', libelle: 'B' },
        { id: 'n3', code: 'C', libelle: 'C' },
        { id: 'n4', code: 'D', libelle: 'D' },
      ]);
      prisma.referentielActe.findMany.mockResolvedValue([
        { id: 'l1', code: 'A', statut: 'HOMOLOGUE', catalogueNationalId: 'n1', dateHomologation: null },
        { id: 'l2', code: 'B', statut: 'SUSPENDU', catalogueNationalId: 'n2', dateHomologation: null },
        { id: 'l4', code: 'D', statut: 'HOMOLOGUE', catalogueNationalId: null, dateHomologation: null }, // ligne d'avant le lien : rapprochée par code
      ]);
      const res = await service.lister(USER, 'actes');
      expect((res as { code: string; activation: { actif: boolean; statut: string | null } }[]).map((r) => [r.code, r.activation.actif, r.activation.statut])).toEqual([
        ['A', true, 'HOMOLOGUE'],
        ['B', false, 'SUSPENDU'],
        ['C', false, null],
        ['D', true, 'HOMOLOGUE'],
      ]);
    });
  });

  describe('activation en masse', () => {
    beforeEach(() => identity.getMe.mockResolvedValue(identite('ASSUREUR_INFORMATIQUE')));

    it('identifiants OU « tous », jamais les deux ni aucun ; au plus 200 identifiants', async () => {
      await expect(service.activationMasse(USER, 'actes', { actif: true })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.activationMasse(USER, 'actes', { ids: [ID], tous: true, actif: true })).rejects.toBeInstanceOf(BadRequestException);
      const trop = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      await expect(service.activationMasse(USER, 'actes', { ids: trop, actif: true })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('par identifiants : résultat partiel détaillé, un refus n’arrête pas le lot', async () => {
      const autre = '22222222-2222-4222-8222-222222222222';
      prisma.referentielNationalActe.findFirst.mockResolvedValueOnce(nationalActe).mockResolvedValueOnce(null);
      const res = await service.activationMasse(USER, 'actes', { ids: [ID, autre], actif: true });
      expect(res.reussis).toBe(1);
      expect(res.refuses).toEqual([{ id: autre, raison: expect.stringMatching(/introuvable/i) }]);
    });

    it('« tous » : une seule transaction SQL, nombre d’éléments modifiés renvoyé, opération auditée', async () => {
      prisma.$executeRaw.mockResolvedValue(3);
      const res = await service.activationMasse(USER, 'medicaments', { tous: true, actif: true });
      expect(res).toEqual({ reussis: 6, refuses: [] }); // 3 réactivés + 3 créés
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw.mock.calls.some((c: unknown[]) => c[1] === 'ACTIVATION_MASSE_CATALOGUE_NATIONAL')).toBe(true);
    });
  });
});
