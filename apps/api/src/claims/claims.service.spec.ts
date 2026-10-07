import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjudicationClientService,
  AdjudicationInjoignableError,
  AdjudicationRefusError,
  MESSAGES_INDISPONIBILITE,
  type DecisionAdjudication,
} from '../adjudication-client/adjudication-client.service';
import { ClaimsService } from './claims.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';

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
  organisationId: string | null = 'org-1',
  adherentId: string | null = null,
  societeId: string | null = null,
) => ({
  profil: { id: 'u1', organisationId, adherentId, societeId },
  permissions: roleChain.length ? { roleChain } : null,
});

const ACTE = {
  id: 'acte-1',
  dossierSoinsId: 'dos-1',
  categorieActe: 'CONSULTATION',
  montantPrescrit: '15000',
  quantite: 1,
};
const DOSSIER = {
  id: 'dos-1',
  organisationId: 'org-1',
  policeId: 'pol-1',
  planCouvertureId: 'gar-1',
  adherentId: 'adh-1',
  beneficiaireId: null,
};

const DECISION: DecisionAdjudication = {
  decision: 'AUTO_ADJUDIQUE',
  montant_rembourse: 12000,
  codes_rejet: [],
  plafond_restant_apres: 88000,
  duree_traitement_ms: 41,
};

