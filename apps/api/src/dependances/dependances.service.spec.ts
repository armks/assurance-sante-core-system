import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService, enumerer } from './dependances.service';
import { ACTIONS, type Action } from './dependances.types';
import { REGISTRE } from './registre';

const USER = { sub: 'u-appelant' } as AuthenticatedUser;
const ORG = 'org-1';

/**
 * Enregistrement factice satisfaisant la règle d'ÉTAT de l'action testée (pour que seul
 * le comptage des dépendances décide) : brouillon pour supprimer un produit, publié pour
 * l'archiver, archivé pour le désarchiver, etc.
 */
function fixture(entite: string, action: Action): Record<string, unknown> {
  const archive = action === 'desarchiver';
  const base: Record<string, unknown> = {
    id: 'x-1', nom: 'Nom', prenom: 'Prénom', titre: 'Titre', email: 'a@b.ci', code: 'C01', libelle: 'Libellé',
    denominationCommune: 'Paracétamol', version: 1, role: 'ROLE', type: 'TYPE', trancheAgeMin: 0, trancheAgeMax: 10,
    tarifConvention: 1000, dateDebut: new Date('2026-01-01'), dateFin: archive ? new Date('2026-06-30') : null,
    etablissementId: 'etab-1', pharmacieId: null, referentielActeId: 'ra-1', referentielActe: { code: 'C01', libelle: 'Consultation' },
    produit: { nom: 'Formule', statut: 'BROUILLON' }, convention: { statut: 'PROPOSEE', numero: 'C-1' }, categorieActe: 'CONSULTATION', numeroPolice: 'POL-1', actif: !archive, soldeActuel: 0, montantPaye: 0, montantDu: 5000, periode: new Date('2026-03-01'), nbLignesTotal: 3, fichierNom: null,
  };
  const statut: Record<string, string> = {
    organisation: archive ? 'ARCHIVEE' : 'ACTIVE',
    etablissement: archive ? 'RESILIE' : 'ACTIF',
    pharmacie: archive ? 'RESILIEE' : 'ACTIVE',
    souscripteur: archive ? 'ARCHIVE' : 'ACTIF',
    utilisateur: archive ? 'REVOQUE' : 'ACTIF',
    invitation: archive ? 'REVOQUEE' : 'EN_ATTENTE',
    referentielActe: action === 'supprimer' ? 'PROPOSE' : archive ? 'RETIRE' : 'HOMOLOGUE',
    acteNational: archive ? 'RETIRE' : 'HOMOLOGUE',
    produit: action === 'archiver' ? 'PUBLIE' : archive ? 'ARCHIVE' : 'BROUILLON',
    police: 'DEVIS',
    avenant: action === 'archiver' ? 'APPLIQUE' : 'BROUILLON',
    convention: action === 'archiver' ? 'VALIDEE' : 'PROPOSEE',
    compteFinancier: archive ? 'ARCHIVE' : 'ACTIF',
    cotisation: 'A_PAYER',
    propositionImport: 'BROUILLON',
    adherent: archive ? 'RADIE' : 'ACTIF',
    beneficiaire: archive ? 'RADIE' : 'ACTIF',
  };
  const homologation: Record<string, string> = {
    medicament: action === 'supprimer' ? 'PROPOSE' : archive ? 'RETIRE' : 'HOMOLOGUE',
    medicamentNational: archive ? 'RETIRE' : 'HOMOLOGUE',
  };
  return { ...base, statut: statut[entite] ?? 'ACTIF', statutHomologation: homologation[entite] ?? 'HOMOLOGUE' };
}

/**
 * Base factice : `findFirst` renvoie l'enregistrement ; chaque `count` est numéroté dans
 * l'ordre d'appel (une dépendance = un `count`) et renvoie `valeurs[i]` (0 par défaut).
 */
function baseFactice(rec: unknown, valeurs: Record<number, number> = {}) {
  let i = 0;
  const appels: unknown[] = [];
  const modele = {
    findFirst: jest.fn(async () => rec),
    findMany: jest.fn(async () => [{ id: 'l-1' }]),
    count: jest.fn(async (args: unknown) => {
      appels.push(args);
      return valeurs[i++] ?? 0;
    }),
  };
  const db: any = new Proxy({}, {
    get: (t: any, p) => (p in t ? t[p] : p === '$executeRaw' ? executeRaw : p === '$transaction' ? transaction : modele),
  });
  const executeRaw = jest.fn().mockResolvedValue(1);
  const transaction = jest.fn();
  return { db, appels, executeRaw, transaction };
}

function service(rec: unknown, role: string, valeurs: Record<number, number> = {}, profil: Record<string, unknown> = {}, niveauAcces = 'ADMIN') {
  const base = baseFactice(rec, valeurs);
  const estSuperadmin = role === 'SUPERADMIN_PRINCIPAL';
  const identity = {
    getMe: jest.fn().mockResolvedValue({
      profil: { id: 'u-appelant', organisationId: estSuperadmin ? null : ORG, societeId: null, ...profil },
      permissions: { roleChain: role.split('+'), niveauAcces },
    }),
  };
  return { s: new DependancesService(base.db, identity as any), ...base };
}

