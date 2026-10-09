import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { LettresClesService } from '../reference/lettres-cles.service';
import { ConventionsService } from './conventions.service';

const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });

/** « Ajouter à la convention » après validation d'un tarif proposé (ADR-008, lot 5) — jamais sur une convention VALIDEE. */
describe('ConventionsService.ajouterExceptionDepuisTarifPropose', () => {
  let service: ConventionsService;
  let tx: any;

  const base = {
    id: 'conv-1', numero: 'FICT-1', version: 1, etablissementId: 'etab-1', statut: 'VALIDEE', politiqueDepassement: 'PATIENT',
    dateDebut: new Date('2026-01-01T00:00:00Z'),
    valeurs: [{ lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: dec(1000) }],
    actes: [{ referentielActeId: 'ref-autre', prixForfaitaire: dec(3000), valeurLettreCle: null, dateDebut: null, dateFin: null }],
  };
  const p = (extra: Record<string, unknown> = {}) => ({
    userId: 'mc-1', organisationId: 'org-1', etablissementId: 'etab-1', referentielActeId: 'ref-1',
    type: 'FORFAIT' as const, montantUnitaire: new Decimal(4500), ...extra,
  });

  beforeEach(async () => {
    tx = {
      convention: {
        findFirst: jest.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
        create: jest.fn().mockResolvedValue({ id: 'conv-2', numero: 'FICT-1', version: 2, statut: 'PROPOSEE' }),
      },
      referentielActe: { findFirst: jest.fn().mockResolvedValue({ id: 'ref-1', code: 'FICT-N', lettreCleCode: 'B', coefficient: dec(2.5) }) },
      conventionValeur: { create: jest.fn() },
      conventionActe: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const module = await Test.createTestingModule({
      providers: [
        ConventionsService,
        { provide: PrismaService, useValue: {} },
        { provide: IdentityService, useValue: {} },
        { provide: DependancesService, useValue: {} },
        { provide: LettresClesService, useValue: {} },
      ],
    }).compile();
    service = module.get(ConventionsService);
  });

  it('crée une NOUVELLE version PROPOSEE (copie de la validée) et y ajoute le forfait — la convention validée n’est pas touchée', async () => {
    const r = await service.ajouterExceptionDepuisTarifPropose(tx, p());
    expect(r).toMatchObject({ conventionId: 'conv-2', version: 2, versionCreee: true });
    const c = tx.convention.create.mock.calls[0][0].data;
    expect(c).toMatchObject({ numero: 'FICT-1', version: 2, conventionPrecedenteId: 'conv-1', saisiPar: 'mc-1', dateFin: null });
    expect(tx.conventionValeur.create).toHaveBeenCalledTimes(1);
    // copie des exceptions existantes + la nouvelle
    expect(tx.conventionActe.create).toHaveBeenCalledTimes(2);
    expect(tx.conventionActe.create.mock.calls[1][0].data).toMatchObject({ conventionId: 'conv-2', referentielActeId: 'ref-1', prixForfaitaire: '4500.00', valeurLettreCle: null });
    expect(tx.convention.findFirst.mock.calls[0][0].where).toMatchObject({ organisationId: 'org-1', statut: 'VALIDEE', etablissementId: 'etab-1' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // log_audit dans la transaction
  });

  it('valeur de lettre-clé PROPRE : unitaire 3 500 / coefficient 2,5 = 1 400', async () => {
    await service.ajouterExceptionDepuisTarifPropose(tx, p({ type: 'VALEUR_LETTRE_CLE', montantUnitaire: new Decimal(3500) }));
    expect(tx.conventionActe.create.mock.calls[1][0].data).toMatchObject({ prixForfaitaire: null, valeurLettreCle: '1400.00' });
  });

  it('acte non coté : une valeur de lettre-clé est impossible (409), rien n’est créé', async () => {
    tx.referentielActe.findFirst.mockResolvedValue({ id: 'ref-1', code: 'FICT-N', lettreCleCode: null, coefficient: null });
    await expect(service.ajouterExceptionDepuisTarifPropose(tx, p({ type: 'VALEUR_LETTRE_CLE' }))).rejects.toThrow(/pas coté/);
    expect(tx.convention.create).not.toHaveBeenCalled();
  });

  it('une version PROPOSEE déjà en cours reçoit la ligne (pas de seconde version)', async () => {
    tx.convention.findFirst = jest.fn().mockResolvedValueOnce(base).mockResolvedValueOnce({ id: 'conv-3', numero: 'FICT-1', version: 2, statut: 'PROPOSEE', actes: [] });
    const r = await service.ajouterExceptionDepuisTarifPropose(tx, p());
    expect(r).toMatchObject({ conventionId: 'conv-3', versionCreee: false });
    expect(tx.convention.create).not.toHaveBeenCalled();
    expect(tx.conventionActe.create).toHaveBeenCalledTimes(1);
  });

  it('une version REFUSEE en cours bloque l’ajout (409)', async () => {
    tx.convention.findFirst = jest.fn().mockResolvedValueOnce(base).mockResolvedValueOnce({ id: 'conv-3', numero: 'FICT-1', version: 2, statut: 'REFUSEE', actes: [] });
    await expect(service.ajouterExceptionDepuisTarifPropose(tx, p())).rejects.toBeInstanceOf(ConflictException);
  });

  it('aucune convention validée en vigueur : 409', async () => {
    tx.convention.findFirst = jest.fn().mockResolvedValue(null);
    await expect(service.ajouterExceptionDepuisTarifPropose(tx, p())).rejects.toThrow(/Aucune convention validée/);
  });

  it('l’acte a déjà une exception dans la version en cours : 409', async () => {
    tx.convention.findFirst = jest.fn().mockResolvedValueOnce(base).mockResolvedValueOnce({ id: 'conv-3', numero: 'FICT-1', version: 2, statut: 'PROPOSEE', actes: [{ referentielActeId: 'ref-1' }] });
    await expect(service.ajouterExceptionDepuisTarifPropose(tx, p())).rejects.toThrow(/déjà une exception/);
  });
});
