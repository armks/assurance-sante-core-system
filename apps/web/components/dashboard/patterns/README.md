# `components/dashboard/patterns/` — briques des écrans de gestion

Composants réutilisables pour **tous** les écrans de gestion (souscripteurs,
produits, polices, cotisations, établissements, pharmacies, utilisateurs…).
Construits sur `components/ui/*` (shadcn). À réemployer, pas à redévelopper.

Import : `import { DataTable, StatutBadge, FormulaireModal, ... } from '@/components/dashboard/patterns';`

---

## `StatutBadge`

Badge coloré ; tonalité **déduite** du jeton (ACTIF/PUBLIE/HOMOLOGUE → vert,
BROUILLON/EN_ATTENTE/SUSPENDUE → ambre, RESILIE/EXPIRE/ARCHIVE… → rouge/gris).
Surchargeable par `map` (statut → tonalité) ou `libelles` (statut → texte).

```tsx
<StatutBadge statut={produit.statut} />          {/* BROUILLON | PUBLIE | ARCHIVE  */}
<StatutBadge statut={org.statut} map={{ ACTIVE: 'succes', SUSPENDUE: 'danger' }} />
<StatutBadge statut={s.type} ton="info" />        {/* ENTREPRISE / COLLECTIVITE ... */}
```

## `CarteResume` / `GrilleCartes`

```tsx
<GrilleCartes>
  <CarteResume libelle="Souscripteurs" valeur={128} icon={Building2} />
  <CarteResume libelle="Entreprises" valeur={72} indice="+8 ce mois" tonIndice="positif" />
</GrilleCartes>
```

## `DataTable`

Recherche plein texte, filtres `select`, tri, **pagination** (`parPage`, défaut 10),
**état de chargement** (`chargement`), état vide. Tout est client-side.

```tsx
'use client';
<DataTable
  donnees={souscripteurs}
  cleLigne={(s) => s.id}
  chargement={false}
  parPage={10}
  recherche={{ placeholder: 'Nom, secteur…', champs: ['nom', 'secteurActivite'] }}
  filtres={[{ cle: 'type', libelle: 'Type', options: [
    { valeur: 'ENTREPRISE', libelle: 'Entreprise' },
    { valeur: 'COLLECTIVITE', libelle: 'Collectivité' },
    { valeur: 'INDIVIDUEL', libelle: 'Individuel' },
  ]}]}
  colonnes={[
    { cle: 'nom', entete: 'Nom', triable: true },
    { cle: 'type', entete: 'Type', rendu: (s) => <StatutBadge statut={s.type} ton="info" /> },
    { cle: 'createdAt', entete: 'Créé le', triable: true,
      rendu: (s) => new Date(s.createdAt).toLocaleDateString('fr-FR') },
  ]}
  actions={<FormulaireModal titre="Nouveau souscripteur" onSoumettre={creer}>…</FormulaireModal>}
  actionLigne={(s) => <Button asChild size="xs" variant="ghost"><Link href={`…/${s.id}`}>Détails</Link></Button>}
  vide="Aucun souscripteur."
/>
```

Chemins imbriqués : `cle: 'licence.plan'`.

## `FormulaireModal` + `Champ*`

Drawer à droite (`mode="right"`, défaut — plein écran sur mobile) ou modale
(`mode="center"`). `onSoumettre(formData)` renvoie `{ ok }` :
succès → ferme + réinitialise + `onSucces()` ; échec → affiche `error` **et la liste
`erreurs`** (messages de validation NestJS / class-validator).

```tsx
<FormulaireModal
  titre="Nouveau souscripteur"
  onSoumettre={async (fd) => creerSouscripteur(Object.fromEntries(fd))}
  onSucces={() => router.refresh()}
>
  <ChampTexte name="nom" label="Nom" required />
  <ChampSelect name="type" label="Type" required options={[…]} />
  <ChampNombre name="effectifDeclare" label="Effectif" min={1} />
</FormulaireModal>
```

Champs **dynamiques** : mettre `children` dans un petit composant client avec
`useState` sur le type sélectionné (`onChange` du `ChampSelect`), afficher les
champs du segment correspondant.