describe('DependancesService — registre : chaque type de dépendance, pour chaque entité auditée', () => {
  for (const [entite, def] of Object.entries(REGISTRE)) {
    describe(entite, () => {
      def.dependances.forEach((d, index) => {
        if (d.bloquantSiNul) return; // garde-fou « aucun autre … » : testé à part (décompte nul = blocage)
        const bloque = d.bloque ?? ['supprimer'];
        it(`« ${d.cle} » (1 ${d.singulier}) bloque ${bloque.join(', ')} — et aucune autre action`, async () => {
          for (const action of ACTIONS) {
            if (!def.regles[action]) continue; // action non disponible pour cette entité
            if (entite === 'cotisation' && action === 'supprimer') continue; // jamais supprimée : testé à part
            const { s } = service(fixture(entite, action), def.roles[0], { [index]: 1 });
            const v = await s.verifier(USER, entite, 'x-1', action);
            expect(v.liens).toContainEqual({ type: d.cle, libelle: d.singulier, nombre: 1 });
            if (bloque.includes(action)) {
              expect(v.possible).toBe(false);
              expect(v.raison).toContain(`1 ${d.singulier}`);
            } else if (!(entite === 'invitation' && action === 'supprimer')) {
              expect({ action, possible: v.possible, raison: v.raison }).toEqual({ action, possible: true, raison: null });
            }
          }
        });
      });

      it('aucune dépendance → toute action disponible et permise par l’état est possible', async () => {
        for (const action of ACTIONS) {
          if (!def.regles[action]) continue;
          if (entite === 'cotisation' && action === 'supprimer') continue; // jamais supprimée : testé à part
          const { s } = service(fixture(entite, action), def.roles[0]);
          const v = await s.verifier(USER, entite, 'x-1', action);
          if (entite === 'invitation' && action === 'supprimer') {
            expect(v.possible).toBe(false); // jamais supprimée : historique des accès
          } else {
            expect({ action, possible: v.possible, raison: v.raison }).toEqual({ action, possible: true, raison: null });
          }
          expect(v.liens).toEqual([]);
        }
      });
    });
  }
});

