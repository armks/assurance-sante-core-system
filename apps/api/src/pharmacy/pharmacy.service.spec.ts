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

  beforeEach(async () => {
    prisma = {
      adherent: { findFirst: jest.fn().mockResolvedValue(null) },
      beneficiaire: { findFirst: jest.fn().mockResolvedValue(null) },
      ordonnance: { findFirst: jest.fn() },
      ligneOrdonnance: { findMany: jest.fn(), updateMany: jest.fn() },
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
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PharmacyService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(PharmacyService);
  });

  // --- preparerDispensation ------------------------------------------

  it('REFUSE une ligne déjà SERVIE (verrou par ligne, pas par ordonnance)', async () => {
    identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
    prisma.ordonnance.findFirst.mockResolvedValue({
      id: 'ord-1', organisationId: 'org-1', statut: 'ACTIVE', deletedAt: null,
      dossier: { adherentId: 'adh-1', beneficiaireId: null },
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
      dossier: { adherentId: 'adh-1', beneficiaireId: null },
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
      dossier: { adherentId: 'adh-1', beneficiaireId: null },
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
      lignes: [{ ligneOrdonnanceId: 'ligne-1', quantite: 1 }],
    });
    prisma.ligneOrdonnance.updateMany.mockResolvedValue({ count: 1 });
    prisma.dispensationPharmacie.update.mockResolvedValue({
      id: 'disp-1', statut: 'PAYEE', montantTotal: dec(500), datePaiement: new Date(),
    });

    const res = await service.confirmerPaiementDispensation(USER, 'disp-1');
    expect(res.statut).toBe('PAYEE');
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
          ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
        },
      ],
    });
    const res = await service.obtenirDispensation(USER, 'disp-1');
    expect(res).not.toHaveProperty('codeConfirmation');
    expect(res.lignes[0].denominationMedicament).toBe('Paracetamol 500mg');
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
            ligneOrdonnance: { denominationMedicament: 'Paracetamol 500mg' },
          },
        ],
      },
    ]);
    const res = await service.listerDispensationsPharmacie(USER, {});
    expect(res[0].lignes[0].denominationMedicament).toBe('Ibuprofène 400mg');
    expect(res[0].patient).toEqual({ nom: 'Traore', prenom: 'Awa', numeroCarte: 'CM-2' });
  });
});
