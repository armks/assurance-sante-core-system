import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { AdjudicationClientService } from '../adjudication-client/adjudication-client.service';
import { adjudicationClientDeTest } from '../adjudication-client/adjudication-client.testing';
import { ClaimsService } from '../claims/claims.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import { PharmacyService } from './pharmacy.service';

const USER: AuthenticatedUser = { sub: 'u1', email: 'armelk01+testunitaire@gmail.com', postgresRole: 'authenticated', claimRole: null, aud: 'authenticated', token: 'jwt' };
const profil = (role: string, pharmacieId: string | null = 'pharm-1') => ({
  profil: { id: 'u1', organisationId: 'org-1', role, pharmacieId, adherentId: null },
  permissions: { roleChain: [role] },
});
const NAT = { id: 'nat-1', denominationCommune: 'Paracétamol', nomCommercial: 'Doliprane' };

describe('PharmacyService — liste des médicaments remboursables de la pharmacie', () => {
  let service: PharmacyService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      referentielNationalMedicament: { findFirst: jest.fn().mockResolvedValue(NAT) },
      medicament: { findFirst: jest.fn().mockResolvedValue({ id: 'org-med-1' }) },
      stockMedicamentPharmacie: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 's1' }),
        update: jest.fn().mockResolvedValue({ id: 's1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    identity = { getMe: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AdjudicationClientService, useValue: adjudicationClientDeTest() },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PharmacyService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: ClaimsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(PharmacyService);
  });

  describe('lecture', () => {
    it.each(['PHARMACIE_PHARMACIEN', 'PHARMACIE_CAISSIERE', 'PHARMACIE_COMPTABLE'])('%s : peut lire la liste', async (role) => {
      identity.getMe.mockResolvedValue(profil(role));
      await expect(service.listerMedicamentsRemboursables(USER)).resolves.toEqual([]);
    });

    it.each(['ASSUREUR_PHARMACIEN_CONSEIL', 'CENTRE_MEDICAL_ACCUEIL', 'ADHERENT_TITULAIRE'])('%s : lecture refusée', async (role) => {
      identity.getMe.mockResolvedValue(profil(role, null));
      await expect(service.listerMedicamentsRemboursables(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marque « dans ma liste » les médicaments ajoutés par la pharmacie, avec disponibilité et note ; jamais d’acte, prix national en lecture seule', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.$queryRaw.mockResolvedValue([
        { id: 'nat-1', denomination_commune: 'Paracétamol', nom_commercial: 'Doliprane', dosage: '500 mg', forme: 'Comprimé', classe_therapeutique: 'Antalgique', remboursable: true, taux_remboursement_std: { toString: () => '70' }, prix_reference_xof: { toString: () => '1200' }, medicament_essentiel: true },
        { id: 'nat-2', denomination_commune: 'Amoxicilline', nom_commercial: null, dosage: '1 g', forme: null, classe_therapeutique: null, remboursable: true, taux_remboursement_std: null, prix_reference_xof: null, medicament_essentiel: false },
      ]);
      prisma.stockMedicamentPharmacie.findMany.mockResolvedValue([{ catalogueNationalId: 'nat-1', disponible: false, note: 'Rupture jusqu’au 20', dateMaj: new Date('2026-10-01') }]);
      const res = await service.listerMedicamentsRemboursables(USER);
      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({ id: 'nat-1', dansMaListe: true, disponible: false, note: 'Rupture jusqu’au 20', prixReferenceXof: '1200', tauxRemboursementStd: '70' });
      expect(res[1]).toMatchObject({ id: 'nat-2', dansMaListe: false, disponible: null, note: null });
      // la liste de la pharmacie est lue pour SA pharmacie uniquement
      expect(prisma.stockMedicamentPharmacie.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pharmacieId: 'pharm-1', catalogueNationalId: { not: null } } }));
    });
  });

  describe('ajout, modification, retrait — pharmacien seul', () => {
    it.each(['PHARMACIE_CAISSIERE', 'PHARMACIE_COMPTABLE'])('%s : ajout, modification et retrait refusés (403), rien n’est écrit', async (role) => {
      identity.getMe.mockResolvedValue(profil(role));
      await expect(service.ajouterMedicamentAMaListe(USER, 'nat-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.modifierMedicamentDeMaListe(USER, 'nat-1', { disponible: false })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.retirerMedicamentDeMaListe(USER, 'nat-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.stockMedicamentPharmacie.upsert).not.toHaveBeenCalled();
      expect(prisma.stockMedicamentPharmacie.update).not.toHaveBeenCalled();
      expect(prisma.stockMedicamentPharmacie.deleteMany).not.toHaveBeenCalled();
    });

    it('ajoute un médicament du catalogue : libellé « DCI (nom commercial) » (celui de l’ordonnance), rattaché au catalogue, disponible', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      await service.ajouterMedicamentAMaListe(USER, 'nat-1');
      expect(prisma.stockMedicamentPharmacie.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pharmacieId_denominationMedicament: { pharmacieId: 'pharm-1', denominationMedicament: 'Paracétamol (Doliprane)' } },
          create: { pharmacieId: 'pharm-1', denominationMedicament: 'Paracétamol (Doliprane)', catalogueNationalId: 'nat-1', disponible: true },
        }),
      );
    });

    it('refuse un médicament absent du catalogue, non homologué ou non activé par l’assureur (404)', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue(null);
      await expect(service.ajouterMedicamentAMaListe(USER, 'nat-x')).rejects.toBeInstanceOf(NotFoundException);
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue(NAT);
      prisma.medicament.findFirst.mockResolvedValue(null); // pas activé par l'organisation
      await expect(service.ajouterMedicamentAMaListe(USER, 'nat-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.stockMedicamentPharmacie.upsert).not.toHaveBeenCalled();
    });

    it('refuse un doublon (409)', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.stockMedicamentPharmacie.findFirst.mockResolvedValue({ id: 's1' });
      await expect(service.ajouterMedicamentAMaListe(USER, 'nat-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('modifie disponibilité et note (note vide = effacée) ; refuse un médicament absent de la liste', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.stockMedicamentPharmacie.findFirst.mockResolvedValue({ id: 's1' });
      await service.modifierMedicamentDeMaListe(USER, 'nat-1', { disponible: false, note: '  Rupture  ' });
      expect(prisma.stockMedicamentPharmacie.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: expect.objectContaining({ disponible: false, note: 'Rupture' }) });
      await service.modifierMedicamentDeMaListe(USER, 'nat-1', { note: ' ' });
      expect(prisma.stockMedicamentPharmacie.update).toHaveBeenLastCalledWith({ where: { id: 's1' }, data: expect.objectContaining({ note: null }) });
      prisma.stockMedicamentPharmacie.findFirst.mockResolvedValue(null);
      await expect(service.modifierMedicamentDeMaListe(USER, 'nat-1', { disponible: true })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retire de la liste pour SA pharmacie uniquement ; 404 si absent', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      await expect(service.retirerMedicamentDeMaListe(USER, 'nat-1')).resolves.toEqual({ retire: true });
      expect(prisma.stockMedicamentPharmacie.deleteMany).toHaveBeenCalledWith({ where: { pharmacieId: 'pharm-1', catalogueNationalId: 'nat-1' } });
      prisma.stockMedicamentPharmacie.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.retirerMedicamentDeMaListe(USER, 'nat-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne modifie JAMAIS le catalogue national ni les médicaments de l’assureur (aucune méthode d’écriture n’existe sur ces tables dans le test)', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.stockMedicamentPharmacie.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 's1' });
      await service.ajouterMedicamentAMaListe(USER, 'nat-1');
      await service.modifierMedicamentDeMaListe(USER, 'nat-1', { disponible: false, note: 'x' });
      await service.retirerMedicamentDeMaListe(USER, 'nat-1');
      expect(Object.keys(prisma.referentielNationalMedicament)).toEqual(['findFirst']);
      expect(Object.keys(prisma.medicament)).toEqual(['findFirst']);
    });
  });

  describe('creerMedicamentCatalogue — nouveau médicament au catalogue national avec son prix national', () => {
    const DTO = { denominationCommune: ' Ibuprofène ', nomCommercial: 'Advil', dosage: '400 mg', forme: 'Comprimé', prixReferenceXof: 1500 };

    beforeEach(() => {
      prisma.pharmacie = { findUnique: jest.fn().mockResolvedValue({ nom: 'Pharmacie test', statut: 'ACTIVE', deletedAt: null }) };
      prisma.$transaction = jest.fn((cb: any) => cb(prisma));
      prisma.$executeRaw = jest.fn().mockResolvedValue(1);
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue(null);
      prisma.referentielNationalMedicament.create = jest.fn().mockResolvedValue({ id: 'nat-new' });
    });

    it.each(['PHARMACIE_CAISSIERE', 'PHARMACIE_COMPTABLE', 'ASSUREUR_PHARMACIEN_CONSEIL', 'CENTRE_MEDICAL_MEDECIN'])('%s : refusé (403), rien n’est créé', async (role) => {
      identity.getMe.mockResolvedValue(profil(role, role.startsWith('PHARMACIE') ? 'pharm-1' : null));
      await expect(service.creerMedicamentCatalogue(USER, DTO)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.referentielNationalMedicament.create).not.toHaveBeenCalled();
    });

    it('le pharmacien crée le médicament : prix national enregistré, homologué, origine PHARMACIE, aucune donnée de remboursement imposée', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      await expect(service.creerMedicamentCatalogue(USER, DTO)).resolves.toEqual({ id: 'nat-new' });
      const data = prisma.referentielNationalMedicament.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ denominationCommune: 'Ibuprofène', nomCommercial: 'Advil', dosage: '400 mg', forme: 'Comprimé', prixReferenceXof: '1500.00', statutHomologation: 'HOMOLOGUE', sourceListe: 'PHARMACIE' });
      expect(data.tauxRemboursementStd).toBeUndefined();
      expect(data.prixMaxRemboursable).toBeUndefined();
    });

    it('refuse un doublon (même DCI, nom commercial, dosage, forme) : 409', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.referentielNationalMedicament.findFirst.mockResolvedValue({ id: 'existant' });
      await expect(service.creerMedicamentCatalogue(USER, DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.referentielNationalMedicament.create).not.toHaveBeenCalled();
    });

    it('pharmacie archivée : aucun ajout au catalogue', async () => {
      identity.getMe.mockResolvedValue(profil('PHARMACIE_PHARMACIEN'));
      prisma.pharmacie.findUnique.mockResolvedValue({ nom: 'P', statut: 'RESILIEE', deletedAt: null });
      await expect(service.creerMedicamentCatalogue(USER, DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.referentielNationalMedicament.create).not.toHaveBeenCalled();
    });
  });
});
