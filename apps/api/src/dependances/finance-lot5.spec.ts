import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from './dependances.service';
import { REGISTRE } from './registre';

const USER = { sub: 'u-appelant' } as AuthenticatedUser;
const ORG = 'org-1';

/** `findFirst` renvoie l'enregistrement ; chaque `count` est numéroté dans l'ordre d'appel du registre. */
function service(rec: unknown, role: string, valeurs: Record<number, number> = {}, niveauAcces = 'ADMIN') {
  let i = 0;
  const modele = { findFirst: jest.fn(async () => rec), count: jest.fn(async () => valeurs[i++] ?? 0) };
  const executeRaw = jest.fn().mockResolvedValue(1);
  const db: any = new Proxy({}, { get: (t: any, p) => (p === '$executeRaw' ? executeRaw : p === '$transaction' ? jest.fn() : modele) });
  const identity = {
    getMe: jest.fn().mockResolvedValue({
      profil: { id: 'u-appelant', organisationId: ORG, societeId: null },
      permissions: { roleChain: role.split('+'), niveauAcces },
    }),
  };
  return new DependancesService(db, identity as any);
}

const cle = (entite: keyof typeof REGISTRE, c: string) => REGISTRE[entite].dependances.findIndex((d) => d.cle === c);

describe('Lot 5 — polices (ADR-007)', () => {
  const police = (statut: string) => ({ id: 'p-1', numeroPolice: 'POL-2026-0001', statut });

  it('modifier / supprimer : seulement un DEVIS ; sinon 409 avec le statut', async () => {
    for (const statut of ['SOUSCRITE', 'ACTIVE', 'SUSPENDUE', 'RESILIEE']) {
      const v = await service(police(statut), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'police', 'p-1', 'supprimer');
      expect(v.possible).toBe(false);
    }
    const ok = await service(police('DEVIS'), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'police', 'p-1', 'supprimer');
    expect(ok.possible).toBe(true);
  });

  it('devis relié à 2 adhérents, 1 avenant et 3 cotisations : supprimer refusé avec les nombres', async () => {
    const valeurs: Record<number, number> = {
      [cle('police', 'adherents')]: 2,
      [cle('police', 'avenants')]: 1,
      [cle('police', 'cotisations')]: 3,
    };
    const v = await service(police('DEVIS'), 'ASSUREUR_INFORMATIQUE', valeurs).verifier(USER, 'police', 'p-1', 'supprimer');
    expect(v.possible).toBe(false);
    expect(v.raison).toContain('2 adhérents');
    expect(v.raison).toContain('1 avenant');
    expect(v.raison).toContain('3 cotisations');
  });

  it('un statut final (renouvelée, résiliée, non renouvelée) n’a ni archivage ni désarchivage par le registre', () => {
    expect(REGISTRE.police.regles.desarchiver).toBeUndefined();
    expect(REGISTRE.police.regles.archiver).toBeUndefined();
  });
});

