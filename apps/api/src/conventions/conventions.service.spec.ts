import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { LettresClesService } from '../reference/lettres-cles.service';
import { lettresClesServiceDeTest } from '../reference/lettres-cles.testing';
import { ConventionsService } from './conventions.service';

/** Données FICTIVES : numéros, valeurs et codes d'acte inventés pour les tests, jamais la vraie nomenclature. */
const USER = { sub: 'u-appelant' } as AuthenticatedUser;
const ORG = 'org-1';
const ETAB = 'etab-1';
const SAISISSANT = 'u-saisie';
const VALIDATEUR = 'u-valide';

const identite = (id: string, roles: string[]) => ({
  profil: { id, organisationId: ORG },
  permissions: { roleChain: roles },
});

function convention(surcharge: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    organisationId: ORG,
    etablissementId: ETAB,
    numero: 'FICTIF-CONV-1',
    version: 1,
    conventionPrecedenteId: null,
    dateDebut: new Date('2026-01-01'),
    dateFin: null,
    statut: 'PROPOSEE',
    politiqueDepassement: 'PATIENT',
    documentChemin: `${ORG}/${ETAB}/c-1-123.pdf`,
    documentNom: 'convention-signee.pdf',
    documentType: 'application/pdf',
    historique: false,
    saisiPar: SAISISSANT,
    modifiePar: SAISISSANT,
    validePar: null,
    refusePar: null,
    motifRefus: null,
    dateSaisie: new Date(),
    dateValidation: null,
    dateRefus: null,
    etablissement: { id: ETAB, nom: 'Clinique fictive', code: 'ETA-F', statut: 'ACTIF' },
    precedente: null,
    suivantes: [],
    valeurs: [{ id: 'v-1', lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: { toFixed: () => '100.00' } }],
    actes: [],
    ...surcharge,
  };
}

