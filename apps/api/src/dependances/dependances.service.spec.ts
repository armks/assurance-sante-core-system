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
    produit: { nom: 'Formule', statut: 'BROUILLON' }, categorieActe: 'CONSULTATION', numeroPolice: 'POL-1', actif: !archive,
  };
  const statut: Record<string, string> = {
    organisation: archive ? 'ARCHIVEE' : 'ACTIVE',
    etablissement: archive ? 'RESILIE' : 'ACTIF',
    pharmacie: archive ? 'RESILIEE' : 'ACTIVE',
    referentielActe: action === 'supprimer' ? 'PROPOSE' : archive ? 'RETIRE' : 'HOMOLOGUE',
    acteNational: archive ? 'RETIRE' : 'HOMOLOGUE',
    produit: action === 'archiver' ? 'PUBLIE' : archive ? 'ARCHIVE' : 'BROUILLON',
    police: 'DEVIS',
    avenant: 'BROUILLON',
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
    count: jest.fn(async (args: unknown) => {
      appels.push(args);
      return valeurs[i++] ?? 0;
    }),
  };
  const db: any = new Proxy({}, {
    get: (_t, p) => (p === '$executeRaw' ? executeRaw : p === '$transaction' ? transaction : modele),
  });
  const executeRaw = jest.fn().mockResolvedValue(1);
  const transaction = jest.fn();
  return { db, appels, executeRaw, transaction };
}

function service(rec: unknown, role: string, valeurs: Record<number, number> = {}, profil: Record<string, unknown> = {}) {
  const base = baseFactice(rec, valeurs);
  const estSuperadmin = role === 'SUPERADMIN_PRINCIPAL';
  const identity = {
    getMe: jest.fn().mockResolvedValue({
      profil: { id: 'u-appelant', organisationId: estSuperadmin ? null : ORG, societeId: null, ...profil },
      permissions: { roleChain: [role] },
    }),
  };
  return { s: new DependancesService(base.db, identity as any), ...base };
}

describe('DependancesService — registre : chaque type de dépendance, pour chaque entité auditée', () => {
  for (const [entite, def] of Object.entries(REGISTRE)) {
    describe(entite, () => {
      def.dependances.forEach((d, index) => {
        const bloque = d.bloque ?? ['supprimer'];
        it(`« ${d.cle} » (1 ${d.singulier}) bloque ${bloque.join(', ')} — et aucune autre action`, async () => {
          for (const action of ACTIONS) {
            if (!def.regles[action]) continue; // action non disponible pour cette entité
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

  it('action non disponible pour l’entité (archiver une société cliente) → impossible, raison explicite', async () => {
    const { s } = service(fixture('souscripteur', 'archiver'), 'ASSUREUR_INFORMATIQUE');
    const v = await s.verifier(USER, 'souscripteur', 'x-1', 'archiver');
    expect(v.possible).toBe(false);
    expect(v.raison).toBe("Archivage impossible : cette action n'est pas encore disponible pour la société cliente.");
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