describe('Lot 5 — avenants', () => {
  const avenant = (statut: string) => ({ id: 'a-1', statut, type: 'AJOUT_BENEFICIAIRE', dateEffet: new Date('2026-04-01'), police: { organisationId: ORG } });

  it('BROUILLON : modifier et supprimer possibles, annuler refusé', async () => {
    const s = () => service(avenant('BROUILLON'), 'ASSUREUR_INFORMATIQUE');
    expect((await s().verifier(USER, 'avenant', 'a-1', 'modifier')).possible).toBe(true);
    expect((await s().verifier(USER, 'avenant', 'a-1', 'supprimer')).possible).toBe(true);
    const annuler = await s().verifier(USER, 'avenant', 'a-1', 'archiver');
    expect(annuler.possible).toBe(false);
    expect(annuler.raison).toContain('seul un avenant appliqué s’annule');
  });

  it('APPLIQUE : annuler possible ; modifier et supprimer refusés (conservé)', async () => {
    const s = () => service(avenant('APPLIQUE'), 'ASSUREUR_INFORMATIQUE');
    expect((await s().verifier(USER, 'avenant', 'a-1', 'archiver')).possible).toBe(true);
    expect((await s().verifier(USER, 'avenant', 'a-1', 'supprimer')).possible).toBe(false);
    expect((await s().verifier(USER, 'avenant', 'a-1', 'modifier')).possible).toBe(false);
  });

  it('ANNULE : plus rien n’est possible (déjà annulé)', async () => {
    const s = () => service(avenant('ANNULE'), 'ASSUREUR_INFORMATIQUE');
    const v = await s().verifier(USER, 'avenant', 'a-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toContain('déjà annulé');
  });
});

describe('Lot 5 — cotisations (montants chiffrés)', () => {
  const cot = (statut: string, montantPaye: number) => ({ id: 'c-1', statut, montantPaye, montantDu: 12500, periode: new Date('2026-03-01') });

  it('A_PAYER sans paiement (12 500 F) : annulation possible, comptable ET informatique', async () => {
    for (const role of ['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']) {
      const v = await service(cot('A_PAYER', 0), role).verifier(USER, 'cotisation', 'c-1', 'archiver');
      expect(v.possible).toBe(true);
    }
  });

  it('paiement partiel de 5 000 F : annulation refusée, montant cité', async () => {
    const v = await service(cot('A_PAYER', 5000), 'ASSUREUR_COMPTABLE').verifier(USER, 'cotisation', 'c-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toMatch(/5\s000,00 F/);
  });

  it('PAYEE (12 500 F) : ni annulation ni suppression ; EN_RETARD : annulation refusée ; ANNULEE : déjà annulée', async () => {
    const payee = await service(cot('PAYEE', 12500), 'ASSUREUR_COMPTABLE').verifier(USER, 'cotisation', 'c-1', 'supprimer');
    expect(payee.possible).toBe(false);
    expect(payee.raison).toMatch(/12\s500,00 F encaissés/);
    expect((await service(cot('PAYEE', 12500), 'ASSUREUR_COMPTABLE').verifier(USER, 'cotisation', 'c-1', 'archiver')).possible).toBe(false);
    expect((await service(cot('EN_RETARD', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'cotisation', 'c-1', 'archiver')).possible).toBe(false);
    const dej = await service(cot('ANNULEE', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'cotisation', 'c-1', 'archiver');
    expect(dej.raison).toContain('déjà annulée');
  });

  it('une cotisation n’est JAMAIS supprimable, même A_PAYER à zéro', async () => {
    const v = await service(cot('A_PAYER', 0), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'cotisation', 'c-1', 'supprimer');
    expect(v.possible).toBe(false);
  });

  it('autres rôles : 403', async () => {
    await expect(service(cot('A_PAYER', 0), 'ASSUREUR_EXPLOITATION').assertPossible(USER, 'cotisation', 'c-1', 'archiver')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('une cotisation ANNULEE ne bloque plus l’archivage de la société (seules A_PAYER / EN_RETARD comptent)', () => {
    const dep = REGISTRE.souscripteur.dependances.find((d) => d.cle === 'cotisationsImpayees')!;
    let where: any;
    void dep.compter({ cotisation: { count: async (a: any) => { where = a.where; return 0; } } } as any, { id: 's-1' }, { organisationId: ORG } as any);
    expect(where.statut).toEqual({ in: ['A_PAYER', 'EN_RETARD'] });
  });
});

describe('Lot 5 — comptes financiers', () => {
  const compte = (statut: string, solde: number) => ({ id: 'cf-1', nom: 'Caisse principale', statut, soldeActuel: solde });

  it('solde 150 000 F : archivage refusé avec le montant ; solde nul : possible', async () => {
    const v = await service(compte('ACTIF', 150000), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toMatch(/150\s000,00 F/);
    expect((await service(compte('ACTIF', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'archiver')).possible).toBe(true);
  });

  it('2 paiements groupés programmés : archivage refusé (nombre cité) ; la suppression reste décidée par les mouvements', async () => {
    const valeurs = { [cle('compteFinancier', 'groupesProgrammes')]: 2 };
    const v = await service(compte('ACTIF', 0), 'ASSUREUR_INFORMATIQUE', valeurs).verifier(USER, 'compteFinancier', 'cf-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toContain('2 paiements groupés programmés');
  });

  it('suppression : refusée avec 4 mouvements, possible sans aucun', async () => {
    const v = await service(compte('ACTIF', 0), 'ASSUREUR_COMPTABLE', { [cle('compteFinancier', 'mouvements')]: 4 }).verifier(USER, 'compteFinancier', 'cf-1', 'supprimer');
    expect(v.possible).toBe(false);
    expect(v.raison).toContain('4 mouvements financiers');
    expect((await service(compte('ACTIF', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'supprimer')).possible).toBe(true);
  });

  it('désarchiver : seulement un compte archivé ; modifier le libellé refusé s’il est archivé', async () => {
    expect((await service(compte('ARCHIVE', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'desarchiver')).possible).toBe(true);
    expect((await service(compte('ACTIF', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'desarchiver')).possible).toBe(false);
    expect((await service(compte('ARCHIVE', 0), 'ASSUREUR_COMPTABLE').verifier(USER, 'compteFinancier', 'cf-1', 'modifier')).possible).toBe(false);
  });

  it('rôles : comptable et informatique seulement', async () => {
    await expect(service(compte('ACTIF', 0), 'ASSUREUR_EXPLOITATION').assertPossible(USER, 'compteFinancier', 'cf-1', 'archiver')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service(compte('ACTIF', 10), 'ASSUREUR_COMPTABLE').assertPossible(USER, 'compteFinancier', 'cf-1', 'archiver')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Lot 5 — propositions d’import', () => {
  const imp = (statut: string) => ({ id: 'i-1', statut, fichierNom: null, nbLignesTotal: 7 });

  it('BROUILLON : supprimer et modifier possibles ; soumis ou validé : conservé', async () => {
    const role = 'ASSUREUR_INFORMATIQUE';
    expect((await service(imp('BROUILLON'), role).verifier(USER, 'propositionImport', 'i-1', 'supprimer')).possible).toBe(true);
    for (const statut of ['EN_ATTENTE_VALIDATION', 'VALIDE']) {
      expect((await service(imp(statut), role).verifier(USER, 'propositionImport', 'i-1', 'supprimer')).possible).toBe(false);
      expect((await service(imp(statut), role).verifier(USER, 'propositionImport', 'i-1', 'modifier')).possible).toBe(false);
    }
  });
});
