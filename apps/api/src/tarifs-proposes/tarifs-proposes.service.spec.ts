import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdjudicationClientService } from '../adjudication-client/adjudication-client.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { colonnesTrace, TarifsProposesService } from './tarifs-proposes.service';

const USER = { sub: 'u1', token: 'jwt' } as unknown as AuthenticatedUser;
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

function profil(role: string, extra: Record<string, unknown> = {}) {
  return {
    profil: { id: 'u1', organisationId: 'org-1', etablissementId: 'etab-1', role, ...extra },
    permissions: { roleChain: [role] },
  };
}

const NON_TARIFABLE = {
  decision: 'REVUE_MANUELLE',
  montant_couvert: 0,
  plafond_restant_apres: null,
  codes_rejet: ['E016'],
  trace_tarif: { statut_tarif: 'NON_TARIFABLE', message: 'Aucune valeur négociée pour la lettre-clé Z.' },
};

describe('TarifsProposesService (ADR-008, lot 4)', () => {
  let service: TarifsProposesService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: { tracerRefusMetier: jest.Mock };
  let adjudication: { simuler: jest.Mock };

  const acteBase = { id: 'acte-1', statut: 'REALISE', libelle: 'Acte fictif', quantite: 2 };

  beforeEach(async () => {
    prisma = {
      acteDossier: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      tarifPropose: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
      ligneFacturation: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      garantie: { findFirst: jest.fn().mockResolvedValue({ id: 'g-1' }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (f: (tx: unknown) => unknown) => f(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(profil('CENTRE_MEDICAL_COMPTABLE')) };
    dependances = { tracerRefusMetier: jest.fn().mockResolvedValue(undefined) };
    adjudication = { simuler: jest.fn().mockResolvedValue({ lignes: [NON_TARIFABLE] }) };
    const module = await Test.createTestingModule({
      providers: [
        TarifsProposesService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
        { provide: AdjudicationClientService, useValue: adjudication },
      ],
    }).compile();
    service = module.get(TarifsProposesService);
  });

  const dto = { acteDossierId: 'acte-1', montantPropose: 4500, justification: 'Acte hors nomenclature, devis joint.' };

  /** Acte de l'établissement + simulation (le même findFirst sert au contrôle d'appartenance et au calcul). */
  function acteDeLEtablissement() {
    prisma.acteDossier.findFirst.mockImplementation(async (a: any) =>
      a.include
        ? {
            ...acteBase,
            categorieActe: 'CONSULTATION',
            codeActe: 'FICT-1',
            montantPrescrit: dec(5000),
            dateRealisation: new Date('2026-06-15T00:00:00Z'),
            datePrescription: new Date('2026-06-14T00:00:00Z'),
            dossier: { policeId: 'pol-1', adherentId: 'adh-1', beneficiaireId: null, etablissementId: 'etab-1', typeVisite: null, police: { produitId: 'prod-1' } },
          }
        : acteBase,
    );
  }

  it('rôle non habilité (médecin, exploitation…) : 403, aucune écriture', async () => {
    identity.getMe.mockResolvedValue(profil('CENTRE_MEDICAL_MEDECIN'));
    await expect(service.proposer(USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tarifPropose.create).not.toHaveBeenCalled();
  });

  it.each(['CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF'])('%s peut proposer : création + audit dans la transaction', async (role) => {
    identity.getMe.mockResolvedValue(profil(role));
    acteDeLEtablissement();
    prisma.tarifPropose.create.mockResolvedValue({
      id: 'tp-1', etablissementId: 'etab-1', acteDossierId: 'acte-1', ligneFacturationId: null, montantPropose: dec(4500),
      justification: dto.justification, statut: 'PROPOSE', proposePar: 'u1', dateProposition: new Date(), decidePar: null,
      dateDecision: null, montantDecide: null, motifDecision: null,
    });
    const r = await service.proposer(USER, dto);
    expect(r).toMatchObject({ id: 'tp-1', statut: 'PROPOSE', montantPropose: '4500.00' });
    expect(prisma.tarifPropose.create.mock.calls[0][0].data).toMatchObject({
      organisationId: 'org-1', etablissementId: 'etab-1', acteDossierId: 'acte-1', proposePar: 'u1',
    });
    // quantité 2 transmise au microservice : la simulation porte sur la ligne entière
    expect(adjudication.simuler.mock.calls[0][0].lignes[0]).toMatchObject({ acte_dossier_id: 'acte-1', quantite: 2, montant: '10000.00' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // log_audit dans la transaction
  });

  it('acte d’un autre établissement ou d’une autre organisation : 404 (aucune fuite)', async () => {
    prisma.acteDossier.findFirst.mockResolvedValue(null);
    await expect(service.proposer(USER, dto)).rejects.toBeInstanceOf(NotFoundException);
    const filtre = prisma.acteDossier.findFirst.mock.calls[0][0].where;
    expect(filtre.dossier).toEqual({ organisationId: 'org-1', etablissementId: 'etab-1' });
  });

  it('acte non réalisé : 409 tracé à part', async () => {
    prisma.acteDossier.findFirst.mockResolvedValue({ ...acteBase, statut: 'PRESCRIT' });
    await expect(service.proposer(USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(dependances.tracerRefusMetier).toHaveBeenCalledWith(USER, 'tarifs_proposes', 'acte-1', 'PROPOSITION_TARIF', expect.stringContaining('réalisé'));
  });

  it('une proposition vivante existe déjà : 409', async () => {
    acteDeLEtablissement();
    prisma.tarifPropose.findFirst.mockResolvedValue({ statut: 'PROPOSE' });
    await expect(service.proposer(USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tarifPropose.create).not.toHaveBeenCalled();
  });

  it('acte déjà réglé : 409', async () => {
    acteDeLEtablissement();
    prisma.ligneFacturation.count.mockResolvedValue(1);
    await expect(service.proposer(USER, dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('acte TARIFABLE par la convention : 409, la proposition ne contourne jamais un tarif négocié', async () => {
    acteDeLEtablissement();
    adjudication.simuler.mockResolvedValue({ lignes: [{ ...NON_TARIFABLE, trace_tarif: { statut_tarif: 'TARIFABLE', regle_origine: 'FORFAIT' } }] });
    await expect(service.proposer(USER, dto)).rejects.toThrow(/tarifable/);
    expect(prisma.tarifPropose.create).not.toHaveBeenCalled();
  });

  it('sans convention validée : 409 (le prix affiché est reconnu)', async () => {
    acteDeLEtablissement();
    adjudication.simuler.mockResolvedValue({ lignes: [{ ...NON_TARIFABLE, trace_tarif: { statut_tarif: 'TARIFABLE', regle_origine: 'AUCUNE_CONVENTION' } }] });
    await expect(service.proposer(USER, dto)).rejects.toThrow(/aucune convention|Aucune convention|aucun tarif/i);
  });

  it('catégorie non couverte : 409', async () => {
    acteDeLEtablissement();
    prisma.garantie.findFirst.mockResolvedValue(null);
    await expect(service.proposer(USER, dto)).rejects.toThrow(/couverte/);
  });

  describe('lecture', () => {
    it('l’établissement ne voit que les siennes ; l’assureur toute son organisation ; un autre rôle est refusé', async () => {
      await service.lister(USER);
      expect(prisma.tarifPropose.findMany.mock.calls[0][0].where).toMatchObject({ organisationId: 'org-1', etablissementId: 'etab-1' });
      identity.getMe.mockResolvedValue(profil('ASSUREUR_MEDECIN_CONSEIL', { etablissementId: null }));
      await service.lister(USER);
      expect(prisma.tarifPropose.findMany.mock.calls[1][0].where.etablissementId).toBeUndefined();
      identity.getMe.mockResolvedValue(profil('ASSUREUR_EXPLOITATION', { etablissementId: null }));
      await expect(service.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('synchroniserLignes — réintégration après décision', () => {
    const ligne = { id: 'l-1', acteDossierId: 'acte-1', tarifProposeId: 'tp-1' };
    const resultat = (provisoire = false) => ({
      decision: 'AUTO_ADJUDIQUE', montant_couvert: 1440, plafond_restant_apres: null, codes_rejet: [],
      trace_tarif: { statut_tarif: 'TARIFABLE', regle_origine: 'TARIF_PROPOSE', provisoire, tarif_propose_id: 'tp-1', tarif_reconnu: 3800, prix_affiche: 5000, ecart: 1200, quantite: 1, convention_id: 'conv-1' },
    });

    it('PROPOSE : la ligne reste provisoire et exclue', async () => {
      prisma.ligneFacturation.findMany.mockResolvedValue([ligne]);
      prisma.tarifPropose.findFirst.mockResolvedValue({ statut: 'PROPOSE' });
      expect(await service.synchroniserLignes('org-1', 'etab-1', 'u1')).toBe(0);
      expect(prisma.ligneFacturation.update).not.toHaveBeenCalled();
    });

    it('AJUSTE : nouveau calcul avec le montant retenu, ligne réintégrée (non reportée), trace remplacée, audit', async () => {
      prisma.ligneFacturation.findMany.mockResolvedValue([ligne]);
      prisma.tarifPropose.findFirst.mockResolvedValue({ statut: 'AJUSTE' });
      acteDeLEtablissement();
      adjudication.simuler.mockResolvedValue({ lignes: [resultat()] });
      expect(await service.synchroniserLignes('org-1', 'etab-1', 'u1')).toBe(1);
      const data = prisma.ligneFacturation.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ montantReclame: '1440.00', reporteeMoisSuivant: false, tarifProvisoire: false, tarifRegleOrigine: 'TARIF_PROPOSE' });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('REFUSE : le calcul provisoire cesse de peser sur les plafonds, la ligne reste exclue', async () => {
      prisma.ligneFacturation.findMany.mockResolvedValue([ligne]);
      prisma.tarifPropose.findFirst.mockResolvedValue({ statut: 'REFUSE' });
      expect(await service.synchroniserLignes('org-1', 'etab-1', 'u1')).toBe(1);
      expect(prisma.ligneFacturation.update).toHaveBeenCalledWith({ where: { id: 'l-1' }, data: { tarifProvisoire: false } });
    });

    it('le calcul repasse encore provisoire (décision non visible) : rien n’est modifié', async () => {
      prisma.ligneFacturation.findMany.mockResolvedValue([ligne]);
      prisma.tarifPropose.findFirst.mockResolvedValue({ statut: 'VALIDE' });
      acteDeLEtablissement();
      adjudication.simuler.mockResolvedValue({ lignes: [resultat(true)] });
      expect(await service.synchroniserLignes('org-1', 'etab-1', 'u1')).toBe(0);
      expect(prisma.ligneFacturation.update).not.toHaveBeenCalled();
    });
  });

  describe('colonnesTrace', () => {
    it('sans trace : aucune colonne inventée', () => {
      expect(colonnesTrace(null)).toEqual({});
    });
    it('trace de tarif proposé provisoire', () => {
      const c = colonnesTrace({
        statut_tarif: 'TARIFABLE', regle_origine: 'TARIF_PROPOSE', lettre_cle: null, coefficient: null, valeur_appliquee: null,
        convention_id: 'conv-1', politique_depassement: 'PATIENT', prix_affiche: 5000, tarif_reconnu: 4500, ecart: 500, message: null,
        tarif_unitaire: 4500, quantite: 1, provisoire: true, tarif_propose_id: 'tp-1',
      });
      expect(c).toMatchObject({ tarifRegleOrigine: 'TARIF_PROPOSE', tarifProvisoire: true, tarifProposeId: 'tp-1', tarifQuantite: 1 });
      expect(String(c.tarifReconnu)).toBe('4500');
    });
  });

  it('actesEnExamen : part estimée INDICATIVE avec la mention « tarif en cours d’examen »', async () => {
    const db: any = {
      ligneFacturation: {
        findMany: jest.fn().mockResolvedValue([
          { acteDossierId: 'acte-1', tarifReconnu: dec(4500), montantReclame: dec(2000), acteDossier: { libelle: 'Acte fictif', montantPrescrit: dec(5000), quantite: 1 } },
        ]),
      },
    };
    const r = await service.actesEnExamen(db, 'fact-1');
    expect(r).toEqual([
      { acteId: 'acte-1', libelle: 'Acte fictif', tarifPropose: '4500.00', partEstimeeAssurance: '2000.00', partEstimeePatient: '3000.00', mention: 'tarif en cours d’examen', indicatif: true },
    ]);
  });
});
