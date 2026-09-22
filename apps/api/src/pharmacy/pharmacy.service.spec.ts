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
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ligneDispensation: { createMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      contestationPrescription: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    claims = { soumettreDepuisDispensation: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
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

    it('sans garantie PHARMACIE → applique le taux par défaut (80%)', async () => {
      prisma.garantie.findFirst.mockResolvedValue(null);

      const res = await service.preparerDispensation(USER, 'ord-1', [{ ligneOrdonnanceId: 'ligne-1' }]);

      expect(res.montantAssurance).toBe('8000.00');
      expect(res.montantPatient).toBe('2000.00');
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

    it('soumet une réclamation de 8000 F (montant_assurance) au microservice d’adjudication', async () => {
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
          montant: '8000.00',
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
    expect(res).not.toEqual(expect.arrayContaining([expect.objectContaining({ codeConfirmation: expect.anything() })]));
    expect(res[0].patient).toEqual({ nom: 'Konan', prenom: 'Adjoua', numeroCarte: 'CM-1' });
    expect(res[0].lignes[0].denominationMedicament).toBe('Paracetamol 500mg');
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
    expect(res[0].lignes[0].denominationMedicament).toBe('Ibuprofène 400mg');
    expect(res[0].patient).toEqual({ nom: 'Traore', prenom: 'Awa', numeroCarte: 'CM-2' });
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

      expect(res[0].montantAssurance).toBe('0.00');
      expect(res[0].montantPatient).toBe('0.00');
      expect(res[0].lignes[0]).toMatchObject({ enLitige: true });
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
});
