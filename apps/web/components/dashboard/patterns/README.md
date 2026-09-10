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
