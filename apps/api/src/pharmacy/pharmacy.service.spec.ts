import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ClaimsService } from '../claims/claims.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PharmacyService } from './pharmacy.service';
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

function pharmacien(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_PHARMACIEN', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_PHARMACIEN'] },
  };
}
function caissiere(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_CAISSIERE', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_CAISSIERE'] },
  };
}
function comptablePharmacie(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_COMPTABLE', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_COMPTABLE'] },
  };
}
function pharmacienConseil() {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_PHARMACIEN_CONSEIL', pharmacieId: null, adherentId: null },
    permissions: { roleChain: ['ASSUREUR_PHARMACIEN_CONSEIL'] },
  };
}
function comptableAssureur() {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_COMPTABLE', pharmacieId: null, adherentId: null },
    permissions: { roleChain: ['ASSUREUR_COMPTABLE'] },
  };
}
function adherent(adherentId = 'adh-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ADHERENT_TITULAIRE', pharmacieId: null, adherentId },
    permissions: { roleChain: ['ADHERENT_TITULAIRE'] },
  };
}

const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

describe('PharmacyService — révision du flux pharmacie (verrou par ligne)', () => {
  let service: PharmacyService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let claims: { soumettreDepuisDispensation: jest.Mock };

  beforeEach(async () => {
    prisma = {
      adherent: { findFirst: jest.fn().mockResolvedValue(null) },
      beneficiaire: { findFirst: jest.fn().mockResolvedValue(null) },
      ordonnance: { findFirst: jest.fn() },
      ligneOrdonnance: { findMany: jest.fn(), updateMany: jest.fn() },
      garantie: { findFirst: jest.fn().mockResolvedValue(null) },
      stockMedicamentPharmacie: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      dispensationPharmacie: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ligneDispensation: {
        createMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      contestationPrescription: { findMany: jest.fn().mockResolvedValue([]) },
      factureMensuellePharmacie: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      paiementGroupeFacture: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    claims = { soumettreDepuisDispensation: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PharmacyService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: ClaimsService, useValue: claims },
      ],
    }).compile();
    service = moduleRef.get(PharmacyService);
  });

  // --- preparerDispensation ------------------------------------------

  it('REFUSE une ligne déjà SERVIE (verrou par ligne, pas par ordonnance)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ordonnance.findFirst.mockResolvedValue({
      id: 'ord-1', organisationId: 'org-1', statut: 'ACTIVE', deletedAt: null,
      dossier: { adherentId: 'adh-1', beneficiaireId: null, police: { produitId: 'prod-1' } },
    });
    prisma.ligneOrdonnance.findMany.mockResolvedValue([
      { id: 'ligne-1', ordonnanceId: 'ord-1', denominationMedicament: 'Paracetamol', statut: 'SERVIE' },
    ]);

    await expect(
      service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dispensationPharmacie.create).not.toHaveBeenCalled();
  });

  it('REFUSE si le prix n’est pas défini dans le stock de CETTE pharmacie', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ordonnance.findFirst.mockResolvedValue({
      id: 'ord-1', organisationId: 'org-1', statut: 'ACTIVE', deletedAt: null,
      dossier: { adherentId: 'adh-1', beneficiaireId: null, police: { produitId: 'prod-1' } },
    });
    prisma.ligneOrdonnance.findMany.mockResolvedValue([
      { id: 'ligne-1', ordonnanceId: 'ord-1', denominationMedicament: 'Paracetamol', statut: 'DISPONIBLE', quantitePrescrite: 1 },
    ]);
    prisma.stockMedicamentPharmacie.findMany.mockResolvedValue([]); // aucun prix défini

    await expect(
      service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('CAISSIÈRE peut préparer une dispensation (droit partagé, confirmé à l’audit précédent)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    prisma.ordonnance.findFirst.mockResolvedValue({
      id: 'ord-1', organisationId: 'org-1', statut: 'ACTIVE', deletedAt: null,
      dossier: { adherentId: 'adh-1', beneficiaireId: null, police: { produitId: 'prod-1' } },
    });
    prisma.ligneOrdonnance.findMany.mockResolvedValue([
      { id: 'ligne-1', ordonnanceId: 'ord-1', denominationMedicament: 'Paracetamol', statut: 'DISPONIBLE', quantitePrescrite: 2 },
    ]);
    prisma.stockMedicamentPharmacie.findMany.mockResolvedValue([
      { denominationMedicament: 'Paracetamol', prixPharmacie: dec(500), disponible: true },
    ]);
    prisma.dispensationPharmacie.create.mockResolvedValue({ id: 'disp-1', statut: 'EN_PREPARATION' });
    prisma.dispensationPharmacie.update.mockResolvedValue({
      id: 'disp-1', statut: 'EN_ATTENTE_VALIDATION_PATIENT', montantTotal: dec(1000),
    });

    const res = await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

    expect(res.statut).toBe('EN_ATTENTE_VALIDATION_PATIENT');
    expect(res.montantTotal).toBe('1000.00');
    expect((res as any).code).toBeUndefined(); // jamais renvoyé à la pharmacie
    expect(prisma.ligneOrdonnance.updateMany).not.toHaveBeenCalled(); // pas encore verrouillée
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Remboursement pharmacie (diagnostic confirmé absent) : part assurance /
  //  part patient calculées à la préparation, même logique que
  //  PreauthorizationService.simulerMontantActe (garanties.tauxCouverture,
  //  catégorie PHARMACIE).
  // ═══════════════════════════════════════════════════════════════════
  describe('calcul part assurance / part patient (preparerDispensation)', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.ordonnance.findFirst.mockResolvedValue({
        id: 'ord-1', organisationId: 'org-1', statut: 'ACTIVE', deletedAt: null,
        dossier: { adherentId: 'adh-1', beneficiaireId: null, police: { produitId: 'prod-1' } },
      });
      prisma.ligneOrdonnance.findMany.mockResolvedValue([
        { id: 'ligne-1', ordonnanceId: 'ord-1', denominationMedicament: 'Paracetamol', statut: 'DISPONIBLE', quantitePrescrite: 1 },
      ]);
      prisma.stockMedicamentPharmacie.findMany.mockResolvedValue([
        { denominationMedicament: 'Paracetamol', prixPharmacie: dec(10000), disponible: true },
      ]);
      prisma.dispensationPharmacie.create.mockResolvedValue({ id: 'disp-1', statut: 'EN_PREPARATION' });
      prisma.dispensationPharmacie.update.mockResolvedValue({
        id: 'disp-1', statut: 'EN_ATTENTE_VALIDATION_PATIENT', montantTotal: dec(10000),
      });
    });

    it('10 000 F à 80% de couverture → 8 000 F assurance, 2 000 F patient', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: dec(80), plafondParActe: null,
      });

      const res = await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

      expect(res.montantAssurance).toBe('8000.00');
      expect(res.montantPatient).toBe('2000.00');
      expect(prisma.ligneDispensation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ montantAssurance: '8000.00', montantPatient: '2000.00' })],
        }),
      );
    });

    it('sans garantie PHARMACIE → NON COUVERT : assurance 0, le patient paie tout (plus de 80 % par défaut)', async () => {
      prisma.garantie.findFirst.mockResolvedValue(null);

      const res = await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

      expect(res.montantAssurance).toBe('0.00');
      expect(res.montantPatient).toBe('10000.00');
    });

    it('applique le plafond par acte de la garantie sur le montant assurance', async () => {
      prisma.garantie.findFirst.mockResolvedValue({
        tauxCouverture: dec(80), plafondParActe: dec(3000),
      });

      const res = await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

      // 80 % de 10000 = 8000, plafonné à 3000.
      expect(res.montantAssurance).toBe('3000.00');
      expect(res.montantPatient).toBe('7000.00');
    });

    it('la garantie est cherchée avec la catégorie PHARMACIE, pas CONSULTATION', async () => {
      prisma.garantie.findFirst.mockResolvedValue({ tauxCouverture: dec(80), plafondParActe: null });

      await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

      expect(prisma.garantie.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ produitId: 'prod-1', categorieActe: 'PHARMACIE' }),
        }),
      );
    });
  });

  // --- validerCodeDispensation (adhérent) -----------------------------

  it('validerCodeDispensation refuse un rôle non-adhérent', async () => {
    identity.getMe.mockResolvedValue(pharmacien());
    await expect(
      service.validerCodeDispensation(USER, { code: 'ABCD1234' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validerCodeDispensation refuse si ce n’est pas le patient concerné', async () => {
    identity.getMe.mockResolvedValue(adherent('adh-AUTRE'));
    prisma.dispensationPharmacie.findUnique.mockResolvedValue({
      id: 'disp-1',
      statut: 'EN_ATTENTE_VALIDATION_PATIENT',
      ordonnance: { dossier: { adherentId: 'adh-1', beneficiaire: null } },
    });
    await expect(
      service.validerCodeDispensation(USER, { code: 'ABCD1234' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // --- confirmerPaiementDispensation -----------------------------------

  it('GARDE BLOQUANTE : refuse le paiement si le statut n’est pas VALIDEE', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue({
      id: 'disp-1', pharmacieId: 'pharm-1', statut: 'EN_ATTENTE_VALIDATION_PATIENT', lignes: [],
    });
    await expect(
      service.confirmerPaiementDispensation(USER, 'disp-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dispensationPharmacie.update).not.toHaveBeenCalled();
  });

  it('confirmerPaiementDispensation refusé pour une AUTRE pharmacie (scope strict)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue(null); // scopé pharmacieId dans le where -> introuvable
    await expect(
      service.confirmerPaiementDispensation(USER, 'disp-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dispensationPharmacie.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ pharmacieId: 'pharm-2' }) }),
    );
  });

  it('confirmerPaiementDispensation OK : verrouille les lignes (DISPONIBLE -> SERVIE)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue({
      id: 'disp-1', pharmacieId: 'pharm-1', statut: 'VALIDEE', montantTotal: dec(500),
      lignes: [{ ligneOrdonnanceId: 'ligne-1', quantite: 1, montantAssurance: dec(0), montantPatient: dec(500) }],
      ordonnance: { dossier: { id: 'dos-1', adherentId: 'adh-1', beneficiaireId: null, policeId: 'pol-1', police: { produitId: 'prod-1' } } },
    });
    prisma.ligneOrdonnance.updateMany.mockResolvedValue({ count: 1 });
    prisma.dispensationPharmacie.update.mockResolvedValue({
      id: 'disp-1', statut: 'PAYEE', montantTotal: dec(500), datePaiement: new Date(),
    });
    // Aucune garantie PHARMACIE trouvée → montantAssurance reste 0, la
    // réclamation est SKIPPÉE (rien à réclamer) : ce test reste centré sur le
    // verrou par ligne, la soumission à l'adjudication a sa propre section.
    prisma.garantie.findFirst.mockResolvedValue(null);

    const res = await service.confirmerPaiementDispensation(USER, 'disp-1');
    expect(res.statut).toBe('PAYEE');
    expect(res.reclamation).toBeNull();
    expect(claims.soumettreDepuisDispensation).not.toHaveBeenCalled();
    expect(prisma.ligneOrdonnance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ligne-1', statut: 'DISPONIBLE' },
        data: expect.objectContaining({ statut: 'SERVIE', pharmacieServanteId: 'pharm-1' }),
      }),
    );
  });

  it('confirmerPaiementDispensation échoue si une ligne a été prise entre-temps (compare-and-swap)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue({
      id: 'disp-1', pharmacieId: 'pharm-1', statut: 'VALIDEE', montantTotal: dec(500),
      lignes: [{ ligneOrdonnanceId: 'ligne-1', quantite: 1 }],
    });
    prisma.ligneOrdonnance.updateMany.mockResolvedValue({ count: 0 }); // déjà SERVIE ailleurs

    await expect(
      service.confirmerPaiementDispensation(USER, 'disp-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dispensationPharmacie.update).not.toHaveBeenCalled();
  });

  describe('listerMesDispensations — côté ADHÉRENT', () => {
    it('aucun adherentId sur le profil → liste vide, aucune requête', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      const res = await service.listerMesDispensations(USER);
      expect(res).toEqual({ items: [], total: 0, page: 1, limite: 25, pages: 1 });
      expect(prisma.dispensationPharmacie.findMany).not.toHaveBeenCalled();
    });

    it('scope strictement sur ctx.adherentId (adhérent + ses bénéficiaires)', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findMany.mockResolvedValue([]);
      await service.listerMesDispensations(USER);
      expect(prisma.dispensationPharmacie.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ordonnance: {
              dossier: {
                OR: [{ adherentId: 'adh-1' }, { beneficiaire: { adherentId: 'adh-1' } }],
              },
            },
          },
        }),
      );
    });

    it('code visible UNIQUEMENT si EN_ATTENTE_VALIDATION_PATIENT, masqué sinon', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findMany.mockResolvedValue([
        {
          id: 'disp-1',
          pharmacie: { nom: 'Pharmacie du Plateau' },
          statut: 'EN_ATTENTE_VALIDATION_PATIENT',
          montantTotal: dec(5000),
          codeConfirmation: 'ABC12345',
          datePreparation: new Date('2026-09-01'),
          lignes: [
            {
              montantAssurance: dec(4000),
              montantPatient: dec(1000),
              ligneOrdonnance: { denominationMedicament: 'Paracétamol' },
            },
          ],
        },
        {
          id: 'disp-2',
          pharmacie: { nom: 'Pharmacie du Plateau' },
          statut: 'VALIDEE',
          montantTotal: dec(3000),
          codeConfirmation: 'XYZ98765',
          datePreparation: new Date('2026-09-02'),
          lignes: [
            {
              montantAssurance: dec(2400),
              montantPatient: dec(600),
              ligneOrdonnance: { denominationMedicament: 'Amoxicilline' },
            },
          ],
        },
      ]);

      const res = await service.listerMesDispensations(USER);

      expect(res.items[0]).toMatchObject({ id: 'disp-1', code: 'ABC12345', statut: 'EN_ATTENTE_VALIDATION_PATIENT' });
      expect(res.items[1]).toMatchObject({ id: 'disp-2', code: undefined, statut: 'VALIDEE' });
    });

    it('calcule montantAssurance et montantPatient par somme des lignes (Decimal)', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findMany.mockResolvedValue([
        {
          id: 'disp-1',
          pharmacie: { nom: 'Pharmacie du Plateau' },
          statut: 'EN_ATTENTE_VALIDATION_PATIENT',
          montantTotal: dec(7500),
          codeConfirmation: 'ABC12345',
          datePreparation: new Date('2026-09-01'),
          lignes: [
            { montantAssurance: dec(4000), montantPatient: dec(1000), ligneOrdonnance: { denominationMedicament: 'Paracétamol' } },
            { montantAssurance: dec(2000), montantPatient: dec(500), ligneOrdonnance: { denominationMedicament: 'Ibuprofène' } },
          ],
        },
      ]);

      const res = await service.listerMesDispensations(USER);

      expect(res.items[0].montantAssurance).toBe('6000.00');
      expect(res.items[0].montantPatient).toBe('1500.00');
      expect(res.items[0].montantTotal).toBe('7500.00');
      expect(res.items[0].medicaments).toEqual(['Paracétamol', 'Ibuprofène']);
    });

    it('remonte toutes les dispensations, toutes pharmacies confondues (multi-cycle)', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findMany.mockResolvedValue([
        {
          id: 'disp-1', pharmacie: { nom: 'Pharmacie A' }, statut: 'EN_ATTENTE_VALIDATION_PATIENT',
          montantTotal: dec(1000), codeConfirmation: 'AAA11111', datePreparation: new Date('2026-09-01'),
          lignes: [{ montantAssurance: dec(800), montantPatient: dec(200), ligneOrdonnance: { denominationMedicament: 'Med A' } }],
        },
        {
          id: 'disp-2', pharmacie: { nom: 'Pharmacie B' }, statut: 'EN_ATTENTE_VALIDATION_PATIENT',
          montantTotal: dec(2000), codeConfirmation: 'BBB22222', datePreparation: new Date('2026-09-02'),
          lignes: [{ montantAssurance: dec(1600), montantPatient: dec(400), ligneOrdonnance: { denominationMedicament: 'Med B' } }],
        },
      ]);

      const res = await service.listerMesDispensations(USER);

      expect(res.items).toHaveLength(2);
      expect(res.items.map((r: any) => r.pharmacie)).toEqual(['Pharmacie A', 'Pharmacie B']);
      expect(res.items.every((r: any) => !!r.code)).toBe(true);
    });
  });

  describe('validerCodeDispensation — côté ADHÉRENT', () => {
    it('rôle non adhérent → 403', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      await expect(
        service.validerCodeDispensation(USER, { code: 'ABC12345' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('code invalide/inexistant → 404', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findUnique.mockResolvedValue(null);
      await expect(
        service.validerCodeDispensation(USER, { code: 'BADCODE1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('dispensation d’un autre adhérent → 403', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findUnique.mockResolvedValue({
        id: 'disp-1',
        statut: 'EN_ATTENTE_VALIDATION_PATIENT',
        ordonnance: { dossier: { adherentId: 'adh-AUTRE', beneficiaire: null } },
      });
      await expect(
        service.validerCodeDispensation(USER, { code: 'ABC12345' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('déjà validée → 409', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findUnique.mockResolvedValue({
        id: 'disp-1',
        statut: 'VALIDEE',
        ordonnance: { dossier: { adherentId: 'adh-1', beneficiaire: null } },
      });
      await expect(
        service.validerCodeDispensation(USER, { code: 'ABC12345' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('valide avec succès → statut VALIDEE', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.dispensationPharmacie.findUnique.mockResolvedValue({
        id: 'disp-1',
        statut: 'EN_ATTENTE_VALIDATION_PATIENT',
        ordonnance: { dossier: { adherentId: 'adh-1', beneficiaire: null } },
      });
      prisma.dispensationPharmacie.update.mockResolvedValue({ id: 'disp-1', statut: 'VALIDEE' });

      const res = await service.validerCodeDispensation(USER, { code: 'ABC12345' });

      expect(prisma.dispensationPharmacie.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'disp-1' },
          data: expect.objectContaining({ statut: 'VALIDEE' }),
        }),
      );
      expect(res).toEqual({ dispensationId: 'disp-1', statut: 'VALIDEE' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Le patient ne paie QUE montant_patient — une dispensation payée génère
  //  automatiquement une réclamation (montant_assurance) vers l'adjudication,
  //  jamais un flux séparé sans lien avec elle.
  // ═══════════════════════════════════════════════════════════════════
  describe('confirmerPaiementDispensation → soumission automatique à l’adjudication', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.dispensationPharmacie.findFirst.mockResolvedValue({
        id: 'disp-1', pharmacieId: 'pharm-1', statut: 'VALIDEE', montantTotal: dec(10000),
        lignes: [{ ligneOrdonnanceId: 'ligne-1', quantite: 1, montantAssurance: dec(8000), montantPatient: dec(2000) }],
        ordonnance: {
          dossier: {
            id: 'dos-1', adherentId: 'adh-1', beneficiaireId: null, policeId: 'pol-1',
            police: { produitId: 'prod-1' },
          },
        },
      });
      prisma.ligneOrdonnance.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispensationPharmacie.update.mockResolvedValue({
        id: 'disp-1', statut: 'PAYEE', montantTotal: dec(10000), datePaiement: new Date(),
      });
      prisma.garantie.findFirst.mockResolvedValue({ id: 'gar-pharma-1', tauxCouverture: dec(80) });
    });

    it('le patient ne règle que montant_patient (2000), pas le total (10000)', async () => {
      claims.soumettreDepuisDispensation.mockResolvedValue({
        reclamation: { id: 'rec-1', statut: 'AUTO_ADJUDIQUE' },
      });

      const res = await service.confirmerPaiementDispensation(USER, 'disp-1');

      expect(res.montantPatient).toBe('2000.00');
      expect(res.montantAssurance).toBe('8000.00');
      expect(res.montantTotal).toBe('10000.00');
    });

    it('soumet le montant BRUT (10000 F) au microservice, jamais la part assurance déjà calculée (taux appliqué une seule fois)', async () => {
      claims.soumettreDepuisDispensation.mockResolvedValue({
        reclamation: { id: 'rec-1', statut: 'AUTO_ADJUDIQUE' },
      });

      const res = await service.confirmerPaiementDispensation(USER, 'disp-1');

      expect(claims.soumettreDepuisDispensation).toHaveBeenCalledWith(
        { userId: 'u1', organisationId: 'org-1' },
        expect.objectContaining({
          dispensationId: 'disp-1',
          dossierSoinsId: 'dos-1',
          adherentId: 'adh-1',
          policeId: 'pol-1',
          garantieId: 'gar-pharma-1',
          montant: '10000.00', // total ; la part assurance (8000) est recalculée par l'adjudication
        }),
      );
      expect(res.reclamation).toEqual({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE' });
    });

    it('le paiement reste acquis même si la soumission à l’adjudication échoue', async () => {
      claims.soumettreDepuisDispensation.mockRejectedValue(
        new ServiceUnavailableException("Service d'adjudication indisponible"),
      );

      await expect(
        service.confirmerPaiementDispensation(USER, 'disp-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      // Le paiement (verrouillage des lignes + statut PAYEE) a déjà été committé
      // AVANT l'appel à l'adjudication — il n'est jamais annulé après coup.
      expect(prisma.dispensationPharmacie.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ statut: 'PAYEE' }) }),
      );
    });
  });

  // --- stock : lecture ouverte aux 3 rôles, écriture pharmacien seul ----

  it('la caissière PEUT lire le stock (nécessaire pour dispenser, clarification métier)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    prisma.stockMedicamentPharmacie.findMany.mockResolvedValue([
      { id: 's1', denominationMedicament: 'Paracetamol', prixPharmacie: dec(500), disponible: true },
    ]);
    const res = await service.listerStock(USER);
    expect(res).toHaveLength(1);
    expect(prisma.stockMedicamentPharmacie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pharmacieId: 'pharm-1' } }),
    );
  });

  it('la caissière NE PEUT PAS écrire le stock (réservé au pharmacien)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    await expect(
      service.definirPrixStock(USER, { denominationMedicament: 'Paracetamol', prixPharmacie: 500 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stockMedicamentPharmacie.upsert).not.toHaveBeenCalled();
  });

  it('le pharmacien peut définir un prix de stock', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.stockMedicamentPharmacie.upsert.mockResolvedValue({ id: 's1' });
    await service.definirPrixStock(USER, { denominationMedicament: 'Paracetamol', prixPharmacie: 500 });
    expect(prisma.stockMedicamentPharmacie.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pharmacieId_denominationMedicament: { pharmacieId: 'pharm-1', denominationMedicament: 'Paracetamol' } },
      }),
    );
  });

  // --- rechercherPrescriptionsParCarte -----------------------------------

  it('rechercherPrescriptionsParCarte refuse un rôle non-pharmacie', async () => {
    identity.getMe.mockResolvedValue(adherent());
    await expect(
      service.rechercherPrescriptionsParCarte(USER, 'CM-0000000001'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechercherPrescriptionsParCarte -> 404 si aucune carte ne correspond', async () => {
    identity.getMe.mockResolvedValue(pharmacien());
    await expect(
      service.rechercherPrescriptionsParCarte(USER, 'CM-INCONNUE'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- substituerMedicament (PHARMACIE_PHARMACIEN exclusivement) -----------

  it('la CAISSIÈRE ne peut PAS substituer un médicament (réservé au pharmacien)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    await expect(
      service.substituerMedicament(USER, 'ligne-disp-1', {
        nouveauMedicament: 'Ibuprofène 400mg',
        motif: 'Rupture de stock du princeps',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ligneDispensation.update).not.toHaveBeenCalled();
  });

  it('le pharmacien REFUSE la substitution si la dispensation est déjà VALIDEE', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'VALIDEE' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    await expect(
      service.substituerMedicament(USER, 'ligne-disp-1', {
        nouveauMedicament: 'Ibuprofène 400mg',
        motif: 'Rupture de stock du princeps',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.ligneDispensation.update).not.toHaveBeenCalled();
  });

  it('le pharmacien REFUSE la substitution si la dispensation est déjà PAYEE', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'PAYEE' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    await expect(
      service.substituerMedicament(USER, 'ligne-disp-1', {
        nouveauMedicament: 'Ibuprofène 400mg',
        motif: 'Rupture de stock du princeps',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuse la substitution sur une ligne d'une AUTRE pharmacie (scope strict)", async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
    prisma.ligneDispensation.findFirst.mockResolvedValue(null); // scopé pharmacieId dans le where -> introuvable
    await expect(
      service.substituerMedicament(USER, 'ligne-disp-1', {
        nouveauMedicament: 'Ibuprofène 400mg',
        motif: 'Rupture de stock du princeps',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ligneDispensation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dispensation: { pharmacieId: 'pharm-2' } }),
      }),
    );
  });

  it('le pharmacien peut substituer un médicament tant que la dispensation est EN_PREPARATION ou EN_ATTENTE_VALIDATION_PATIENT', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'EN_ATTENTE_VALIDATION_PATIENT' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    prisma.ligneDispensation.update.mockResolvedValue({
      id: 'ligne-disp-1',
      medicamentSubstitue: 'Ibuprofène 400mg',
      motifSubstitution: 'Rupture de stock du princeps',
      dateSubstitution: new Date('2026-09-12T00:00:00Z'),
    });

    const res = await service.substituerMedicament(USER, 'ligne-disp-1', {
      nouveauMedicament: 'Ibuprofène 400mg',
      motif: 'Rupture de stock du princeps',
    });

    expect(res.medicamentSubstitue).toBe('Ibuprofène 400mg');
    expect(res.medicamentOriginal).toBe('Paracetamol 500mg');
    expect(prisma.ligneDispensation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ligne-disp-1' },
        data: expect.objectContaining({
          medicamentSubstitue: 'Ibuprofène 400mg',
          motifSubstitution: 'Rupture de stock du princeps',
          substitueParId: 'u1',
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("audite SUBSTITUTION_PHARMACIEN quand c'est le pharmacien de la pharmacie qui substitue", async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'EN_PREPARATION' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    prisma.ligneDispensation.update.mockResolvedValue({ id: 'ligne-disp-1' });
    await service.substituerMedicament(USER, 'ligne-disp-1', {
      nouveauMedicament: 'Ibuprofène 400mg',
      motif: 'Rupture de stock du princeps',
    });
    expect((prisma.$executeRaw as jest.Mock).mock.calls[0]).toContain('SUBSTITUTION_PHARMACIEN');
  });

  it('ASSUREUR_PHARMACIEN_CONSEIL peut AUSSI substituer (capacité additive, organisation entière)', async () => {
    identity.getMe.mockResolvedValue(pharmacienConseil());
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'EN_ATTENTE_VALIDATION_PATIENT' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    prisma.ligneDispensation.update.mockResolvedValue({
      id: 'ligne-disp-1',
      medicamentSubstitue: 'Ibuprofène 400mg',
      motifSubstitution: 'Revu lors d’une contestation',
      dateSubstitution: new Date('2026-09-12T00:00:00Z'),
    });

    const res = await service.substituerMedicament(USER, 'ligne-disp-1', {
      nouveauMedicament: 'Ibuprofène 400mg',
      motif: 'Revu lors d’une contestation',
    });

    expect(prisma.ligneDispensation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispensation: { pharmacie: { organisationId: 'org-1' } },
        }),
      }),
    );
    expect(res.medicamentSubstitue).toBe('Ibuprofène 400mg');
  });

  it("distingue l'audit du pharmacien conseil (SUBSTITUTION_PHARMACIEN_CONSEIL) de celui du pharmacien", async () => {
    identity.getMe.mockResolvedValue(pharmacienConseil());
    prisma.ligneDispensation.findFirst.mockResolvedValue({
      id: 'ligne-disp-1',
      dispensationId: 'disp-1',
      dispensation: { id: 'disp-1', pharmacieId: 'pharm-1', statut: 'EN_PREPARATION' },
      ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
    });
    prisma.ligneDispensation.update.mockResolvedValue({ id: 'ligne-disp-1' });

    await service.substituerMedicament(USER, 'ligne-disp-1', {
      nouveauMedicament: 'Ibuprofène 400mg',
      motif: 'Revu lors d’une contestation',
    });

    const sqlValues = (prisma.$executeRaw as jest.Mock).mock.calls[0];
    // Le tag template `$executeRaw` reçoit les valeurs interpolées après le tableau de chaînes.
    expect(sqlValues).toContain('SUBSTITUTION_PHARMACIEN_CONSEIL');
  });

  it('la caissière reste exclue même pour le pharmacien conseil (rôle non reconnu)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    await expect(
      service.substituerMedicament(USER, 'ligne-disp-1', {
        nouveauMedicament: 'Ibuprofène 400mg',
        motif: 'Rupture de stock du princeps',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // --- obtenirDispensation (détail/statut, scopé pharmacie) -----------------

  it("obtenirDispensation refuse une dispensation d'une AUTRE pharmacie (404, pas de fuite d'existence)", async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue(null);
    await expect(service.obtenirDispensation(USER, 'disp-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dispensationPharmacie.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'disp-1', pharmacieId: 'pharm-2' } }),
    );
  });

  it('obtenirDispensation ne renvoie jamais le code de confirmation', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    prisma.dispensationPharmacie.findFirst.mockResolvedValue({
      id: 'disp-1',
      statut: 'EN_ATTENTE_VALIDATION_PATIENT',
      montantTotal: dec(500),
      codeConfirmation: 'SECRET42',
      datePreparation: new Date(),
      dateValidationPatient: null,
      datePaiement: null,
      lignes: [
        {
          id: 'ligne-disp-1',
          ligneOrdonnanceId: 'ligne-1',
          medicamentSubstitue: null,
          motifSubstitution: null,
          quantite: 1,
          prixUnitaire: dec(500),
          montantLigne: dec(500),
          montantAssurance: dec(400),
          montantPatient: dec(100),
          ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
        },
      ],
      reclamations: [],
    });
    const res = await service.obtenirDispensation(USER, 'disp-1');
    expect(res).not.toHaveProperty('codeConfirmation');
    expect(res.lignes[0].denominationMedicament).toBe('Paracetamol 500mg');
    expect(res.reclamation).toBeNull();
  });

  // --- listerDispensationsPharmacie (corrige l'incohérence pharmacien/comptable) ---

  it('scope strict à SA pharmacie et ne renvoie jamais le code de confirmation', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.dispensationPharmacie.findMany.mockResolvedValue([
      {
        id: 'disp-1',
        statut: 'PAYEE',
        montantTotal: dec(500),
        codeConfirmation: 'SECRET42',
        datePreparation: new Date(),
        dateValidationPatient: new Date(),
        datePaiement: new Date(),
        ordonnance: { dossier: { adherent: { nom: 'Konan', prenom: 'Adjoua', numeroCarte: 'CM-1' }, beneficiaire: null } },
        lignes: [
          {
            medicamentSubstitue: null,
            quantite: 1,
            montantLigne: dec(500),
            montantAssurance: dec(400),
            montantPatient: dec(100),
            ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
          },
        ],
      },
    ]);

    const res = await service.listerDispensationsPharmacie(USER, {});

    expect(prisma.dispensationPharmacie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pharmacieId: 'pharm-1' } }),
    );
    expect(res.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ codeConfirmation: expect.anything() })]));
    expect(res.items[0].patient).toEqual({ nom: 'Konan', prenom: 'Adjoua', numeroCarte: 'CM-1' });
    expect(res.items[0].lignes[0].denominationMedicament).toBe('Paracetamol 500mg');
  });

  it('filtre par statut quand demandé (comptable : PAYEE uniquement)', async () => {
    identity.getMe.mockResolvedValue(caissiere('pharm-1'));
    await service.listerDispensationsPharmacie(USER, { statut: 'PAYEE' });
    expect(prisma.dispensationPharmacie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pharmacieId: 'pharm-1', statut: 'PAYEE' } }),
    );
  });

  it("un rôle non-pharmacie ne peut pas lister les dispensations d'une pharmacie", async () => {
    identity.getMe.mockResolvedValue(adherent());
    await expect(service.listerDispensationsPharmacie(USER, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dispensationPharmacie.findMany).not.toHaveBeenCalled();
  });

  it('affiche le nom du médicament substitué (pas l’original) dans la liste', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.dispensationPharmacie.findMany.mockResolvedValue([
      {
        id: 'disp-1',
        statut: 'PAYEE',
        montantTotal: dec(1200),
        codeConfirmation: null,
        datePreparation: new Date(),
        dateValidationPatient: new Date(),
        datePaiement: new Date(),
        ordonnance: { dossier: { adherent: null, beneficiaire: { nom: 'Traore', prenom: 'Awa', numeroCarte: 'CM-2' } } },
        lignes: [
          {
            medicamentSubstitue: 'Ibuprofène 400mg',
            quantite: 1,
            montantLigne: dec(1200),
            montantAssurance: dec(960),
            montantPatient: dec(240),
            ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
          },
        ],
      },
    ]);
    const res = await service.listerDispensationsPharmacie(USER, {});
    expect(res.items[0].lignes[0].denominationMedicament).toBe('Ibuprofène 400mg');
    expect(res.items[0].patient).toEqual({ nom: 'Traore', prenom: 'Awa', numeroCarte: 'CM-2' });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Exclusion des lignes EN LITIGE (module contestation/) — tant qu'une
  //  contestation est OUVERT/JUSTIFICATION_RECUE ou REJETEE, `enLitige: true`
  //  remplace le montant partout où il apparaît.
  // ═══════════════════════════════════════════════════════════════════════
  describe('exclusion des lignes en litige (contestation)', () => {
    it('obtenirDispensation masque le montant d’une ligne EN LITIGE (OUVERT) et l’exclut du total', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'ligne-1' }]);
      prisma.dispensationPharmacie.findFirst.mockResolvedValue({
        id: 'disp-1',
        statut: 'PAYEE',
        montantTotal: dec(1000),
        codeConfirmation: null,
        datePreparation: new Date(),
        dateValidationPatient: new Date(),
        datePaiement: new Date(),
        lignes: [
          {
            id: 'ligne-disp-1',
            ligneOrdonnanceId: 'ligne-1',
            medicamentSubstitue: null,
            motifSubstitution: null,
            quantite: 1,
            prixUnitaire: dec(500),
            montantLigne: dec(500),
            montantAssurance: dec(400),
            montantPatient: dec(100),
            ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
          },
          {
            id: 'ligne-disp-2',
            ligneOrdonnanceId: 'ligne-2',
            medicamentSubstitue: null,
            motifSubstitution: null,
            quantite: 1,
            prixUnitaire: dec(500),
            montantLigne: dec(500),
            montantAssurance: dec(400),
            montantPatient: dec(100),
            ligneOrdonnance: { denominationMedicament: 'Ibuprofène 400mg' },
          },
        ],
        reclamations: [],
      });

      const res = await service.obtenirDispensation(USER, 'disp-1');

      expect(res.lignes[0]).toMatchObject({ enLitige: true, montantAssurance: null, montantPatient: null });
      expect(res.lignes[1]).toMatchObject({ enLitige: false, montantAssurance: '400.00', montantPatient: '100.00' });
      // Totaux : seule la ligne NON litigieuse est comptée (400/100, pas 800/200).
      expect(res.montantAssurance).toBe('400.00');
      expect(res.montantPatient).toBe('100.00');
    });

    it('listerDispensationsPharmacie marque enLitige sur la ligne concernée et exclut son montant du total', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'ligne-1' }]);
      prisma.dispensationPharmacie.findMany.mockResolvedValue([
        {
          id: 'disp-1',
          statut: 'PAYEE',
          montantTotal: dec(500),
          codeConfirmation: null,
          datePreparation: new Date(),
          dateValidationPatient: new Date(),
          datePaiement: new Date(),
          ordonnance: { dossier: { adherent: { nom: 'Konan', prenom: 'Adjoua', numeroCarte: 'CM-1' }, beneficiaire: null } },
          lignes: [
            {
              ligneOrdonnanceId: 'ligne-1',
              medicamentSubstitue: null,
              quantite: 1,
              montantLigne: dec(500),
              montantAssurance: dec(400),
              montantPatient: dec(100),
              ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
            },
          ],
        },
      ]);

      const res = await service.listerDispensationsPharmacie(USER, {});

      expect(res.items[0].montantAssurance).toBe('0.00');
      expect(res.items[0].montantPatient).toBe('0.00');
      expect(res.items[0].lignes[0]).toMatchObject({ enLitige: true });
    });

    it('une ligne SANS contestation active n’est jamais masquée (comportement inchangé)', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findMany.mockResolvedValue([]); // aucune contestation active
      prisma.dispensationPharmacie.findFirst.mockResolvedValue({
        id: 'disp-1',
        statut: 'PAYEE',
        montantTotal: dec(500),
        codeConfirmation: null,
        datePreparation: new Date(),
        dateValidationPatient: new Date(),
        datePaiement: new Date(),
        lignes: [
          {
            id: 'ligne-disp-1',
            ligneOrdonnanceId: 'ligne-1',
            medicamentSubstitue: null,
            motifSubstitution: null,
            quantite: 1,
            prixUnitaire: dec(500),
            montantLigne: dec(500),
            montantAssurance: dec(400),
            montantPatient: dec(100),
            ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
          },
        ],
        reclamations: [],
      });

      const res = await service.obtenirDispensation(USER, 'disp-1');

      expect(res.lignes[0]).toMatchObject({ enLitige: false, montantAssurance: '400.00', montantPatient: '100.00' });
      expect(res.montantAssurance).toBe('400.00');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Consolidation mensuelle des factures pharmacie — circuit à 3 niveaux.
  //  Horloge figée (2026-09-18) : mois précédent = août 2026.
  // ═══════════════════════════════════════════════════════════════════════
  describe('consolidation mensuelle des factures pharmacie', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T12:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    describe('soumettreFactureMensuelle', () => {
      it('rôle non autorisé (caissière) → 403', async () => {
        identity.getMe.mockResolvedValue(caissiere('pharm-1'));
        await expect(
          service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.dispensationPharmacie.findMany).not.toHaveBeenCalled();
      });

      it('rôle non autorisé (adhérent, pas de pharmacie) → 403', async () => {
        identity.getMe.mockResolvedValue(adherent());
        await expect(
          service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('périodes autres que le mois précédent → 400', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        await expect(
          service.soumettreFactureMensuelle(USER, { periode: '2026-07-01' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.soumettreFactureMensuelle(USER, { periode: '2026-09-01' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('facture déjà soumise pour cette période → 409', async () => {
        identity.getMe.mockResolvedValue(comptablePharmacie('pharm-1'));
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({ id: 'fact-0', statut: 'SOUMISE' });
        await expect(
          service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('agrège les lignes PAYEE, exclut celles en litige, et ne stampe que les facturables', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        prisma.ligneDispensation.findMany.mockResolvedValue([
          { id: 'ligne-disp-1', ligneOrdonnanceId: 'lo-1', montantAssurance: dec(4000) },
          { id: 'ligne-disp-2', ligneOrdonnanceId: 'lo-2', montantAssurance: dec(1500) },
          { id: 'ligne-disp-3', ligneOrdonnanceId: 'lo-3', montantAssurance: dec(2000) },
        ]);
        prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'lo-2' }]); // lo-2 en litige
        prisma.factureMensuellePharmacie.create.mockResolvedValue({ id: 'fact-1' });
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fact-1',
          periode: new Date('2026-08-01'),
          statut: 'SOUMISE',
          montantTotal: dec(6000),
          dateSoumission: new Date('2026-09-18T12:00:00Z'),
        });

        const res = await service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' });

        // 4000 (lo-1) + 2000 (lo-3) = 6000 — lo-2 (1500, en litige) exclue.
        expect(prisma.factureMensuellePharmacie.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ montantTotal: '6000.00' }) }),
        );
        expect(prisma.ligneDispensation.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['ligne-disp-1', 'ligne-disp-3'] } },
          data: { factureMensuelleId: 'fact-1', reporteeMoisSuivant: false },
        });
        expect(res.nbLignesIncluses).toBe(2);
        expect(res.nbLignesExclues).toBe(1);
      });

      it("n'inclut jamais une ligne déjà réclamée par une facture précédente (filtrée côté requête)", async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        prisma.ligneDispensation.findMany.mockResolvedValue([]);
        prisma.factureMensuellePharmacie.create.mockResolvedValue({ id: 'fact-2' });
        prisma.factureMensuellePharmacie.update.mockResolvedValue({ id: 'fact-2', statut: 'SOUMISE', montantTotal: dec(0) });

        const res = await service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' });

        expect(prisma.ligneDispensation.updateMany).not.toHaveBeenCalled();
        expect(res.nbLignesIncluses).toBe(0);
        expect(prisma.ligneDispensation.findMany.mock.calls[0][0].where.factureMensuelleId).toBeNull();
      });

      it('réutilise (ne duplique pas) une facture EN_PREPARATION existante pour la même période', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({ id: 'fact-existante', statut: 'EN_PREPARATION' });
        prisma.ligneDispensation.findMany.mockResolvedValue([
          { id: 'ligne-disp-1', ligneOrdonnanceId: 'lo-1', montantAssurance: dec(3000) },
        ]);
        prisma.factureMensuellePharmacie.update
          .mockResolvedValueOnce({ id: 'fact-existante', montantTotal: dec(3000) })
          .mockResolvedValueOnce({ id: 'fact-existante', statut: 'SOUMISE', montantTotal: dec(3000) });

        const res = await service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' });

        expect(prisma.factureMensuellePharmacie.create).not.toHaveBeenCalled();
        expect(res.id).toBe('fact-existante');
      });

      it('réintègre une ligne reportée (litige résolu VALIDEE) indépendamment de son datePaiement d’origine', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        prisma.ligneDispensation.findMany.mockResolvedValue([
          { id: 'ligne-disp-1', ligneOrdonnanceId: 'lo-1', montantAssurance: dec(1500) },
        ]);
        prisma.contestationPrescription.findMany.mockResolvedValue([]); // litige résolu (VALIDEE, plus dans la liste)
        prisma.factureMensuellePharmacie.create.mockResolvedValue({ id: 'fact-3' });
        prisma.factureMensuellePharmacie.update.mockResolvedValue({ id: 'fact-3', statut: 'SOUMISE', montantTotal: dec(1500) });

        const res = await service.soumettreFactureMensuelle(USER, { periode: '2026-08-01' });

        expect(prisma.ligneDispensation.findMany.mock.calls[0][0].where.OR).toEqual([
          { dispensation: { datePaiement: expect.anything() } },
          { reporteeMoisSuivant: true },
        ]);
        expect(res.nbLignesIncluses).toBe(1);
      });
    });

    describe('validerFactureMensuelle', () => {
      it('rôle non autorisé (comptable) → 403', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        await expect(
          service.validerFactureMensuelle(USER, 'fact-1', { decision: 'VALIDEE' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.factureMensuellePharmacie.findFirst).not.toHaveBeenCalled();
      });

      it('facture introuvable → 404', async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(null);
        await expect(
          service.validerFactureMensuelle(USER, 'fact-x', { decision: 'VALIDEE' }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it("facture pas SOUMISE (déjà validée) → 409", async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'VALIDEE_PHARMACIEN_CONSEIL',
          lignes: [],
        });
        await expect(
          service.validerFactureMensuelle(USER, 'fact-1', { decision: 'VALIDEE' }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it("double sécurité : une ligne devenue en litige APRÈS soumission bloque la validation (409)", async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'SOUMISE',
          lignes: [{ ligneOrdonnanceId: 'lo-1' }, { ligneOrdonnanceId: 'lo-2' }],
        });
        prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'lo-2' }]);

        await expect(
          service.validerFactureMensuelle(USER, 'fact-1', { decision: 'VALIDEE' }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.factureMensuellePharmacie.update).not.toHaveBeenCalled();
      });

      it('valide avec succès quand aucune ligne incluse n’est en litige', async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'SOUMISE',
          lignes: [{ ligneOrdonnanceId: 'lo-1' }],
        });
        prisma.contestationPrescription.findMany.mockResolvedValue([]);
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fact-1',
          statut: 'VALIDEE_PHARMACIEN_CONSEIL',
          montantTotal: dec(6000),
        });

        const res = await service.validerFactureMensuelle(USER, 'fact-1', { decision: 'VALIDEE' });

        expect(prisma.factureMensuellePharmacie.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ statut: 'VALIDEE_PHARMACIEN_CONSEIL', valideParId: 'u1' }),
          }),
        );
        expect(res.statut).toBe('VALIDEE_PHARMACIEN_CONSEIL');
      });

      it('A_CORRIGER libère les lignes stampées et remet la facture à EN_PREPARATION (miroir établissement)', async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'SOUMISE',
          lignes: [{ ligneOrdonnanceId: 'lo-1' }, { ligneOrdonnanceId: 'lo-2' }],
        });
        prisma.contestationPrescription.findMany.mockResolvedValue([]);
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fact-1',
          statut: 'EN_PREPARATION',
          montantTotal: dec(6000),
        });

        const res = await service.validerFactureMensuelle(USER, 'fact-1', { decision: 'A_CORRIGER' });

        expect(prisma.ligneDispensation.updateMany).toHaveBeenCalledWith({
          where: { factureMensuelleId: 'fact-1' },
          data: { factureMensuelleId: null },
        });
        expect(prisma.factureMensuellePharmacie.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ statut: 'EN_PREPARATION', dateSoumission: null }),
          }),
        );
        expect(res.statut).toBe('EN_PREPARATION');
      });
    });

    describe('validerPourPaiement / marquerFactureMensuellePayee', () => {
      it('rôle non autorisé (pharmacien) → 403', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        await expect(
          service.validerPourPaiement(USER, 'fact-1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('facture pas encore VALIDEE_PHARMACIEN_CONSEIL → 409', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({ id: 'fact-1', statut: 'SOUMISE', lignes: [] });
        await expect(
          service.validerPourPaiement(USER, 'fact-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('refuse si une ligne encore en litige non décochée subsiste', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'VALIDEE_PHARMACIEN_CONSEIL',
          lignes: [{ id: 'ld-1', ligneOrdonnanceId: 'lo-1', montantAssurance: dec(1000) }],
        });
        prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'lo-1' }]);
        await expect(
          service.validerPourPaiement(USER, 'fact-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.factureMensuellePharmacie.update).not.toHaveBeenCalled();
      });

      it('valide pour paiement une fois VALIDEE_PHARMACIEN_CONSEIL et litige-free', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue({
          id: 'fact-1',
          statut: 'VALIDEE_PHARMACIEN_CONSEIL',
          lignes: [],
        });
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fact-1',
          statut: 'PROGRAMMEE_PAIEMENT',
          montantTotal: dec(6000),
        });

        const res = await service.validerPourPaiement(USER, 'fact-1');
        expect(res.statut).toBe('PROGRAMMEE_PAIEMENT');
      });

      // Le paiement RÉEL (marquerFactureMensuellePayee, symbolique, retiré) est
      // désormais couvert par `PaymentService.payerFacture` (payment.service.spec.ts).
    });

    describe('decocherLigneContestee', () => {
      const factureAvecLigne = (statut: string) => ({
        id: 'fact-1',
        statut,
        montantTotal: dec(6000),
        lignes: [{ id: 'ld-1', ligneOrdonnanceId: 'lo-1', montantAssurance: dec(1500) }],
      });

      it('rôle non autorisé (pharmacien) → 403', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        await expect(
          service.decocherLigneContestee(USER, 'fact-1', 'ld-1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('facture déjà PROGRAMMEE_PAIEMENT → 409 (trop tard)', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureAvecLigne('PROGRAMMEE_PAIEMENT'));
        await expect(
          service.decocherLigneContestee(USER, 'fact-1', 'ld-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('ligne introuvable sur cette facture → 404', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
        await expect(
          service.decocherLigneContestee(USER, 'fact-1', 'ld-x'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('ligne pas en litige → 400 (rien à retirer)', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
        prisma.contestationPrescription.findMany.mockResolvedValue([]);
        await expect(
          service.decocherLigneContestee(USER, 'fact-1', 'ld-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('retire la ligne en litige, recalcule le montant, marque reportée', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureAvecLigne('SOUMISE'));
        prisma.contestationPrescription.findMany.mockResolvedValue([{ ligneOrdonnanceId: 'lo-1' }]);
        prisma.factureMensuellePharmacie.update.mockResolvedValue({
          id: 'fact-1',
          montantTotal: dec(4500),
          nbLignesReportees: 1,
        });

        const res = await service.decocherLigneContestee(USER, 'fact-1', 'ld-1');

        expect(prisma.ligneDispensation.update).toHaveBeenCalledWith({
          where: { id: 'ld-1' },
          data: { factureMensuelleId: null, reporteeMoisSuivant: true },
        });
        expect(prisma.factureMensuellePharmacie.update).toHaveBeenCalledWith({
          where: { id: 'fact-1' },
          data: { montantTotal: '4500.00', nbLignesReportees: { increment: 1 } },
        });
        expect(res.montantTotal).toBe('4500.00');
      });
    });

    describe('obtenirFactureMensuelle — verrou d’accès comptable', () => {
      const factureBrute = (statut: string) => ({
        id: 'fact-1',
        pharmacieId: 'pharm-1',
        statut,
        pharmacie: { nom: 'Pharmacie Test' },
        periode: new Date('2026-08-01'),
        montantTotal: dec(6000),
        nbLignesReportees: 0,
        dateSoumission: null,
        dateValidation: null,
        dateProgrammation: null,
        datePaiement: null,
        lignes: [],
      });

      it('ASSUREUR_COMPTABLE accède désormais à toute facture, quel que soit son statut (accès en revue global)', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureBrute('SOUMISE'));
        await expect(service.obtenirFactureMensuelle(USER, 'fact-1')).resolves.toMatchObject({ statut: 'SOUMISE' });
      });

      it('ASSUREUR_COMPTABLE accède aussi une fois VALIDEE_PHARMACIEN_CONSEIL', async () => {
        identity.getMe.mockResolvedValue(comptableAssureur());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureBrute('VALIDEE_PHARMACIEN_CONSEIL'));
        await expect(service.obtenirFactureMensuelle(USER, 'fact-1')).resolves.toMatchObject({ statut: 'VALIDEE_PHARMACIEN_CONSEIL' });
      });

      it('ASSUREUR_PHARMACIEN_CONSEIL accède quel que soit le statut', async () => {
        identity.getMe.mockResolvedValue(pharmacienConseil());
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureBrute('SOUMISE'));
        await expect(service.obtenirFactureMensuelle(USER, 'fact-1')).resolves.toMatchObject({ statut: 'SOUMISE' });
      });

      it('la pharmacie concernée accède à sa propre facture', async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureBrute('EN_PREPARATION'));
        await expect(service.obtenirFactureMensuelle(USER, 'fact-1')).resolves.toMatchObject({ statut: 'EN_PREPARATION' });
      });

      it("une AUTRE pharmacie n'accède pas à cette facture", async () => {
        identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
        prisma.factureMensuellePharmacie.findFirst.mockResolvedValue(factureBrute('SOUMISE'));
        await expect(service.obtenirFactureMensuelle(USER, 'fact-1')).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });
  // --- Pagination serveur des dispensations (remplace take: 100 / take: 50) ---
  describe('pagination serveur des dispensations', () => {
    it('pharmacie : skip/take de la page, MÊME where filtré pour le total (statut + période)', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.dispensationPharmacie.count.mockResolvedValue(230);

      const res = await service.listerDispensationsPharmacie(USER, { page: 3, limite: 10, statut: 'PAYEE', du: '2025-01-01', au: '2025-12-31' });

      const appel = prisma.dispensationPharmacie.findMany.mock.calls[0][0];
      expect(appel).toMatchObject({ skip: 20, take: 10 });
      expect(appel.where).toEqual({
        pharmacieId: 'pharm-1',
        statut: 'PAYEE',
        datePreparation: { gte: new Date('2025-01-01T00:00:00.000Z'), lt: new Date('2026-01-01T00:00:00.000Z') },
      });
      expect(prisma.dispensationPharmacie.count).toHaveBeenCalledWith({ where: appel.where });
      expect(res).toMatchObject({ total: 230, page: 3, limite: 10, pages: 23 });
    });

    it('pharmacie : recherche q pré-sélectionnée en SQL (sans accent) puis restreinte par id', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'disp-9' }]);

      await service.listerDispensationsPharmacie(USER, { q: 'Paracetamol Konan' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.dispensationPharmacie.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['disp-9'] } });
    });

    it('adhérent : pagination + statut, scope adhérent conservé', async () => {
      identity.getMe.mockResolvedValue(adherent('adh-1'));
      prisma.beneficiaire.findMany?.mockResolvedValue?.([]);
      await service.listerMesDispensations(USER, { page: 2, limite: 25, statut: 'PAYEE' });
      const appel = prisma.dispensationPharmacie.findMany.mock.calls[0][0];
      expect(appel).toMatchObject({ skip: 25, take: 25 });
      expect(appel.where).toMatchObject({ statut: 'PAYEE', ordonnance: { dossier: { OR: [{ adherentId: 'adh-1' }, { beneficiaire: { adherentId: 'adh-1' } }] } } });
    });
  });
});
