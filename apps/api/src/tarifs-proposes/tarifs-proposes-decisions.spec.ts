import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdjudicationClientService } from '../adjudication-client/adjudication-client.service';
import { verrouillerPlafond } from '../adjudication-client/verrou-plafond';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ConventionsService } from '../conventions/conventions.service';
import { DependancesService } from '../dependances/dependances.service';
import { EmailService } from '../email/email.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { TarifsProposesService } from './tarifs-proposes.service';

jest.mock('../adjudication-client/verrou-plafond', () => ({ verrouillerPlafond: jest.fn(async () => undefined) }));

const USER = { sub: 'mc-1', token: 'jwt' } as unknown as AuthenticatedUser;
const dec = (n: number) => ({ toFixed: (d = 2) => n.toFixed(d), toString: () => String(n) });
const profil = (role: string, id = 'mc-1') => ({
  profil: { id, organisationId: 'org-1', etablissementId: null, role },
  permissions: { roleChain: [role] },
});

/** Décisions du médecin conseil, file, alertes, rappels (ADR-008, lot 5) — chiffres fictifs. */
describe('TarifsProposesService — file et décisions (lot 5)', () => {
  let service: TarifsProposesService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: { tracerRefusMetier: jest.Mock };
  let adjudication: { simuler: jest.Mock; etatPlafonds: jest.Mock };
  let email: { envoyerEmail: jest.Mock };
  let conventions: { ajouterExceptionDepuisTarifPropose: jest.Mock };

  const tpBase = {
    id: 'tp-1', organisationId: 'org-1', etablissementId: 'etab-1', acteDossierId: 'acte-1', ligneFacturationId: null,
    montantPropose: dec(4500), justification: 'Acte hors nomenclature, devis joint.', statut: 'PROPOSE', proposePar: 'cpt-1',
    dateProposition: new Date('2026-10-01T00:00:00Z'), decidePar: null, dateDecision: null, montantDecide: null, motifDecision: null,
    categorieActe: 'CONSULTATION', alerteRenforcee: false, alerteRecurrence: false, alerteDetails: null, ajoutConventionId: null,
    etablissementPrevenuLe: null,
  };
  const acte = {
    id: 'acte-1', libelle: 'Acte fictif', categorieActe: 'CONSULTATION', quantite: 1, montantPrescrit: dec(5000), dossierSoinsId: 'dos-1',
    referentielActeId: 'ref-1', codeActe: 'FICT-N', dateRealisation: new Date('2026-09-10T00:00:00Z'), datePrescription: new Date('2026-09-09T00:00:00Z'),
    dossier: { policeId: 'pol-1', adherentId: 'adh-1', beneficiaireId: null, etablissementId: 'etab-1', typeVisite: null, police: { produitId: 'prod-1' } },
  };
  const ligne = { id: 'l-1', montantReclame: dec(3600), factureDossier: { ticketSoinsId: 'tick-1' } };
  const calcul = (couvert: number, provisoire = false) => ({
    decision: 'AUTO_ADJUDIQUE', montant_couvert: couvert, plafond_restant_apres: null, codes_rejet: [],
    trace_tarif: { statut_tarif: 'TARIFABLE', regle_origine: 'TARIF_PROPOSE', provisoire, tarif_propose_id: 'tp-1', tarif_reconnu: 3800, prix_affiche: 5000, ecart: 1200, quantite: 1, convention_id: 'conv-1' },
  });

  beforeEach(async () => {
    (verrouillerPlafond as jest.Mock).mockClear();
    prisma = {
      tarifPropose: {
        findFirst: jest.fn().mockResolvedValue(tpBase),
        findUnique: jest.fn().mockResolvedValue({ organisationId: 'org-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...tpBase, statut: 'VALIDE' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ ...tpBase, statut: 'VALIDE' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      acteDossier: { findFirst: jest.fn().mockResolvedValue(acte), findMany: jest.fn().mockResolvedValue([acte]) },
      etablissementSante: { findMany: jest.fn().mockResolvedValue([{ id: 'etab-1', nom: 'Clinique fictive' }]) },
      ligneFacturation: { findFirst: jest.fn().mockResolvedValue(ligne), update: jest.fn() },
      factureDossier: { create: jest.fn().mockResolvedValue({ id: 'fact-c' }), findUnique: jest.fn().mockResolvedValue(null) },
      ticketSoins: { findFirst: jest.fn().mockResolvedValue({ id: 'tick-1' }) },
      garantie: { findFirst: jest.fn().mockResolvedValue({ id: 'g-1' }) },
      beneficiaire: { findUnique: jest.fn() },
      profil: { findMany: jest.fn().mockResolvedValue([]) },
      parametrePlateforme: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ mediane: null, n: 0 }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (f: (tx: unknown) => unknown) => f(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(profil('ASSUREUR_MEDECIN_CONSEIL')) };
    dependances = { tracerRefusMetier: jest.fn().mockResolvedValue(undefined) };
    adjudication = { simuler: jest.fn().mockResolvedValue({ lignes: [calcul(3600)] }), etatPlafonds: jest.fn().mockResolvedValue({ garanties: [] }) };
    email = { envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) };
    conventions = { ajouterExceptionDepuisTarifPropose: jest.fn().mockResolvedValue({ conventionId: 'conv-2', numero: 'C', version: 2, versionCreee: true }) };
    const module = await Test.createTestingModule({
      providers: [
        TarifsProposesService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
        { provide: AdjudicationClientService, useValue: adjudication },
        { provide: EmailService, useValue: email },
        { provide: ConventionsService, useValue: conventions },
      ],
    }).compile();
    service = module.get(TarifsProposesService);
  });

  describe('droits', () => {
    it.each(['CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF', 'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION'])(
      '%s ne décide pas (403), aucune écriture',
      async (role) => {
        identity.getMe.mockResolvedValue(profil(role));
        await expect(service.decider(USER, 'tp-1', 'VALIDER', {})).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.tarifPropose.update).not.toHaveBeenCalled();
      },
    );

    it('le proposant ne décide JAMAIS sur sa propre proposition : 403 tracé à part', async () => {
      prisma.tarifPropose.findFirst.mockResolvedValue({ ...tpBase, proposePar: 'mc-1' });
      await expect(service.decider(USER, 'tp-1', 'VALIDER', {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(dependances.tracerRefusMetier).toHaveBeenCalledWith(USER, 'tarifs_proposes', 'tp-1', 'DECISION_TARIF_VALIDER', expect.stringContaining('saisie'));
      expect(prisma.tarifPropose.update).not.toHaveBeenCalled();
    });

    it('proposition d’une autre organisation : 404', async () => {
      prisma.tarifPropose.findFirst.mockResolvedValue(null);
      await expect(service.decider(USER, 'tp-x', 'VALIDER', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.tarifPropose.findFirst.mock.calls[0][0].where).toMatchObject({ organisationId: 'org-1' });
    });

    it('proposition déjà décidée : 409 tracé', async () => {
      prisma.tarifPropose.findFirst.mockResolvedValue({ ...tpBase, statut: 'REFUSE' });
      await expect(service.decider(USER, 'tp-1', 'VALIDER', {})).rejects.toBeInstanceOf(ConflictException);
      expect(dependances.tracerRefusMetier).toHaveBeenCalled();
    });

    it('ajuster : montant et motif obligatoires ; montant identique refusé ; refuser : motif obligatoire', async () => {
      await expect(service.decider(USER, 'tp-1', 'AJUSTER', { motif: 'Ajusté au tarif habituel' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.decider(USER, 'tp-1', 'AJUSTER', { montantDecide: 3800 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.decider(USER, 'tp-1', 'AJUSTER', { montantDecide: 4500, motif: 'Ajusté au tarif habituel' })).rejects.toThrow(/identique/);
      await expect(service.decider(USER, 'tp-1', 'REFUSER', {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.decider(USER, 'tp-1', 'REFUSER', { motif: 'non' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tarifPropose.update).not.toHaveBeenCalled();
    });

    it('l’ajout à la convention est refusé avec un refus', async () => {
      await expect(service.decider(USER, 'tp-1', 'REFUSER', { motif: 'Montant non justifié', ajouterConvention: { type: 'FORFAIT' } })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('décisions avec recalcul sous verrou', () => {
    it('VALIDER : verrou personne/famille, recalcul avec la décision IMPOSÉE, ligne réintégrée, facture complémentaire (5 000 − 3 600 = 1 400)', async () => {
      const r = await service.decider(USER, 'tp-1', 'VALIDER', {});
      expect(verrouillerPlafond).toHaveBeenCalledWith(prisma, { adherentId: 'adh-1', beneficiaireId: null, policeId: 'pol-1', produitId: 'prod-1' });
      // la décision n'est pas encore validée en base : elle est imposée au microservice
      expect(adjudication.simuler.mock.calls[0][0].lignes[0].tarif_propose).toEqual({ id: 'tp-1', statut: 'VALIDE', montant_propose: '4500.00', montant_decide: null });
      const majLigne = prisma.ligneFacturation.update.mock.calls[0][0].data;
      expect(majLigne).toMatchObject({ montantReclame: '3600.00', reporteeMoisSuivant: false, tarifProvisoire: false });
      const f = prisma.factureDossier.create.mock.calls[0][0].data;
      expect(f).toMatchObject({ montantPatient: '1400.00', montantTotal: '1400.00', montantAssurance: '0.00', ticketSoinsId: 'tick-1', tarifProposeId: 'tp-1', statut: 'EMISE' });
      expect(f.codeFacturation).toMatch(/^[A-Z0-9]{8}$/);
      expect(r.factureComplementaire).toEqual({ id: 'fact-c', montantPatient: '1400.00' });
      expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit dans la transaction
      expect(prisma.tarifPropose.update.mock.calls[0][0].data).toMatchObject({ statut: 'VALIDE', decidePar: 'mc-1' });
    });

    it('AJUSTER 3 800 : montant décidé imposé, nouvelle part assurance 1 440, part patient 5 000 − 1 440 = 3 560', async () => {
      adjudication.simuler.mockResolvedValue({ lignes: [calcul(1440)] });
      await service.decider(USER, 'tp-1', 'AJUSTER', { montantDecide: 3800, motif: 'Ajusté au tarif habituel' });
      expect(adjudication.simuler.mock.calls[0][0].lignes[0].tarif_propose).toEqual({ id: 'tp-1', statut: 'AJUSTE', montant_propose: '4500.00', montant_decide: '3800.00' });
      expect(prisma.factureDossier.create.mock.calls[0][0].data.montantPatient).toBe('3560.00');
      expect(prisma.tarifPropose.update.mock.calls[0][0].data).toMatchObject({ statut: 'AJUSTE', motifDecision: 'Ajusté au tarif habituel' });
    });

    it('REFUSER : la ligne cesse d’être provisoire (assurance 0), le patient doit TOUT le prix affiché (5 000), l’établissement est prévenu', async () => {
      prisma.profil.findMany.mockResolvedValue([{ id: 'cpt-1' }]);
      process.env.SUPABASE_URL ||= 'http://localhost';
      const r = await service.decider(USER, 'tp-1', 'REFUSER', { motif: 'Montant non justifié' });
      expect(adjudication.simuler).not.toHaveBeenCalled();
      expect(prisma.ligneFacturation.update).toHaveBeenCalledWith({ where: { id: 'l-1' }, data: { tarifProvisoire: false, montantReclame: '0.00' } });
      expect(prisma.factureDossier.create.mock.calls[0][0].data.montantPatient).toBe('5000.00');
      expect(r.factureComplementaire?.montantPatient).toBe('5000.00');
      expect(prisma.tarifPropose.update.mock.calls[0][0].data).toMatchObject({ statut: 'REFUSE', motifDecision: 'Montant non justifié', montantDecide: null });
    });

    it('sans ligne de facturation (acte pas encore facturé) : décision enregistrée, aucune facture complémentaire', async () => {
      prisma.ligneFacturation.findFirst.mockResolvedValue(null);
      const r = await service.decider(USER, 'tp-1', 'VALIDER', {});
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
      expect(r.factureComplementaire).toBeNull();
    });

    it('part patient nulle (assurance paie tout) : aucune facture complémentaire', async () => {
      adjudication.simuler.mockResolvedValue({ lignes: [calcul(5000)] });
      await service.decider(USER, 'tp-1', 'VALIDER', {});
      expect(prisma.factureDossier.create).not.toHaveBeenCalled();
    });

    it('recalcul encore provisoire (décision non appliquée) : 409, transaction annulée', async () => {
      adjudication.simuler.mockResolvedValue({ lignes: [calcul(3600, true)] });
      await expect(service.decider(USER, 'tp-1', 'VALIDER', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('option « ajouter à la convention » : exception FORFAIT créée dans la transaction (unitaire = retenu / quantité)', async () => {
      acte.quantite = 1;
      const r = await service.decider(USER, 'tp-1', 'VALIDER', { ajouterConvention: { type: 'FORFAIT' } });
      const arg = conventions.ajouterExceptionDepuisTarifPropose.mock.calls[0];
      expect(arg[0]).toBe(prisma);
      expect(arg[1]).toMatchObject({ userId: 'mc-1', etablissementId: 'etab-1', referentielActeId: 'ref-1', type: 'FORFAIT' });
      expect(String(arg[1].montantUnitaire)).toBe('4500');
      expect(r.ajoutConvention).toMatchObject({ conventionId: 'conv-2', versionCreee: true });
      expect(prisma.tarifPropose.update.mock.calls[1][0].data).toMatchObject({ ajoutConventionId: 'conv-2', ajoutConventionType: 'FORFAIT' });
    });

    it('acte non rattaché au référentiel : l’ajout à la convention est refusé AVANT toute écriture', async () => {
      prisma.acteDossier.findFirst.mockResolvedValue({ ...acte, referentielActeId: null });
      await expect(service.decider(USER, 'tp-1', 'VALIDER', { ajouterConvention: { type: 'FORFAIT' } })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.tarifPropose.update).not.toHaveBeenCalled();
    });
  });

  describe('alerte de plafond après décision', () => {
    const plafondAtteint = { garanties: [{ categorie_acte: 'CONSULTATION', restant_famille: 0, personnes: [{ adherent_id: 'adh-1', beneficiaire_id: null, restant: 0 }] }] };

    it('une décision qui LIBÈRE (refus) un plafond déjà atteint lève l’alerte (limite acceptée sur les lignes postérieures)', async () => {
      adjudication.etatPlafonds.mockResolvedValue(plafondAtteint);
      const r = await service.decider(USER, 'tp-1', 'REFUSER', { motif: 'Montant non justifié' });
      expect(r.alertePlafond?.message).toMatch(/libère 3600 F sur un plafond famille déjà atteint/);
      expect(prisma.tarifPropose.update).toHaveBeenCalledWith({ where: { id: 'tp-1' }, data: expect.objectContaining({ alertePlafond: true }) });
    });

    it('une décision qui AUGMENTE la consommation d’un plafond atteint lève aussi l’alerte', async () => {
      prisma.ligneFacturation.findFirst.mockResolvedValue({ ...ligne, montantReclame: dec(1000) });
      adjudication.etatPlafonds.mockResolvedValue(plafondAtteint);
      const r = await service.decider(USER, 'tp-1', 'VALIDER', {});
      expect(r.alertePlafond?.message).toMatch(/augmente 2600 F/);
    });

    it('pas d’alerte si le plafond n’est pas atteint, ni si le montant de la ligne ne change pas', async () => {
      adjudication.etatPlafonds.mockResolvedValue({ garanties: [{ categorie_acte: 'CONSULTATION', restant_famille: 5000, personnes: [] }] });
      expect((await service.decider(USER, 'tp-1', 'REFUSER', { motif: 'Montant non justifié' })).alertePlafond).toBeNull();
      adjudication.etatPlafonds.mockResolvedValue(plafondAtteint);
      prisma.ligneFacturation.findFirst.mockResolvedValue({ ...ligne, montantReclame: dec(3600) });
      adjudication.simuler.mockResolvedValue({ lignes: [calcul(3600)] });
      expect((await service.decider(USER, 'tp-1', 'VALIDER', {})).alertePlafond).toBeNull();
    });

    it('état des plafonds indisponible : décision enregistrée, alerte simplement omise', async () => {
      adjudication.etatPlafonds.mockRejectedValue(new Error('timeout'));
      const r = await service.decider(USER, 'tp-1', 'VALIDER', {});
      expect(r.alertePlafond).toBeNull();
      expect(r.statut).toBe('VALIDE');
    });
  });

  describe('file et compteur', () => {
    it('file : tri alerte renforcée puis ancienneté, statut PROPOSE par défaut, pagination serveur, filtres', async () => {
      prisma.tarifPropose.count.mockResolvedValue(42);
      prisma.tarifPropose.findMany.mockResolvedValue([{ ...tpBase, alerteRenforcee: true }]);
      const page = await service.file(USER, { page: 3, limite: 10, etablissementId: 'etab-1', categorie: 'CONSULTATION', ancienneteMin: 4 });
      const a = prisma.tarifPropose.findMany.mock.calls[0][0];
      expect(a.orderBy).toEqual([{ alerteRenforcee: 'desc' }, { dateProposition: 'asc' }, { id: 'asc' }]);
      expect(a).toMatchObject({ skip: 20, take: 10 });
      expect(a.where).toMatchObject({ organisationId: 'org-1', statut: 'PROPOSE', etablissementId: 'etab-1', categorieActe: 'CONSULTATION' });
      expect(a.where.dateProposition.lte).toBeInstanceOf(Date);
      expect(page).toMatchObject({ total: 42, page: 3, limite: 10, pages: 5 });
      expect(page.items[0]).toMatchObject({ etablissement: 'Clinique fictive', alerteRenforcee: true, peutDecider: true });
    });

    it.each(['CENTRE_MEDICAL_COMPTABLE', 'ASSUREUR_EXPLOITATION', 'SOCIETE_ADMINISTRATION'])('file et compteur refusés à %s (403)', async (role) => {
      identity.getMe.mockResolvedValue(profil(role));
      await expect(service.file(USER, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.compteur(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('la direction lit la file mais ne peut pas décider (peutDecider faux)', async () => {
      identity.getMe.mockResolvedValue(profil('ASSUREUR_DIRECTION', 'dir-1'));
      prisma.tarifPropose.findMany.mockResolvedValue([tpBase]);
      const page = await service.file(USER, {});
      expect(page.items[0].peutDecider).toBe(false);
    });

    it('compteur : à examiner, alertes renforcées, en retard (J+2)', async () => {
      prisma.tarifPropose.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
      expect(await service.compteur(USER)).toEqual({ aExaminer: 7, alertesRenforcees: 2, enRetard: 3 });
    });
  });

  describe('alertes de montant et de récurrence (paramètres de plateforme)', () => {
    const alerte = (montantUnitaire: number) => (service as any).alerteMontant('org-1', 'CONSULTATION', { toFixed: () => '', gt: (x: any) => montantUnitaire > Number(x), sub: (x: any) => ({ div: (y: any) => ({ mul: () => ({ toFixed: () => '0' }) }) }) });

    it('sans historique : alerte SYSTÉMATIQUE', async () => {
      const Decimal = (await import('decimal.js')).default;
      const r = await (service as any).alerteMontant('org-1', 'CONSULTATION', new Decimal(1000));
      expect(r).toMatchObject({ renforcee: true, details: { raison: 'SANS_HISTORIQUE', nbReference: 0 } });
    });

    it.each([
      // médiane 3 000, seuil 50 % → alerte au-delà de 4 500 (strictement)
      [4500, false],
      [4501, true],
      [2000, false],
    ])('médiane 3 000 : %s F par unité → alerte renforcée %s', async (unitaire, attendu) => {
      const Decimal = (await import('decimal.js')).default;
      prisma.$queryRaw.mockResolvedValue([{ mediane: dec(3000), n: 12 }]);
      const r = await (service as any).alerteMontant('org-1', 'CONSULTATION', new Decimal(unitaire));
      expect(r.renforcee).toBe(attendu);
      expect(r.details).toMatchObject({ nbReference: 12, mediane: '3000.00', seuilPourcent: 50 });
    });

    it('le seuil est un paramètre de plateforme : 20 % → 3 601 F déclenche', async () => {
      const Decimal = (await import('decimal.js')).default;
      prisma.parametrePlateforme.findUnique.mockResolvedValue({ valeur: 20 });
      prisma.$queryRaw.mockResolvedValue([{ mediane: dec(3000), n: 5 }]);
      expect((await (service as any).alerteMontant('org-1', 'CONSULTATION', new Decimal(3601))).renforcee).toBe(true);
      expect((await (service as any).alerteMontant('org-1', 'CONSULTATION', new Decimal(3600))).renforcee).toBe(false);
    });

    it('récurrence : 5 propositions sur 30 jours (la nouvelle comprise) → alerte ; 4 → non', async () => {
      prisma.tarifPropose.count.mockResolvedValue(4);
      expect(await (service as any).alerteRecurrence('org-1', 'etab-1')).toEqual({ recurrence: true, nombre: 5 });
      prisma.tarifPropose.count.mockResolvedValue(3);
      expect(await (service as any).alerteRecurrence('org-1', 'etab-1')).toEqual({ recurrence: false, nombre: 4 });
    });
    void alerte;
  });

  describe('rappels J+2 et escalade J+5 (tâche manuelle)', () => {
    it('rôle non habilité : 403', async () => {
      identity.getMe.mockResolvedValue(profil('CENTRE_MEDICAL_COMPTABLE'));
      await expect(service.envoyerRappels(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marque les rappels et escalades envoyés (une seule fois), audit dans la transaction', async () => {
      const vieille = { id: 'tp-9', acteDossierId: 'a', montantPropose: dec(1), dateProposition: new Date('2026-09-01') };
      prisma.tarifPropose.findMany.mockResolvedValueOnce([vieille]).mockResolvedValueOnce([vieille]);
      const r = await service.envoyerRappels(USER);
      expect(r).toMatchObject({ rappels: 1, escalades: 1, rappelApresJours: 2, escaladeApresJours: 5 });
      const filtres = prisma.tarifPropose.findMany.mock.calls.map((c: any) => c[0].where);
      expect(filtres[0]).toMatchObject({ statut: 'PROPOSE', rappelEnvoyeLe: null });
      expect(filtres[1]).toMatchObject({ statut: 'PROPOSE', escaladeEnvoyeeLe: null });
      expect(prisma.tarifPropose.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('rien à rappeler : aucun envoi', async () => {
      const r = await service.envoyerRappels(USER);
      expect(r).toMatchObject({ rappels: 0, escalades: 0 });
      expect(email.envoyerEmail).not.toHaveBeenCalled();
    });
  });

  it('detailsComplementaires : statut du tarif, montant retenu, motif de refus (ce que voient l’établissement et le patient)', async () => {
    const db: any = {
      tarifPropose: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', acteDossierId: 'x1', statut: 'REFUSE', montantPropose: dec(4500), montantDecide: null, motifDecision: 'Montant non justifié' },
          { id: 'b', acteDossierId: 'x2', statut: 'AJUSTE', montantPropose: dec(4500), montantDecide: dec(3800), motifDecision: 'Ajusté' },
          { id: 'c', acteDossierId: 'x3', statut: 'VALIDE', montantPropose: dec(4500), montantDecide: null, motifDecision: null },
        ]),
      },
      acteDossier: { findMany: jest.fn().mockResolvedValue([{ id: 'x1', libelle: 'L1' }, { id: 'x2', libelle: 'L2' }, { id: 'x3', libelle: 'L3' }]) },
    };
    const m = await service.detailsComplementaires(db, ['a', 'b', 'c']);
    expect(m.get('a')).toMatchObject({ statutTarif: 'REFUSE', montantRetenu: null, motifRefus: 'Montant non justifié', acte: 'L1' });
    expect(m.get('b')).toMatchObject({ statutTarif: 'AJUSTE', montantRetenu: '3800.00', motifAjustement: 'Ajusté' });
    expect(m.get('c')).toMatchObject({ statutTarif: 'VALIDE', montantRetenu: '4500.00', motifRefus: null });
  });
});