describe('DependancesService — messages, rôles, périmètre, refus', () => {
  const ETAB = REGISTRE.etablissement;
  const idx = (cle: string) => ETAB.dependances.findIndex((d) => d.cle === cle);

  it('raison en français avec les nombres et les accords : « lié à 3 dossiers de soins et 1 tarif conventionné. Archivez-le plutôt. »', async () => {
    const { s } = service(fixture('etablissement', 'supprimer'), 'ASSUREUR_INFORMATIQUE', { [idx('dossiers')]: 3, [idx('tarifs')]: 1 });
    const v = await s.verifier(USER, 'etablissement', 'x-1', 'supprimer');
    expect(v.raison).toBe(
      "Suppression impossible : l'établissement de santé « Nom » est lié à 3 dossiers de soins et 1 tarif conventionné. Archivez-le plutôt.",
    );
    expect(enumerer([{ type: 'a', libelle: 'polices', nombre: 2 }, { type: 'b', libelle: 'adhérent', nombre: 1 }, { type: 'c', libelle: 'cotisations', nombre: 4 }]))
      .toBe('2 polices, 1 adhérent et 4 cotisations');
  });

  it('règle d’état avant les dépendances : produit publié → « créez une nouvelle version »', async () => {
    const { s } = service({ ...fixture('produit', 'modifier'), statut: 'PUBLIE' }, 'ASSUREUR_INFORMATIQUE');
    const v = await s.verifier(USER, 'produit', 'x-1', 'modifier');
    expect(v.raison).toBe('Modification impossible : Un produit publié ou archivé ne se modifie pas : créez une nouvelle version.');
  });

  it('action non disponible pour l’entité (archiver une invitation) → impossible, raison explicite', async () => {
    const { s } = service(fixture('invitation', 'archiver'), 'ASSUREUR_INFORMATIQUE');
    const v = await s.verifier(USER, 'invitation', 'x-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toBe("Archivage impossible : cette action n'est pas encore disponible pour l'invitation.");
  });

  it('rôle insuffisant → 403 ; entité inconnue → 404 ; enregistrement hors périmètre → 404 sans aucun comptage', async () => {
    await expect(service(fixture('etablissement', 'supprimer'), 'ASSUREUR_COMPTABLE').s.verifier(USER, 'etablissement', 'x-1', 'supprimer'))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service({}, 'ASSUREUR_INFORMATIQUE').s.verifier(USER, 'inconnue', 'x-1', 'supprimer'))
      .rejects.toBeInstanceOf(NotFoundException);
    const horsPerimetre = service(null, 'ASSUREUR_INFORMATIQUE');
    await expect(horsPerimetre.s.verifier(USER, 'etablissement', 'x-1', 'supprimer')).rejects.toBeInstanceOf(NotFoundException);
    expect(horsPerimetre.appels).toHaveLength(0);
  });

  it('chaque comptage d’un établissement porte sur l’organisation du JETON (aucune fuite inter-organisation)', async () => {
    const { s, appels } = service(fixture('etablissement', 'supprimer'), 'ASSUREUR_INFORMATIQUE');
    await s.verifier(USER, 'etablissement', 'x-1', 'supprimer');
    const sansOrganisation = (appels as any[]).filter((a) => !JSON.stringify(a).includes(`"${ORG}"`));
    // liens par identifiant d'établissement uniquement (sans colonne organisation) : actes exécutés
    expect(sansOrganisation.map((a) => Object.keys(a.where))).toEqual([['etablissementExecutionId']]);
  });

  it('rôle SOCIÉTÉ : l’adhérent n’est chargé que dans SA société (souscripteurId du jeton)', async () => {
    const { s, db } = service(fixture('adherent', 'supprimer'), 'SOCIETE_ADMINISTRATION', {}, { societeId: 'soc-A' });
    await s.verifier(USER, 'adherent', 'x-1', 'supprimer');
    expect(db.adherent.findFirst).toHaveBeenCalledWith({
      where: { id: 'x-1', organisationId: ORG, deletedAt: null, souscripteurId: 'soc-A' },
    });
  });

  it('rôle ASSUREUR : l’adhérent est chargé dans toute l’organisation (pas de filtre société)', async () => {
    const { s, db } = service(fixture('adherent', 'supprimer'), 'ASSUREUR_EXPLOITATION');
    await s.verifier(USER, 'adherent', 'x-1', 'supprimer');
    expect(db.adherent.findFirst).toHaveBeenCalledWith({ where: { id: 'x-1', organisationId: ORG, deletedAt: null } });
  });

  it('assertPossible : refus → 409 (raison + liens) et refus tracé via log_audit HORS transaction', async () => {
    const { s, executeRaw, transaction } = service(fixture('etablissement', 'supprimer'), 'ASSUREUR_INFORMATIQUE', { [idx('dossiers')]: 2 });
    const err = await s.assertPossible(USER, 'etablissement', 'x-1', 'supprimer').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      message: expect.stringContaining('2 dossiers de soins'),
      liens: [{ type: 'dossiers', libelle: 'dossiers de soins', nombre: 2 }],
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [gabarit, ...valeurs] = executeRaw.mock.calls[0];
    expect(gabarit.join('?')).toContain('log_audit(');
    expect(valeurs.slice(0, 4)).toEqual(['REFUS_SUPPRIMER', 'etablissements_sante', 'x-1', 'u-appelant']);
    expect(JSON.parse(valeurs[4])).toMatchObject({ entite: 'etablissement', raison: expect.stringContaining('dossiers de soins') });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('assertPossible : action possible → aucune ligne d’audit (l’action réussie est journalisée par le service métier)', async () => {
    const { s, executeRaw } = service(fixture('etablissement', 'supprimer'), 'ASSUREUR_INFORMATIQUE');
    await expect(s.assertPossible(USER, 'etablissement', 'x-1', 'supprimer')).resolves.toMatchObject({ possible: true });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('un compte ne peut pas supprimer son propre compte', async () => {
    const { s } = service({ ...fixture('utilisateur', 'supprimer'), id: 'u-appelant' }, 'ASSUREUR_INFORMATIQUE');
    const v = await s.verifier(USER, 'utilisateur', 'u-appelant', 'supprimer');
    expect(v.raison).toBe('Suppression impossible : Vous ne pouvez pas supprimer votre propre compte.');
  });
});

describe('DependancesService — lot 2 : entités de configuration', () => {
  const index = (entite: string, cle: string) => REGISTRE[entite].dependances.findIndex((d) => d.cle === cle);

  describe('suppression réservée au service informatique (et à la direction pour les produits)', () => {
    const cas: [string, string, boolean][] = [
      ['referentielActe', 'ASSUREUR_MEDECIN_CONSEIL', false],
      ['referentielActe', 'ASSUREUR_INFORMATIQUE', true],
      ['medicament', 'ASSUREUR_PHARMACIEN_CONSEIL', false],
      ['medicament', 'ASSUREUR_INFORMATIQUE', true],
      ['produit', 'ASSUREUR_DIRECTION', true],
      ['produit', 'ASSUREUR_INFORMATIQUE', true],
      ['garantie', 'ASSUREUR_DIRECTION', true],
    ];
    for (const [entite, role, autorise] of cas) {
      it(`${entite} — ${role} : suppression ${autorise ? 'autorisée' : 'refusée (code ROLE)'}`, async () => {
        const v = await service(fixture(entite, 'supprimer'), role).s.verifier(USER, entite, 'x-1', 'supprimer');
        if (autorise) {
          expect(v).toMatchObject({ possible: true, code: null });
        } else {
          expect(v).toMatchObject({
            possible: false,
            code: 'ROLE',
            raison: 'Suppression impossible : la suppression définitive est réservée au service informatique.',
          });
        }
      });
    }

    it('le même rôle garde les autres actions (archiver un acte : médecin conseil)', async () => {
      const v = await service(fixture('referentielActe', 'archiver'), 'ASSUREUR_MEDECIN_CONSEIL').s.verifier(USER, 'referentielActe', 'x-1', 'archiver');
      expect(v.possible).toBe(true);
    });

    it('assertPossible : rôle non autorisé → 403 (pas 409), refus tracé', async () => {
      const { s, executeRaw } = service(fixture('referentielActe', 'supprimer'), 'ASSUREUR_MEDECIN_CONSEIL');
      const err = await s.assertPossible(USER, 'referentielActe', 'x-1', 'supprimer').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ message: expect.stringContaining('service informatique') });
      expect(executeRaw.mock.calls[0].slice(1, 3)).toEqual(['REFUS_SUPPRIMER', 'referentiel_actes']);
    });
  });

  describe('produit en brouillon : ses garanties partent avec lui, sauf si l’une est utilisée', () => {
    it('3 garanties non utilisées → suppression possible, les garanties sont annoncées dans les liens', async () => {
      const v = await service(fixture('produit', 'supprimer'), 'ASSUREUR_DIRECTION', { [index('produit', 'garanties')]: 3 })
        .s.verifier(USER, 'produit', 'x-1', 'supprimer');
      expect(v).toMatchObject({ possible: true, liens: [{ type: 'garanties', libelle: 'garanties', nombre: 3 }] });
    });

    it('une garantie utilisée (dossier ou réclamation) → refus nommé', async () => {
      const v = await service(fixture('produit', 'supprimer'), 'ASSUREUR_DIRECTION', {
        [index('produit', 'garanties')]: 3,
        [index('produit', 'garantiesUtilisees')]: 1,
      }).s.verifier(USER, 'produit', 'x-1', 'supprimer');
      expect(v.possible).toBe(false);
      expect(v.raison).toContain('1 garantie utilisée (dossier de soins ou réclamation)');
      expect(v.raison).not.toContain('3 garanties');
    });

    it('le comptage des garanties utilisées porte sur les dossiers ET les réclamations, en un seul count', async () => {
      const { s, appels } = service(fixture('produit', 'supprimer'), 'ASSUREUR_DIRECTION');
      await s.verifier(USER, 'produit', 'x-1', 'supprimer');
      expect(appels[index('produit', 'garantiesUtilisees')]).toEqual({
        where: { produitId: 'x-1', deletedAt: null, OR: [{ dossiersSoins: { some: {} } }, { reclamations: { some: {} } }] },
      });
    });
  });

  describe('liens tracés au calcul (prisma/sql/074)', () => {
    it('grille : comptée par grilleTarifaireId (cotisations, tarifications) ; modifiable même utilisée', async () => {
      const valeurs = { [index('grilleTarifaire', 'cotisations')]: 4 };
      const sup = await service(fixture('grilleTarifaire', 'supprimer'), 'ASSUREUR_INFORMATIQUE', valeurs).s.verifier(USER, 'grilleTarifaire', 'x-1', 'supprimer');
      expect(sup.raison).toBe('Suppression impossible : la grille tarifaire « 0–10 ans » est liée à 4 cotisations calculées avec cette grille.');
      const mod = await service(fixture('grilleTarifaire', 'modifier'), 'ASSUREUR_INFORMATIQUE', valeurs).s.verifier(USER, 'grilleTarifaire', 'x-1', 'modifier');
      expect(mod.possible).toBe(true);
      const { s, appels } = service(fixture('grilleTarifaire', 'supprimer'), 'ASSUREUR_INFORMATIQUE');
      await s.verifier(USER, 'grilleTarifaire', 'x-1', 'supprimer');
      expect(appels).toEqual([
        { where: { grilleTarifaireId: 'x-1', police: { organisationId: ORG } } },
        { where: { grilleTarifaireId: 'x-1', police: { organisationId: ORG } } },
      ]);
    });

    it('tarif ayant servi : ni suppression (« Fermez-le plutôt ») ni modification (« Changer à partir du… »)', async () => {
      const valeurs = { [index('tarif', 'actesCalcules')]: 2 };
      const sup = await service(fixture('tarif', 'supprimer'), 'ASSUREUR_INFORMATIQUE', valeurs).s.verifier(USER, 'tarif', 'x-1', 'supprimer');
      expect(sup.raison).toBe(
        "Suppression impossible : le tarif conventionné « Consultation — 1 000 F » est lié à 2 actes calculés avec ce tarif. Fermez-le plutôt (date de fin) : l'historique est conservé.",
      );
      const mod = await service(fixture('tarif', 'modifier'), 'ASSUREUR_INFORMATIQUE', valeurs).s.verifier(USER, 'tarif', 'x-1', 'modifier');
      expect(mod.raison).toContain('Utilisez « Changer à partir du… »');
      const fermer = await service(fixture('tarif', 'archiver'), 'ASSUREUR_INFORMATIQUE', valeurs).s.verifier(USER, 'tarif', 'x-1', 'archiver');
      expect(fermer.possible).toBe(true);
    });

    it('tarif de PHARMACIE : plus utilisé par le comptoir (prix saisi, migration 078) → se supprime et se modifie comme un tarif d’établissement sans calcul', async () => {
      const rec = { ...fixture('tarif', 'supprimer'), etablissementId: null, pharmacieId: 'ph-1' };
      for (const action of ['supprimer', 'modifier', 'archiver'] as const) {
        const r = await service(rec, 'ASSUREUR_INFORMATIQUE').s.verifier(USER, 'tarif', 'x-1', action);
        expect(r.possible).toBe(true);
      }
    });

    it('tarif : comptages par tarifConventionneId (actes) et tarifPharmacieId (dispensations), dans l’organisation du jeton', async () => {
      const { s, appels } = service(fixture('tarif', 'supprimer'), 'ASSUREUR_INFORMATIQUE');
      await s.verifier(USER, 'tarif', 'x-1', 'supprimer');
      expect(appels.slice(0, 2)).toEqual([
        { where: { tarifConventionneId: 'x-1', dossier: { organisationId: ORG } } },
        { where: { tarifPharmacieId: 'x-1', dispensation: { pharmacie: { organisationId: ORG } } } },
      ]);
    });
  });

  describe('verdicts d’une liste (boutons d’une table)', () => {
    it('quatre verdicts par élément, liens comptés UNE fois par élément ; hors périmètre absent', async () => {
      const base = baseFactice(null);
      const recs: Record<string, unknown> = { a: fixture('evenement', 'supprimer'), b: { ...fixture('evenement', 'supprimer'), actif: false } };
      base.db.evenement = { findFirst: jest.fn(async ({ where }: any) => recs[where.id] ?? null), count: jest.fn() };
      const identity = { getMe: jest.fn().mockResolvedValue({ profil: { id: 'u', organisationId: ORG }, permissions: { roleChain: ['ASSUREUR_INFORMATIQUE'] } }) };
      const s = new DependancesService(base.db, identity as any);
      const r = await s.verifierListe(USER, 'evenement', ['a', 'b', 'autre-organisation']);
      expect(Object.keys(r)).toEqual(['a', 'b']);
      expect(r.a.archiver).toEqual({ possible: true, raison: null, code: null });
      expect(r.a.desarchiver.possible).toBe(false);
      expect(r.b.desarchiver.possible).toBe(true);
      expect(r.b.archiver).toMatchObject({ possible: false, code: 'ETAT' });
    });
  });
});

describe('DependancesService — lot 3 : entités partenaires', () => {
  const index = (entite: string, cle: string) => REGISTRE[entite].dependances.findIndex((d) => d.cle === cle);
  const verifier = (entite: string, action: Action, role: string, valeurs: Record<number, number> = {}, rec?: Record<string, unknown>) =>
    service(rec ?? fixture(entite, action), role, valeurs).s.verifier(USER, entite, 'x-1', action);

  describe('blocages d’archivage : raison précise, nombres en français', () => {
    const cas: [string, string, number, string][] = [
      ['etablissement', 'dossiersOuverts', 2, '2 dossiers de soins ouverts'],
      ['etablissement', 'facturesNonReglees', 1, '1 facture non réglée'],
      ['etablissement', 'facturesMensuellesNonPayees', 3, '3 factures mensuelles non payées'],
      ['pharmacie', 'dispensationsEnCours', 4, '4 dispensations non payées'],
      ['pharmacie', 'facturesMensuellesNonPayees', 1, '1 facture mensuelle non payée'],
      ['souscripteur', 'policesEnCours', 2, '2 polices actives ou suspendues'],
      ['souscripteur', 'adherentsActifs', 1, '1 adhérent actif'],
      ['souscripteur', 'cotisationsImpayees', 5, '5 cotisations à payer'],
    ];
    for (const [entite, cle, n, texte] of cas) {
      it(`${entite} — ${cle} (${n}) bloque l’archivage : « ${texte} »`, async () => {
        const v = await verifier(entite, 'archiver', 'ASSUREUR_INFORMATIQUE', { [index(entite, cle)]: n });
        expect(v).toMatchObject({ possible: false, code: 'LIENS' });
        expect(v.raison).toContain(texte);
        expect(v.raison).toMatch(/^Archivage impossible : /);
      });
    }

    it('sans activité en cours : archivage possible (établissement, pharmacie, société)', async () => {
      for (const e of ['etablissement', 'pharmacie', 'souscripteur']) {
        expect((await verifier(e, 'archiver', 'ASSUREUR_INFORMATIQUE')).possible).toBe(true);
      }
    });

    it('un élément archivé : déjà archivé / désarchivage possible / modification refusée', async () => {
      for (const [e, role] of [['etablissement', 'ASSUREUR_INFORMATIQUE'], ['pharmacie', 'ASSUREUR_INFORMATIQUE'], ['souscripteur', 'ASSUREUR_DIRECTION']]) {
        const rec = fixture(e, 'desarchiver');
        expect((await verifier(e, 'archiver', role, {}, rec)).raison).toContain('déjà archivé');
        expect((await verifier(e, 'desarchiver', role, {}, rec)).possible).toBe(true);
        expect((await verifier(e, 'modifier', role, {}, rec)).raison).toContain('désarchiv');
      }
      expect((await verifier('etablissement', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, fixture('etablissement', 'supprimer'))).raison).toContain("n'est pas archivé");
    });
  });

  describe('la suppression reste liée à TOUTES les dépendances, liens logiques compris', () => {
    const cas: [string, string][] = [
      ['etablissement', 'utilisateurs'], ['etablissement', 'invitations'], ['etablissement', 'tarifs'], ['etablissement', 'dossiers'],
      ['pharmacie', 'utilisateurs'], ['pharmacie', 'invitations'], ['pharmacie', 'stock'], ['pharmacie', 'dispensations'],
      ['souscripteur', 'utilisateurs'], ['souscripteur', 'invitations'], ['souscripteur', 'polices'], ['souscripteur', 'adherents'],
    ];
    for (const [entite, cle] of cas) {
      it(`${entite} — « ${cle} » bloque la suppression`, async () => {
        const v = await verifier(entite, 'supprimer', 'ASSUREUR_INFORMATIQUE', { [index(entite, cle)]: 1 });
        expect(v).toMatchObject({ possible: false, code: 'LIENS' });
      });
    }
  });

  describe('rôles', () => {
    it('établissement / pharmacie : archivage et suppression INFORMATIQUE seulement', async () => {
      for (const e of ['etablissement', 'pharmacie']) {
        await expect(verifier(e, 'archiver', 'ASSUREUR_DIRECTION')).rejects.toThrow();
        await expect(verifier(e, 'supprimer', 'ASSUREUR_COMPTABLE')).rejects.toThrow();
        expect((await verifier(e, 'archiver', 'ASSUREUR_INFORMATIQUE')).possible).toBe(true);
      }
    });
    it('société : archivage et suppression DIRECTION et INFORMATIQUE ; exploitation et comptable gardent la modification', async () => {
      for (const role of ['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']) {
        expect((await verifier('souscripteur', 'archiver', role)).possible).toBe(true);
        expect((await verifier('souscripteur', 'supprimer', role)).possible).toBe(true);
      }
      for (const role of ['ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE']) {
        const a = await verifier('souscripteur', 'archiver', role);
        expect(a).toMatchObject({ possible: false, code: 'ROLE' });
        expect(a.raison).toContain("l'archivage est réservé au service informatique et à la direction");
        expect((await verifier('souscripteur', 'desarchiver', role, {}, fixture('souscripteur', 'desarchiver'))).code).toBe('ROLE');
        expect((await verifier('souscripteur', 'supprimer', role)).code).toBe('ROLE');
        expect((await verifier('souscripteur', 'modifier', role)).possible).toBe(true);
      }
    });
    it('assertPossible : rôle non autorisé à archiver → 403 (pas 409), refus tracé', async () => {
      const { s, executeRaw } = service(fixture('souscripteur', 'archiver'), 'ASSUREUR_COMPTABLE');
      const err = await s.assertPossible(USER, 'souscripteur', 'x-1', 'archiver').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(executeRaw.mock.calls[0].slice(1, 3)).toEqual(['REFUS_ARCHIVER', 'souscripteurs']);
    });
  });
});

describe('DependancesService — lot 4 : personnes', () => {
  const index = (entite: string, cle: string) => REGISTRE[entite].dependances.findIndex((d) => d.cle === cle);
  const verifier = (entite: string, action: Action, role: string, valeurs: Record<number, number> = {}, rec?: Record<string, unknown>, niveau = 'ADMIN') =>
    service(rec ?? fixture(entite, action), role, valeurs, {}, niveau).s.verifier(USER, entite, 'x-1', action);

  describe('comptes : révoquer (archiver), réactiver (désarchiver), changer le rôle (modifier), supprimer', () => {
    const cptActif = { ...fixture('utilisateur', 'archiver'), role: 'ASSUREUR_EXPLOITATION', sousRole: { niveauAcces: 'MODIFICATION' }, statut: 'ACTIF', desactiveLe: null };
    const cptRevoque = { ...cptActif, statut: 'REVOQUE' };
    const idxAdmin = () => index('utilisateur', 'dernierAdministrateur');

    it('compte ordinaire : révocation, changement de rôle et suppression possibles ; libellés « Révocation » / « Réactivation » / « Changement de rôle »', async () => {
      for (const action of ['archiver', 'modifier', 'supprimer'] as const) {
        const v = await verifier('utilisateur', action, 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, cptActif);
        expect({ action, possible: v.possible }).toEqual({ action, possible: true });
      }
      const rev = await verifier('utilisateur', 'desarchiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, cptActif);
      expect(rev.raison).toBe("Réactivation impossible : ce compte n'est ni révoqué ni désactivé.");
      const dejaRevoque = await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, cptRevoque);
      expect(dejaRevoque.raison).toBe('Révocation impossible : ce compte est déjà révoqué.');
      const modifRevoque = await verifier('utilisateur', 'modifier', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, cptRevoque);
      expect(modifRevoque.raison).toBe('Changement de rôle impossible : ce compte est révoqué : réactivez-le d’abord.');
    });

    it('réactiver : possible pour un compte révoqué ET pour un compte désactivé par un archivage', async () => {
      expect((await verifier('utilisateur', 'desarchiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, cptRevoque)).possible).toBe(true);
      expect((await verifier('utilisateur', 'desarchiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, { ...cptActif, desactiveLe: new Date() })).possible).toBe(true);
    });

    it('pas d’auto-révocation, ni de suppression ou de changement de rôle de soi-même', async () => {
      const soi = { ...cptActif, id: 'u-appelant' };
      expect((await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE', {}, soi)).raison).toBe('Révocation impossible : Vous ne pouvez pas révoquer votre propre compte.');
      expect((await verifier('utilisateur', 'supprimer', 'ASSUREUR_INFORMATIQUE', {}, soi)).raison).toBe('Suppression impossible : Vous ne pouvez pas supprimer votre propre compte.');
      expect((await verifier('utilisateur', 'modifier', 'ASSUREUR_INFORMATIQUE', {}, soi)).raison).toBe('Changement de rôle impossible : Vous ne pouvez pas changer votre propre rôle.');
    });

    it('DERNIER administrateur protégé : aucun autre administrateur actif → révoquer, supprimer et changer le rôle refusés, avec la raison', async () => {
      const dernier = { ...cptActif, role: 'ASSUREUR_INFORMATIQUE', sousRole: { niveauAcces: 'ADMIN' } };
      for (const [action, nom] of [['archiver', 'Révocation'], ['modifier', 'Changement de rôle'], ['supprimer', 'Suppression']] as const) {
        const v = await verifier('utilisateur', action, 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 0 }, dernier);
        expect(v).toMatchObject({ possible: false, code: 'LIENS' });
        expect(v.raison).toBe(`${nom} impossible : ce compte est le dernier administrateur actif de l'organisation : nommez-en un autre d'abord.`);
      }
      // un AUTRE administrateur actif existe → possible
      expect((await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, dernier)).possible).toBe(true);
      // un compte qui n'est pas administrateur n'est jamais « le dernier »
      expect((await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 0 }, cptActif)).possible).toBe(true);
    });

    it('niveau SUPÉRIEUR : niveau d’accès au-dessus du mien → refusé (révoquer, changer le rôle, supprimer, réactiver)', async () => {
      const admin = { ...cptActif, role: 'ASSUREUR_INFORMATIQUE', sousRole: { niveauAcces: 'ADMIN' } };
      for (const action of ['archiver', 'modifier', 'supprimer'] as const) {
        const v = await verifier('utilisateur', action, 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, admin, 'MODIFICATION');
        expect(v.raison).toContain("ce compte est d'un niveau supérieur au vôtre");
      }
      const reac = await verifier('utilisateur', 'desarchiver', 'ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, { ...admin, statut: 'REVOQUE' }, 'MODIFICATION');
      expect(reac.possible).toBe(false);
    });

    it('niveau SUPÉRIEUR : le rôle parent de l’appelant (adjoint → titulaire) est protégé, même à niveau d’accès égal', async () => {
      const titulaire = { ...cptActif, role: 'ASSUREUR_INFORMATIQUE', sousRole: { niveauAcces: 'MODIFICATION' } };
      const v = await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE_ADJOINT+ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, titulaire, 'MODIFICATION');
      expect(v.possible).toBe(false);
      expect(v.raison).toContain("ce compte est d'un niveau supérieur au vôtre");
      // un collègue de même rôle et de même niveau n'est PAS protégé
      const collegue = { ...cptActif, role: 'ASSUREUR_INFORMATIQUE_ADJOINT', sousRole: { niveauAcces: 'MODIFICATION' } };
      expect((await verifier('utilisateur', 'archiver', 'ASSUREUR_INFORMATIQUE_ADJOINT+ASSUREUR_INFORMATIQUE', { [idxAdmin()]: 1 }, collegue, 'MODIFICATION')).possible).toBe(true);
    });

    it('rôle : seule l’informatique gère les comptes (403) ; compte d’une autre organisation : 404 sans aucun comptage', async () => {
      await expect(verifier('utilisateur', 'archiver', 'ASSUREUR_DIRECTION', {}, cptActif)).rejects.toBeInstanceOf(ForbiddenException);
      const { s, appels } = service(null, 'ASSUREUR_INFORMATIQUE');
      await expect(s.verifier(USER, 'utilisateur', 'autre-org', 'archiver')).rejects.toBeInstanceOf(NotFoundException);
      expect(appels).toEqual([]);
    });
  });

  describe('adhérents et bénéficiaires : blocages d’archivage avec raison et nombres', () => {
    const cas: [string, string, number, string][] = [
      ['adherent', 'dossiersOuverts', 2, '2 dossiers de soins ouverts'],
      ['adherent', 'reclamationsEnCours', 1, '1 réclamation en cours'],
      ['adherent', 'cotisationsDues', 3, '3 cotisations dues'],
      ['adherent', 'dossiersOuvertsBeneficiaires', 1, "1 dossier de soins ouvert d'un bénéficiaire"],
      ['adherent', 'reclamationsEnCoursBeneficiaires', 2, 'réclamations en cours de bénéficiaires'],
      ['beneficiaire', 'dossiersOuverts', 1, '1 dossier de soins ouvert'],
      ['beneficiaire', 'reclamationsEnCours', 4, '4 réclamations en cours'],
    ];
    for (const [entite, cle, n, texte] of cas) {
      it(`${entite} — ${cle} (${n}) bloque l’archivage : « ${texte} »`, async () => {
        const v = await verifier(entite, 'archiver', 'ASSUREUR_EXPLOITATION', { [index(entite, cle)]: n });
        expect(v).toMatchObject({ possible: false, code: 'LIENS' });
        expect(v.raison).toContain(texte);
        expect(v.raison).toMatch(/^Archivage impossible : /);
      });
    }

    it('la suppression reste liée à TOUS les liens (dossiers, réclamations, factures, cotisations, codes, comptes, invitations, bénéficiaires)', async () => {
      for (const cle of ['dossiers', 'reclamations', 'factures', 'cotisations', 'codesConsultation', 'codesOrdonnance', 'comptes', 'invitations', 'beneficiaires']) {
        const v = await verifier('adherent', 'supprimer', 'ASSUREUR_DIRECTION', { [index('adherent', cle)]: 1 });
        expect({ cle, possible: v.possible }).toEqual({ cle, possible: false });
      }
    });

    it('rôles : direction, exploitation, informatique ; SOCIETE_ADMINISTRATION pour SES adhérents ; comptable refusé (403)', async () => {
      for (const role of ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']) {
        expect((await verifier('adherent', 'archiver', role)).possible).toBe(true);
      }
      await expect(verifier('adherent', 'archiver', 'ASSUREUR_COMPTABLE')).rejects.toBeInstanceOf(ForbiddenException);
      const societe = service(fixture('adherent', 'archiver'), 'SOCIETE_ADMINISTRATION', {}, { societeId: 'soc-1' });
      expect((await societe.s.verifier(USER, 'adherent', 'x-1', 'archiver')).possible).toBe(true);
    });

    it('société : sortie déjà proposée → archiver refusé ; réactivation (désarchiver) réservée à l’assureur', async () => {
      const proposee = { ...fixture('adherent', 'archiver'), statut: 'PROPOSE_SORTANT' };
      const s1 = service(proposee, 'SOCIETE_ADMINISTRATION', {}, { societeId: 'soc-1' });
      expect((await s1.s.verifier(USER, 'adherent', 'x-1', 'archiver')).raison).toContain('sa sortie est déjà proposée');
      const s2 = service(fixture('adherent', 'desarchiver'), 'SOCIETE_ADMINISTRATION', {}, { societeId: 'soc-1' });
      expect((await s2.s.verifier(USER, 'adherent', 'x-1', 'desarchiver')).raison).toContain("réservée à l'assureur");
      expect((await verifier('adherent', 'desarchiver', 'ASSUREUR_EXPLOITATION')).possible).toBe(true);
    });

    it('déjà radié : archiver et modifier refusés ; non radié : désarchiver refusé', async () => {
      const radie = fixture('adherent', 'desarchiver');
      expect((await verifier('adherent', 'archiver', 'ASSUREUR_EXPLOITATION', {}, radie)).raison).toContain('déjà archivé');
      expect((await verifier('adherent', 'modifier', 'ASSUREUR_EXPLOITATION', {}, radie)).raison).toContain('réactivez-le');
      expect((await verifier('adherent', 'desarchiver', 'ASSUREUR_EXPLOITATION', {}, fixture('adherent', 'archiver'))).raison).toContain("n'est pas radié");
    });
  });

  describe('invitations : renvoyer une nouvelle invitation (désarchiver) sans jamais supprimer', () => {
    const inv = (statut: string, extra: Record<string, unknown> = {}) => ({ ...fixture('invitation', 'archiver'), statut, expireLe: new Date(Date.now() + 3600_000), remplaceePar: null, ...extra });

    it('REVOQUEE et EXPIREE (statut, ou échéance dépassée) : renvoi possible', async () => {
      expect((await verifier('invitation', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, inv('REVOQUEE'))).possible).toBe(true);
      expect((await verifier('invitation', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, inv('EXPIREE'))).possible).toBe(true);
      expect((await verifier('invitation', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, inv('EN_ATTENTE', { expireLe: new Date(Date.now() - 1000) }))).possible).toBe(true);
    });
    it('EN_ATTENTE valide, ACCEPTEE, REJETEE : refusé ; déjà remplacée : refusé ; jamais supprimable', async () => {
      for (const statut of ['EN_ATTENTE', 'ACCEPTEE', 'REJETEE']) {
        const v = await verifier('invitation', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, inv(statut));
        expect(v.raison).toBe('Renvoi impossible : seule une invitation révoquée ou expirée peut être renvoyée.');
      }
      expect((await verifier('invitation', 'desarchiver', 'ASSUREUR_INFORMATIQUE', {}, inv('REVOQUEE', { remplaceePar: 'inv-2' }))).raison).toContain('déjà été remplacée');
      expect((await verifier('invitation', 'supprimer', 'ASSUREUR_INFORMATIQUE', {}, inv('REVOQUEE'))).possible).toBe(false);
    });
  });
});