describe('ConventionsService (données fictives)', () => {
  let service: ConventionsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: ReturnType<typeof dependancesDeTest> & { tracerRefusMetier: jest.Mock };

  beforeEach(async () => {
    prisma = {
      convention: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'c-1', statut: 'PROPOSEE', ...data })),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
      },
      conventionValeur: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      conventionActe: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      etablissementSante: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      referentielActe: { findMany: jest.fn().mockResolvedValue([]) },
      tarifConventionne: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
      profil: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    dependances = Object.assign(dependancesDeTest(), { tracerRefusMetier: jest.fn().mockResolvedValue(undefined) });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConventionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
        { provide: LettresClesService, useValue: lettresClesServiceDeTest(['KE']) },
      ],
    }).compile();
    service = moduleRef.get(ConventionsService);
  });

  const informatique = (id = SAISISSANT) => identity.getMe.mockResolvedValue(identite(id, ['ASSUREUR_INFORMATIQUE']));
  const medecinConseil = (id = VALIDATEUR) => identity.getMe.mockResolvedValue(identite(id, ['ASSUREUR_MEDECIN_CONSEIL']));
  const audit = () => prisma.$executeRaw.mock.calls.map((c: any[]) => JSON.stringify(c)).join('');

  describe('création et modification', () => {
    const dto = { etablissementId: ETAB, numero: 'FICTIF-CONV-1', dateDebut: '2026-01-01' };

    it('création : saisie par l’assurance informatique, statut PROPOSEE, saisi_par = l’appelant, tracée dans l’audit', async () => {
      informatique();
      prisma.etablissementSante.findFirst.mockResolvedValue({ id: ETAB, nom: 'Clinique fictive', statut: 'ACTIF' });
      prisma.convention.create.mockResolvedValue({ id: 'c-1', numero: 'FICTIF-CONV-1', statut: 'PROPOSEE' });
      await service.creer(USER, dto);
      expect(prisma.convention.create.mock.calls[0][0].data).toMatchObject({ organisationId: ORG, etablissementId: ETAB, saisiPar: SAISISSANT, politiqueDepassement: 'PATIENT' });
      expect(audit()).toContain('CREATION_CONVENTION');
    });

    it.each([
      ['médecin conseil', ['ASSUREUR_MEDECIN_CONSEIL']],
      ['direction', ['ASSUREUR_DIRECTION']],
      ['comptable', ['ASSUREUR_COMPTABLE']],
      ['société', ['SOCIETE_ADMINISTRATION']],
    ])('création refusée (403) pour %s', async (_nom, roles) => {
      identity.getMe.mockResolvedValue(identite('u', roles));
      await expect(service.creer(USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.convention.create).not.toHaveBeenCalled();
    });

    it('établissement d’une autre organisation : 404 ; établissement archivé : 409 ; numéro déjà pris : 409 ; période incohérente : 400', async () => {
      informatique();
      prisma.etablissementSante.findFirst.mockResolvedValue(null);
      await expect(service.creer(USER, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.etablissementSante.findFirst.mock.calls[0][0].where).toMatchObject({ organisationId: ORG });
      prisma.etablissementSante.findFirst.mockResolvedValue({ id: ETAB, nom: 'Clinique fictive', statut: 'RESILIE' });
      await expect(service.creer(USER, dto)).rejects.toThrow(/archivé/);
      prisma.etablissementSante.findFirst.mockResolvedValue({ id: ETAB, nom: 'Clinique fictive', statut: 'ACTIF' });
      prisma.convention.count.mockResolvedValue(1);
      await expect(service.creer(USER, dto)).rejects.toThrow(/porte déjà le numéro/);
      prisma.convention.count.mockResolvedValue(0);
      await expect(service.creer(USER, { ...dto, dateFin: '2025-12-31' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('modification : passe par le registre (une convention validée ne se modifie plus), trace avant / après', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention());
      await service.modifier(USER, 'c-1', { politiqueDepassement: 'REJET', dateFin: '2026-12-31' });
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'convention', 'c-1', 'modifier');
      expect(audit()).toContain('MODIFICATION_CONVENTION');
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Une convention validée ne se modifie plus : créez une nouvelle version'));
      await expect(service.modifier(USER, 'c-1', { numero: 'X' })).rejects.toThrow(/nouvelle version/);
    });
  });

  describe('valeurs par lettre-clé et exceptions par acte', () => {
    beforeEach(() => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention({ valeurs: [] }));
    });

    it('valeurs : lettre inactive (KE) ou inconnue refusée, doublon refusé, valeur ≤ 0 refusée', async () => {
      await expect(service.remplacerValeurs(USER, 'c-1', { valeurs: [{ lettreCleCode: 'KE', contexte: 'AMBULATOIRE', valeur: 10 }] })).rejects.toThrow(/inconnue ou inactive/);
      await expect(service.remplacerValeurs(USER, 'c-1', { valeurs: [{ lettreCleCode: 'XX', contexte: 'AMBULATOIRE', valeur: 10 }] })).rejects.toThrow(/inconnue ou inactive/);
      await expect(
        service.remplacerValeurs(USER, 'c-1', {
          valeurs: [
            { lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: 10 },
            { lettreCleCode: 'b', contexte: 'AMBULATOIRE', valeur: 12 },
          ],
        }),
      ).rejects.toThrow(/en double/);
      await expect(service.remplacerValeurs(USER, 'c-1', { valeurs: [{ lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: 0 }] })).rejects.toThrow(/strictement positive/);
    });

    it('valeurs : ambulatoire et hospitalisation d’une même lettre sont deux lignes distinctes, enregistrées avec l’avant / après', async () => {
      const r = await service.remplacerValeurs(USER, 'c-1', {
        valeurs: [
          { lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: 100 },
          { lettreCleCode: 'B', contexte: 'HOSPITALISATION', valeur: 150 },
        ],
      });
      expect(r.nbValeurs).toBe(2);
      expect(prisma.conventionValeur.create).toHaveBeenCalledTimes(2);
      expect(prisma.conventionValeur.create.mock.calls[1][0].data).toMatchObject({ lettreCleCode: 'B', contexte: 'HOSPITALISATION', valeur: '150.00' });
      expect(audit()).toContain('MODIFICATION_VALEURS_CONVENTION');
    });

    it('actes : forfait OU valeur propre — jamais les deux, jamais aucun ; valeur propre exige un acte coté ; acte d’une autre organisation : 404', async () => {
      prisma.referentielActe.findMany.mockResolvedValue([
        { id: 'a-1', code: 'FICTIF-A1', lettreCleCode: 'B' },
        { id: 'a-2', code: 'FICTIF-A2', lettreCleCode: null },
      ]);
      await expect(service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'a-1', prixForfaitaire: 5000, valeurLettreCle: 130 }] })).rejects.toThrow(/jamais les deux ni aucun/);
      await expect(service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'a-1' }] })).rejects.toThrow(/jamais les deux ni aucun/);
      await expect(service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'a-2', valeurLettreCle: 130 }] })).rejects.toThrow(/acte soit coté/);
      await expect(service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'inconnu', prixForfaitaire: 100 }] })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.referentielActe.findMany.mock.calls[0][0].where).toMatchObject({ organisationId: ORG });
      await expect(service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'a-1', prixForfaitaire: 100 }, { referentielActeId: 'a-1', prixForfaitaire: 200 }] })).rejects.toThrow(/qu’une fois/);
      const ok = await service.remplacerActes(USER, 'c-1', { actes: [{ referentielActeId: 'a-1', valeurLettreCle: 130 }, { referentielActeId: 'a-2', prixForfaitaire: 4500 }] });
      expect(ok.nbActes).toBe(2);
      expect(prisma.conventionActe.create.mock.calls[0][0].data).toMatchObject({ prixForfaitaire: null, valeurLettreCle: '130.00' });
      expect(prisma.conventionActe.create.mock.calls[1][0].data).toMatchObject({ prixForfaitaire: '4500.00', valeurLettreCle: null });
    });

    it('une convention validée refuse la saisie des valeurs (409 du registre), rien n’est écrit', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Une convention validée ne se modifie plus'));
      await expect(service.remplacerValeurs(USER, 'c-1', { valeurs: [] })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.conventionValeur.create).not.toHaveBeenCalled();
    });
  });

  describe('validation — le circuit', () => {
    beforeEach(() => {
      prisma.convention.findFirst.mockResolvedValue(convention());
    });

    it('un validateur différent du saisissant valide : VALIDEE, validateur et date, tracée ; forfaits projetés sous le MÊME identifiant', async () => {
      medecinConseil();
      prisma.convention.findFirst
        .mockResolvedValueOnce(
          convention({ actes: [{ id: 'l-forfait', referentielActeId: 'a-1', prixForfaitaire: { toFixed: () => '5000.00' }, valeurLettreCle: null, dateDebut: null, dateFin: null, referentielActe: { code: 'FICTIF-A1' } }] }),
        )
        .mockResolvedValueOnce(null); // aucune autre convention validée en conflit
      prisma.convention.update.mockImplementation(async ({ data }: any) => ({ id: 'c-1', organisationId: ORG, etablissementId: ETAB, dateDebut: new Date('2026-01-01'), dateFin: null, statut: 'VALIDEE', ...data }));
      const r = await service.valider(USER, 'c-1');
      expect(r.statut).toBe('VALIDEE');
      expect(prisma.convention.update.mock.calls[0][0].data).toMatchObject({ statut: 'VALIDEE', validePar: VALIDATEUR });
      expect(prisma.tarifConventionne.create.mock.calls[0][0].data).toMatchObject({ id: 'l-forfait', etablissementId: ETAB, referentielActeId: 'a-1' });
      expect(audit()).toContain('VALIDATION_CONVENTION');
    });

    it('direction peut valider aussi', async () => {
      identity.getMe.mockResolvedValue(identite('u-dir', ['ASSUREUR_DIRECTION']));
      prisma.convention.findFirst.mockResolvedValueOnce(convention()).mockResolvedValueOnce(null);
      prisma.convention.update.mockResolvedValue({ id: 'c-1', statut: 'VALIDEE', organisationId: ORG, etablissementId: ETAB, dateDebut: new Date('2026-01-01'), dateFin: null });
      expect((await service.valider(USER, 'c-1')).statut).toBe('VALIDEE');
    });

    it('AUTO-VALIDATION refusée (403) : celui qui a saisi ne valide pas — même avec le rôle de validation ; refus tracé à part', async () => {
      medecinConseil(SAISISSANT);
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/Auto-validation interdite/);
      await expect(service.valider(USER, 'c-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.convention.update).not.toHaveBeenCalled();
      expect(dependances.tracerRefusMetier).toHaveBeenCalledWith(USER, 'conventions', 'c-1', 'validation', expect.stringContaining('Auto-validation'));
    });

    it('celui qui a MODIFIÉ la convention ne la valide pas non plus', async () => {
      prisma.convention.findFirst.mockResolvedValue(convention({ saisiPar: 'u-autre', modifiePar: 'u-modif' }));
      medecinConseil('u-modif');
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/Auto-validation interdite/);
    });

    it('l’assurance informatique ne valide pas (403) ; les rôles sans lien non plus', async () => {
      informatique('u-autre');
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/médecin conseil ou à la direction/);
      identity.getMe.mockResolvedValue(identite('u-c', ['ASSUREUR_COMPTABLE']));
      await expect(service.valider(USER, 'c-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('conditions : document signé obligatoire ; au moins une valeur ou exception ; statut proposée', async () => {
      medecinConseil();
      prisma.convention.findFirst.mockResolvedValue(convention({ documentChemin: null }));
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/document signé n’est pas joint/);
      prisma.convention.findFirst.mockResolvedValue(convention({ valeurs: [], actes: [] }));
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/aucune valeur de lettre-clé ni exception/);
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'VALIDEE' }));
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/seule une convention proposée se valide/);
      expect(prisma.convention.update).not.toHaveBeenCalled();
    });

    it('CHEVAUCHEMENT refusé : une autre convention validée couvre la période — message avec le numéro, refus tracé', async () => {
      medecinConseil();
      prisma.convention.findFirst
        .mockResolvedValueOnce(convention()) // charger
        .mockResolvedValueOnce({ id: 'c-0', numero: 'FICTIF-ANCIENNE', version: 2, dateDebut: new Date('2025-01-01'), dateFin: null }); // conflit
      await expect(service.valider(USER, 'c-1')).rejects.toThrow(/Chevauchement : la convention FICTIF-ANCIENNE \(version 2\)/);
      expect(prisma.convention.update).not.toHaveBeenCalled();
      expect(dependances.tracerRefusMetier).toHaveBeenCalledWith(USER, 'conventions', 'c-1', 'validation', expect.stringContaining('Chevauchement'));
    });

    it('chevauchement détecté par la base (course) : la contrainte EXCLUDE est convertie en 409 explicite', async () => {
      medecinConseil();
      prisma.convention.update.mockRejectedValue(new Error('conflicting key value violates exclusion constraint "conventions_validees_sans_chevauchement"'));
      await expect(service.valider(USER, 'c-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('nouvelle version : l’ancienne est fermée la veille du début, archivée, ses forfaits projetés fermés', async () => {
      medecinConseil();
      prisma.convention.findFirst
        .mockResolvedValueOnce(convention({ numero: 'FICTIF-CONV-1', version: 2, conventionPrecedenteId: 'c-0', dateDebut: new Date('2026-07-01') }))
        .mockResolvedValueOnce(null) // pas de conflit
        .mockResolvedValueOnce({ id: 'c-0', numero: 'FICTIF-CONV-1', statut: 'VALIDEE', dateDebut: new Date('2026-01-01'), dateFin: null }); // précédente
      prisma.conventionActe.findMany.mockResolvedValue([{ id: 'l-ancien' }]);
      prisma.convention.update.mockImplementation(async ({ data }: any) => ({ id: 'c-1', organisationId: ORG, etablissementId: ETAB, dateDebut: new Date('2026-07-01'), dateFin: null, statut: 'VALIDEE', ...data }));
      await service.valider(USER, 'c-1');
      const fermeture = prisma.convention.update.mock.calls[0][0];
      expect(fermeture.where).toEqual({ id: 'c-0' });
      expect(fermeture.data).toMatchObject({ statut: 'ARCHIVEE' });
      expect((fermeture.data.dateFin as Date).toISOString().slice(0, 10)).toBe('2026-06-30');
      const ferme = prisma.tarifConventionne.updateMany.mock.calls.find((c: any[]) => c[0].data.dateFin);
      expect((ferme![0].data.dateFin as Date).toISOString().slice(0, 10)).toBe('2026-06-30');
    });
  });

  describe('refus, reproposition, nouvelle version, archivage, suppression', () => {
    it('refus : motif obligatoire (5 caractères), validateur ≠ saisissant, REFUSEE avec le refuseur ; refus par le saisissant interdit', async () => {
      prisma.convention.findFirst.mockResolvedValue(convention());
      medecinConseil();
      await expect(service.refuserConvention(USER, 'c-1', 'non')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.refuserConvention(USER, 'c-1', '   ')).rejects.toBeInstanceOf(BadRequestException);
      const r = await service.refuserConvention(USER, 'c-1', 'Valeur de la lettre-clé B hors barème négocié');
      expect(r.statut).toBe('REFUSEE');
      expect(prisma.convention.update.mock.calls[0][0].data).toMatchObject({ statut: 'REFUSEE', refusePar: VALIDATEUR, motifRefus: 'Valeur de la lettre-clé B hors barème négocié' });
      expect(audit()).toContain('REFUS_CONVENTION');
      medecinConseil(SAISISSANT);
      await expect(service.refuserConvention(USER, 'c-1', 'Un motif suffisant')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reproposition : seule une convention refusée ; elle repasse PROPOSEE', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'REFUSEE', motifRefus: 'x' }));
      expect((await service.reproposer(USER, 'c-1')).statut).toBe('PROPOSEE');
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'VALIDEE' }));
      await expect(service.reproposer(USER, 'c-1')).rejects.toThrow(/seule une convention refusée se repropose/);
    });

    it('nouvelle version : copie valeurs et exceptions, version + 1, document NON copié, ancienne intacte ; refusée si pas validée ou si une version est déjà en cours', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'VALIDEE', valeurs: [{ id: 'v-1', lettreCleCode: 'B', contexte: 'AMBULATOIRE', valeur: '100.00' }], actes: [{ id: 'l-1', referentielActeId: 'a-1', prixForfaitaire: '5000.00', valeurLettreCle: null }] }));
      prisma.convention.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.convention.create.mockResolvedValue({ id: 'c-2', numero: 'FICTIF-CONV-1', version: 2, statut: 'PROPOSEE' });
      const r = await service.nouvelleVersion(USER, 'c-1', { dateDebut: '2026-07-01' });
      expect(r.version).toBe(2);
      const data = prisma.convention.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ numero: 'FICTIF-CONV-1', version: 2, conventionPrecedenteId: 'c-1', saisiPar: SAISISSANT });
      expect(data.documentChemin).toBeUndefined();
      expect(prisma.conventionValeur.create).toHaveBeenCalledTimes(1);
      expect(prisma.conventionActe.create).toHaveBeenCalledTimes(1);
      await expect(service.nouvelleVersion(USER, 'c-1', { dateDebut: '2025-01-01' })).rejects.toBeInstanceOf(BadRequestException);
      prisma.convention.count.mockResolvedValue(1);
      await expect(service.nouvelleVersion(USER, 'c-1', { dateDebut: '2026-07-01' })).rejects.toThrow(/déjà en cours/);
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'PROPOSEE' }));
      await expect(service.nouvelleVersion(USER, 'c-1', { dateDebut: '2026-07-01' })).rejects.toThrow(/seule une convention validée en a une/);
    });

    it('archivage : convention validée seulement ; date de fin ; forfaits projetés fermés', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention({ statut: 'VALIDEE' }));
      prisma.conventionActe.findMany.mockResolvedValue([{ id: 'l-1' }]);
      const r = await service.archiver(USER, 'c-1', { dateFin: '2026-12-31' });
      expect(r).toMatchObject({ statut: 'ARCHIVEE', dateFin: '2026-12-31' });
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'convention', 'c-1', 'archiver');
      await expect(service.archiver(USER, 'c-1', { dateFin: '2025-12-31' })).rejects.toBeInstanceOf(BadRequestException);
      expect(audit()).toContain('ARCHIVAGE_CONVENTION');
    });

    it('suppression : logique, valeurs et lignes retirées avec elle, par le registre (seulement proposée ou refusée)', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention({ documentChemin: null }));
      await service.supprimer(USER, 'c-1');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'convention', 'c-1', 'supprimer');
      expect(prisma.conventionValeur.updateMany).toHaveBeenCalled();
      expect(prisma.convention.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Une convention validée ou archivée est conservée'));
      await expect(service.supprimer(USER, 'c-1')).rejects.toThrow(/conservée/);
    });
  });

  describe('document, lecture, isolation', () => {
    it('document : formats PDF / JPEG / PNG, 10 Mo au plus ; rien n’est écrit si refusé', async () => {
      informatique();
      prisma.convention.findFirst.mockResolvedValue(convention());
      const fichier = (mimetype: string, size: number) => ({ buffer: Buffer.from('x'), originalname: 'doc', mimetype, size });
      await expect(service.joindreDocument(USER, 'c-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.joindreDocument(USER, 'c-1', fichier('application/zip', 10))).rejects.toThrow(/Format refusé/);
      await expect(service.joindreDocument(USER, 'c-1', fichier('application/pdf', 11 * 1024 * 1024))).rejects.toThrow(/10 Mo/);
      expect(prisma.convention.update).not.toHaveBeenCalled();
    });

    it('URL signée : 404 sans document ; la convention est cherchée DANS l’organisation de l’appelant', async () => {
      medecinConseil();
      prisma.convention.findFirst.mockResolvedValue(convention({ documentChemin: null }));
      await expect(service.urlDocument(USER, 'c-1')).rejects.toBeInstanceOf(NotFoundException);
      prisma.convention.findFirst.mockResolvedValue(null);
      await expect(service.urlDocument(USER, 'c-autre-org')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.convention.findFirst.mock.calls.at(-1)![0].where).toMatchObject({ organisationId: ORG, id: 'c-autre-org' });
    });

    it('lecture : réservée aux trois rôles ; toute requête filtrée par organisation', async () => {
      identity.getMe.mockResolvedValue(identite('u', ['SOCIETE_ADMINISTRATION']));
      await expect(service.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.indicateurs(USER)).rejects.toBeInstanceOf(ForbiddenException);
      medecinConseil();
      await service.lister(USER, { statut: 'PROPOSEE' });
      expect(prisma.convention.findMany.mock.calls[0][0].where).toMatchObject({ organisationId: ORG, statut: 'PROPOSEE' });
    });

    it('indicateur : établissements actifs sans convention validée en vigueur aujourd’hui', async () => {
      informatique();
      prisma.etablissementSante.findMany.mockResolvedValue([
        { id: 'e1', nom: 'Avec convention', code: 'A' },
        { id: 'e2', nom: 'Sans convention', code: 'B' },
        { id: 'e3', nom: 'Convention expirée', code: 'C' },
      ]);
      prisma.convention.findMany.mockResolvedValue([{ etablissementId: 'e1' }]);
      prisma.convention.count.mockResolvedValue(2);
      const r = await service.indicateurs(USER);
      expect(r).toMatchObject({ etablissementsActifs: 3, sansConventionValidee: 2, conventionsAValider: 2 });
      expect(r.etablissementsSansConvention.map((e: any) => e.id)).toEqual(['e2', 'e3']);
      expect(prisma.convention.findMany.mock.calls[0][0].where).toMatchObject({ organisationId: ORG, statut: { in: ['VALIDEE', 'ARCHIVEE'] } });
    });
  });
});