La server action (`'use server'`) fait l'`apiFetch` vers NestJS, `revalidatePath`,
et renvoie `{ ok:false, error, erreurs }` à partir du corps `{ message }` de l'API.

## `ConfirmationAction` — suppression, archivage, désarchivage (ADR-007) et décisions sur un tarif proposé (ADR-008)

**Seul** composant de confirmation de ces actions : ne pas en réécrire un par écran, ni
supprimer en un clic.

```tsx
import { ConfirmationAction } from '@/components/dashboard/patterns';
import { verifierAction } from '@/app/dependances-actions';

<ConfirmationAction
  action="supprimer"                                    // 'supprimer' | 'archiver' | 'desarchiver' | 'valider' | 'refuser'
  element={`l’acte « ${a.code} — ${a.libelle} »`}      // élément NOMMÉ, avec son type
  consequence="Il ne pourra plus être importé."          // optionnel : effet de l'action
  verifier={() => verifierAction('acteNational', a.id, 'supprimer')}
  onConfirmer={() => supprimerItemNational('actes', a.id)} // server action → { ok } | { ok: false; error }
  onSucces={() => router.refresh()}
  // declencheur={<Button size="xs" variant="ghost">Supprimer</Button>}  (défaut)
/>
```

- **À l'ouverture**, `verifier` interroge le serveur (`GET /api/v1/dependances/:entite/:id/:action`) :
  action impossible → la raison du serveur s'affiche **avec les nombres** (« lié à
  3 dossiers de soins et 1 tarif conventionné. Archivez-le plutôt. ») et seul « Fermer »
  reste ; possible → « Voulez-vous vraiment supprimer l'acte « … » ? Cette action est
  définitive. ».
- **Le serveur reste juge** : un refus survenu entre-temps (409) s'affiche tel quel dans la
  boîte, qui reste ouverte.
- `entite` = clé du registre des dépendances (`apps/api/src/dependances/registre.ts` :
  `etablissement`, `pharmacie`, `tarif`, `souscripteur`, `adherent`, `beneficiaire`,
  `produit`, `garantie`, `police`, `referentielActe`, `medicament`, `acteNational`,
  `medicamentNational`, `utilisateur`, `evenement`, `compteFinancier`…).
- **Bouton** : ne l'afficher qu'aux rôles autorisés (comme les autres actions) ; pour
  n'afficher que les boutons possibles, demander les 4 verdicts en une fois
  (`GET /api/v1/dependances/:entite/:id`).
- Libellés des actions : `LIBELLE_ACTION` (Supprimer / Archiver / Désarchiver) ; le type et
  le nom de l'élément viennent de l'écran (libellés des tables existantes : catégories
  d'acte, statuts…), jamais un code brut.
- Modale centrée, bouton rouge pour « Supprimer », annoncée aux lecteurs d'écran
  (`Alerte`), en français.

### Décisions (valider / refuser) et motif obligatoire (lot barème 5)

`action="valider"` et `action="refuser"` réutilisent la même modale pour une DÉCISION métier (sans `verifier` : le serveur reste
juge). Pour un refus, passer `motif={{ libelle: 'Motif du refus', minimum: 5 }}` : le bouton reste désactivé tant que le motif est
trop court, et `onConfirmer(motif)` le reçoit. Une décision qui demande un MONTANT (ajuster) ou un CHOIX (ajouter à la convention)
passe par `FormulaireModal` + `Champ*`, pas par `ConfirmationAction`.

## Libellés accentués — règle (lot barème 6)

Un écran n'affiche **jamais** un code brut (`PROPOSE`, `FORFAIT`, `E016`…). Les libellés viennent de tables uniques :

| Table | Fichier |
|---|---|
| Règle d'origine du tarif, statut du tarif proposé, statut du tarif d'une ligne, codes de rejet (`E012`–`E017`) | `apps/web/lib/tarifs.ts` (`libelleDe(table, code)`) |
| Statut de convention, contexte, politique de dépassement, rôles | `apps/web/lib/conventions.ts` |
| Catégories d'acte | `apps/web/lib/categories-acte.ts` |

`libelleDe` renvoie une forme lisible (jamais le code) si une valeur n'est pas dans la table. Tout nouveau statut s'ajoute d'abord dans
la table, puis dans l'écran.