describe('ClaimsService — soumission / verrouillage / adjudication', () => {
  let service: ClaimsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let adjudication: { evaluer: jest.Mock };

  beforeEach(async () => {
    prisma = {
      acteDossier: {
        findFirst: jest.fn().mockResolvedValue(ACTE),
        findMany: jest.fn().mockResolvedValue([{ id: 'acte-1', categorieActe: 'CONSULTATION' }]),
      },
      dossierSoins: { findFirst: jest.fn().mockResolvedValue(DOSSIER) },
      police: { findFirst: jest.fn().mockResolvedValue({ produitId: 'prod-1' }) },
      // aucune ligne de facturation tiers payant pour l'acte, par défaut
      ligneFacturation: { findFirst: jest.fn().mockResolvedValue(null) },
      // garantie du produit pour la catégorie de l'acte (≠ planCouvertureId)
      garantie: { findFirst: jest.fn().mockResolvedValue({ id: 'gar-consultation' }) },
      reclamation: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      remboursement: { update: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_EXPLOITATION'])),
    };
    adjudication = { evaluer: jest.fn().mockResolvedValue(DECISION) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        ClaimsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: AdjudicationClientService, useValue: adjudication },
      ],
    }).compile();
    service = moduleRef.get(ClaimsService);
  });

  it('verrouille SOUMISE → EN_ADJUDICATION, appelle le microservice, applique la décision', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(null) // pas de réclamation existante
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE', codesRejet: [] }); // chargerReclamation
    prisma.reclamation.create.mockResolvedValue({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', statut: 'SOUMISE', deletedAt: null },
      data: { statut: 'EN_ADJUDICATION' },
    });
    expect(adjudication.evaluer).toHaveBeenCalledWith('rec-1');
    expect(prisma.reclamation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { statut: 'AUTO_ADJUDIQUE', codesRejet: [] },
    });
    expect(res.reclamation.statut).toBe('AUTO_ADJUDIQUE');
    expect(res.adjudication).toEqual(DECISION);
  });

  it('garantie = celle du produit pour la CATÉGORIE de l’acte, jamais planCouvertureId ; type depuis le référentiel', async () => {
    prisma.acteDossier.findFirst.mockResolvedValue({ ...ACTE, categorieActe: 'MATERNITE' });
    prisma.garantie.findFirst.mockResolvedValue({ id: 'gar-maternite' });
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE', codesRejet: [] });
    prisma.reclamation.create.mockResolvedValue({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.garantie.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { produitId: 'prod-1', categorieActe: 'MATERNITE', deletedAt: null },
      }),
    );
    expect(prisma.reclamation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          garantieId: 'gar-maternite', // et non DOSSIER.planCouvertureId ('gar-1')
          typeReclamation: 'HOSPITALISATION', // categories_acte.type_reclamation de MATERNITE
        }),
      }),
    );
  });

  it('catégorie sans garantie dans le produit → réclamation REJETE E011, garantie NULL, AUCUN appel au microservice', async () => {
    prisma.acteDossier.findFirst.mockResolvedValue({ ...ACTE, categorieActe: 'ACTE_TECHNIQUE' });
    prisma.garantie.findFirst.mockResolvedValue(null);
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(null) // aucune réclamation existante pour l'acte
      .mockResolvedValueOnce({ id: 'rec-nc', statut: 'REJETE', codesRejet: ['E011'], acteDossierId: 'acte-1' });
    prisma.reclamation.create.mockResolvedValue({ id: 'rec-nc' });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acteDossierId: 'acte-1',
        garantieId: null,
        statut: 'REJETE',
        codesRejet: ['E011'],
        montant: '15000.00',
        typeReclamation: 'SOIN',
      }),
    });
    expect(adjudication.evaluer).not.toHaveBeenCalled();
    expect(res.adjudication).toBeNull();
    expect(res.reclamation.codesRejet).toEqual(['E011']);
  });

  it('acte déjà facturé en tiers payant → 409 : pas de réclamation (ni double paiement, ni double cumul du plafond)', async () => {
    prisma.ligneFacturation.findFirst.mockResolvedValue({ id: 'lf-1' });

    await expect(service.soumettre(USER, { acteDossierId: 'acte-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.ligneFacturation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { acteDossierId: 'acte-1' } }),
    );
    expect(prisma.reclamation.create).not.toHaveBeenCalled();
    expect(adjudication.evaluer).not.toHaveBeenCalled();
  });

  it('catégorie non couverte déjà réclamée → 409 (idempotence), rien recréé', async () => {
    prisma.acteDossier.findFirst.mockResolvedValue({ ...ACTE, categorieActe: 'ACTE_TECHNIQUE' });
    prisma.garantie.findFirst.mockResolvedValue(null);
    prisma.reclamation.findFirst.mockResolvedValueOnce({ id: 'rec-nc', statut: 'REJETE' });

    await expect(service.soumettre(USER, { acteDossierId: 'acte-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.reclamation.create).not.toHaveBeenCalled();
  });

  it('décision REJETE avec codes_rejet : les codes sont persistés', async () => {
    adjudication.evaluer.mockResolvedValue({
      ...DECISION,
      decision: 'REJETE',
      montant_rembourse: 0,
      codes_rejet: ['E001'],
    });
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' })
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'REJETE', codesRejet: ['E001'] });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { statut: 'REJETE', codesRejet: ['E001'] },
    });
    expect(res.adjudication?.decision).toBe('REJETE');
  });

  it('microservice INJOIGNABLE → réclamation remise à SOUMISE + 503', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany
      .mockResolvedValueOnce({ count: 1 }) // le verrouillage SOUMISE→EN_ADJUDICATION
      .mockResolvedValueOnce({ count: 1 }); // le retour EN_ADJUDICATION→SOUMISE
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationInjoignableError('timeout après 12000 ms'),
    );

    const err = await service.soumettre(USER, { acteDossierId: 'acte-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    // détail technique dans l'audit et les logs, jamais dans le message
    expect(err.message).toBe(MESSAGES_INDISPONIBILITE.reclamation);
    expect(err.message).not.toMatch(/timeout|12000|microservice/i);

    expect(prisma.reclamation.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'rec-1', statut: 'EN_ADJUDICATION', deletedAt: null },
      data: { statut: 'SOUMISE', codesRejet: ['ADJ_ECHEC'] },
    });
    // journalisation de l'échec
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('microservice renvoie une ERREUR HTTP → réclamation remise à SOUMISE + 502', async () => {
    prisma.reclamation.findFirst.mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationRefusError(500, 'Internal Server Error'),
    );

    const err = await service.soumettre(USER, { acteDossierId: 'acte-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toBe(MESSAGES_INDISPONIBILITE.reclamationErreur);
    expect(err.message).not.toMatch(/500|Internal Server Error|HTTP/);
  });

  it('échec de transport mais la réclamation a déjà avancé → pas de retour à SOUMISE', async () => {
    prisma.reclamation.findFirst.mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValueOnce({ count: 1 }); // verrouillage
    // le microservice a commité (statut avancé) avant que la réponse HTTP se perde
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationInjoignableError('socket hang up'),
    );

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // on ne repasse PAS à SOUMISE
    expect(prisma.reclamation.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: 'SOUMISE' }) }),
    );
  });

  it('2e soumission d’une réclamation déjà EN_ADJUDICATION (idempotence) → 409, pas d’appel microservice', async () => {
    prisma.reclamation.findFirst.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(adjudication.evaluer).not.toHaveBeenCalled();
  });

  it('refuse un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adjudication.evaluer).not.toHaveBeenCalled();
  });

  // --- Revue manuelle ---------------------------------------------

  const REVUE = {
    id: 'rec-1',
    acteDossierId: 'acte-1', // CONSULTATION → revue ASSUREUR_MEDECIN_CONSEIL (référentiel)
    statut: 'REVUE_MANUELLE',
    typeReclamation: 'SOIN',
    codesRejet: ['E010'],
    organisationId: 'org-1',
    remboursement: { montantRembourse: { toString: () => '160000.00' } },
  };

  it('médecin-conseil APPROUVE une réclamation médicale REVUE_MANUELLE → AUTO_ADJUDIQUE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(REVUE)
      .mockResolvedValueOnce({ ...REVUE, statut: 'AUTO_ADJUDIQUE' });

    const res = await service.validerManuellement(USER, 'rec-1', {
      decision: 'APPROUVE',
      motif: 'Justificatifs conformes',
    });

    expect(prisma.reclamation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: 'AUTO_ADJUDIQUE' }) }),
    );
    expect(res.statut).toBe('AUTO_ADJUDIQUE');
  });

  it('APPROUVE avec montantAjuste → le remboursement est mis à jour', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(REVUE)
      .mockResolvedValueOnce(REVUE);

    await service.validerManuellement(USER, 'rec-1', {
      decision: 'APPROUVE',
      montantAjuste: 120000,
      motif: 'Plafonné au barème',
    });

    expect(prisma.remboursement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ montantRembourse: '120000.00', decision: 'REVUE_MANUELLE_APPROUVE' }),
      }),
    );
  });

  it('REJETE → statut REJETE, remboursement à 0, code REJET_MANUEL', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(REVUE)
      .mockResolvedValueOnce({ ...REVUE, statut: 'REJETE' });

    await service.validerManuellement(USER, 'rec-1', {
      decision: 'REJETE',
      motif: 'Acte non couvert par la garantie',
    });

    expect(prisma.reclamation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'REJETE',
          codesRejet: ['E010', 'REJET_MANUEL'],
        }),
      }),
    );
    expect(prisma.remboursement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ montantRembourse: '0.00' }) }),
    );
  });

  it('exploitation ne peut PAS traiter une réclamation médicale (type SOIN) → 403', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.reclamation.findFirst.mockResolvedValueOnce(REVUE);

    await expect(
      service.validerManuellement(USER, 'rec-1', { decision: 'APPROUVE', motif: 'ok' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reclamation.update).not.toHaveBeenCalled();
  });

  it('rôle de revue lu dans le référentiel : acte TRANSPORT → le médecin conseil est refusé (403)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.acteDossier.findMany.mockResolvedValue([{ id: 'acte-1', categorieActe: 'TRANSPORT' }]);
    prisma.reclamation.findFirst.mockResolvedValueOnce({ ...REVUE, typeReclamation: 'AUTRE' });

    await expect(
      service.validerManuellement(USER, 'rec-1', { decision: 'APPROUVE', motif: 'Frais de transport' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exploitation traite une réclamation non médicale (acte TRANSPORT)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.acteDossier.findMany.mockResolvedValue([{ id: 'acte-1', categorieActe: 'TRANSPORT' }]);
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ ...REVUE, typeReclamation: 'AUTRE' })
      .mockResolvedValueOnce({ ...REVUE, typeReclamation: 'AUTRE', statut: 'AUTO_ADJUDIQUE' });

    const res = await service.validerManuellement(USER, 'rec-1', {
      decision: 'APPROUVE',
      motif: 'Frais de transport justifiés',
    });
    expect(res.statut).toBe('AUTO_ADJUDIQUE');
  });

  it('refuse si la réclamation n’est pas REVUE_MANUELLE → 409', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.reclamation.findFirst.mockResolvedValueOnce({ ...REVUE, statut: 'AUTO_ADJUDIQUE' });

    await expect(
      service.validerManuellement(USER, 'rec-1', { decision: 'APPROUVE', motif: 'ok' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Lecture des réclamations — fuite inter-société corrigée (audit filière
//  société) : `organisationId` seul ne suffit pas, `reclamations` n'a pas de
//  colonne société → en attendant ce scoping, la lecture est réservée au
//  personnel ASSUREUR habilité (ROLES_LECTURE_CLAIMS), à l'adhérent concerné
//  (ses propres réclamations), ou à sa société (ses propres adhérents,
//  ROLES_SOCIETE_CLAIMS — prompt gestion collaborative).
// ═══════════════════════════════════════════════════════════════════════
describe('ClaimsService — autorisation de lecture (listerReclamations / obtenirReclamation)', () => {
  let service: ClaimsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      reclamation: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      adherent: { findMany: jest.fn().mockResolvedValue([]) },
      beneficiaire: { findMany: jest.fn().mockResolvedValue([]) },
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        ClaimsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: AdjudicationClientService, useValue: { evaluer: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ClaimsService);
  });

  it('SOCIETE_ASSUREE sans societeId rattaché → 403 (compte mal provisionné, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE']));
    await expect(service.listerReclamations(USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.reclamation.findMany).not.toHaveBeenCalled();
  });

  it('SOCIETE_COMPTABLE ne peut PAS lire une réclamation par id → 403 (pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(identite(['SOCIETE_COMPTABLE']));
    await expect(
      service.obtenirReclamation(USER, 'rec-autre-societe'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reclamation.findFirst).not.toHaveBeenCalled();
  });

  it('ASSUREUR_EXPLOITATION liste normalement (rôle habilité, pas de régression)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    await expect(service.listerReclamations(USER, {})).resolves.toEqual([]);
    expect(prisma.reclamation.findMany).toHaveBeenCalled();
  });

  it('ASSUREUR_MEDECIN_CONSEIL lit une réclamation par id (rôle habilité, revue médicale)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.reclamation.findFirst.mockResolvedValue({ id: 'rec-1', organisationId: 'org-1' });
    const res = await service.obtenirReclamation(USER, 'rec-1');
    expect(res).toBeDefined();
  });

  // ═════════════════════════════════════════════════════════════════════
  //  Lecture ADHERENT (audit dashboard adhérent) : `reclamations` a bien une
  //  colonne `adherentId` — un adhérent peut donc lire SES PROPRES réclamations,
  //  mais strictement scopées, jamais celles d'un autre adhérent de l'organisation.
  // ═════════════════════════════════════════════════════════════════════
  it('ADHERENT_TITULAIRE liste SES réclamations, scopées par adherentId', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', 'adh-1'),
    );
    await service.listerReclamations(USER, {});
    expect(prisma.reclamation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: 'org-1',
          OR: expect.arrayContaining([{ adherentId: 'adh-1' }]),
        }),
      }),
    );
  });

  it('ADHERENT_TITULAIRE liste aussi les réclamations de SES bénéficiaires (couverture bénéficiaires)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', 'adh-1'),
    );
    prisma.beneficiaire.findMany.mockResolvedValue([{ id: 'ben-1' }, { id: 'ben-2' }]);
    await service.listerReclamations(USER, {});
    expect(prisma.beneficiaire.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ adherentId: 'adh-1' }) }),
    );
    expect(prisma.reclamation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ adherentId: 'adh-1' }, { beneficiaireId: { in: ['ben-1', 'ben-2'] } }],
        }),
      }),
    );
  });

  it('ADHERENT_TITULAIRE lit sa propre réclamation par id', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', 'adh-1'),
    );
    prisma.reclamation.findFirst.mockResolvedValue({
      id: 'rec-1',
      organisationId: 'org-1',
      adherentId: 'adh-1',
    });
    const res = await service.obtenirReclamation(USER, 'rec-1');
    expect(res).toBeDefined();
    expect(prisma.reclamation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'rec-1',
          OR: expect.arrayContaining([{ adherentId: 'adh-1' }]),
        }),
      }),
    );
  });

  it('ADHERENT_TITULAIRE lit la réclamation ouverte pour un de SES bénéficiaires (couverture bénéficiaires)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', 'adh-1'),
    );
    prisma.beneficiaire.findMany.mockResolvedValue([{ id: 'ben-1' }]);
    prisma.reclamation.findFirst.mockResolvedValue({
      id: 'rec-1',
      organisationId: 'org-1',
      adherentId: null,
      beneficiaireId: 'ben-1',
    });
    const res = await service.obtenirReclamation(USER, 'rec-1');
    expect(res).toBeDefined();
  });

  it('ADHERENT_TITULAIRE ne peut PAS lire la réclamation d’un autre adhérent (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', 'adh-2'),
    );
    // le mock Prisma est scopé par adherentId dans le `where` : une réclamation
    // d'un autre adhérent ne matche jamais → findFirst renvoie null.
    prisma.reclamation.findFirst.mockResolvedValue(null);
    await expect(
      service.obtenirReclamation(USER, 'rec-autre-adherent'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rôle ADHERENT sans adherentId rattaché → 403 (compte mal provisionné, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], 'org-1', null),
    );
    await expect(service.listerReclamations(USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ═════════════════════════════════════════════════════════════════════
  //  Lecture SOCIETE (gestion collaborative société cliente) : pas de
  //  colonne société sur `reclamations` — le scope est dérivé via les
  //  adhérents de la société (`adherentIdsSociete`), jamais l'organisation
  //  entière ni une autre société.
  // ═════════════════════════════════════════════════════════════════════
  it('SOCIETE_ADMINISTRATION liste les réclamations de SES adhérents, scopées', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], 'org-1', null, 'sous-1'),
    );
    prisma.adherent.findMany.mockResolvedValue([{ id: 'adh-1' }, { id: 'adh-2' }]);

    await service.listerReclamations(USER, {});

    expect(prisma.adherent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ souscripteurId: 'sous-1' }) }),
    );
    expect(prisma.reclamation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: 'org-1',
          adherentId: { in: ['adh-1', 'adh-2'] },
        }),
      }),
    );
  });

  it('SOCIETE_ASSUREE lit la réclamation d’un de SES adhérents par id', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ASSUREE'], 'org-1', null, 'sous-1'),
    );
    prisma.adherent.findMany.mockResolvedValue([{ id: 'adh-1' }]);
    prisma.reclamation.findFirst.mockResolvedValue({ id: 'rec-1', adherentId: 'adh-1' });

    const res = await service.obtenirReclamation(USER, 'rec-1');

    expect(res).toBeDefined();
    expect(prisma.reclamation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rec-1', adherentId: { in: ['adh-1'] } }),
      }),
    );
  });

  it('SOCIETE_ASSUREE ne peut PAS lire la réclamation d’un adhérent d’une AUTRE société (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ASSUREE'], 'org-1', null, 'sous-1'),
    );
    // ses propres adhérents ne comprennent pas celui de la réclamation visée
    prisma.adherent.findMany.mockResolvedValue([{ id: 'adh-1' }]);
    prisma.reclamation.findFirst.mockResolvedValue(null);

    await expect(
      service.obtenirReclamation(USER, 'rec-autre-societe'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SOCIETE_COMPTABLE ne peut PAS lire une réclamation par id → 403 (rôle non habilité, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_COMPTABLE'], 'org-1', null, 'sous-1'),
    );
    await expect(
      service.obtenirReclamation(USER, 'rec-autre-societe'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reclamation.findFirst).not.toHaveBeenCalled();
  });
});
