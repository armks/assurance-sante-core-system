---
name: health-insurance-core-ui
description: >
  Conventions OBLIGATOIRES pour construire un écran de gestion du frontend Next.js de
  l'assurance santé (apps/web). Charger ce skill dès qu'une tâche demande de créer ou
  modifier une page de dashboard : liste, tableau, formulaire de création/édition, vue
  détail, badges de statut, cartes de synthèse — pour les rôles ASSUREUR (informatique,
  direction, comptable, médecin/pharmacien conseil), le SUPERADMIN, ou tout futur
  dashboard. Impose la réutilisation des briques components/dashboard/patterns/
  (DataTable, StatutBadge, FormulaireModal, Champ*, CarteResume, GrilleCartes) plutôt
  que de redévelopper, et le découpage page.tsx (server) / *-ecran.tsx (client) /
  actions.ts (server actions). Ne PAS utiliser pour le backend NestJS/Prisma/SQL/RLS
  (voir le skill assurance-sante-core-system).
---

# UI des écrans de gestion — `components/dashboard/patterns/`

Briques réutilisables construites sur `components/ui/*` (shadcn). **On les réemploie,
on ne les redéveloppe pas.** Elles couvrent tous les écrans de gestion (souscripteurs,
produits, polices, cotisations, catalogue national, santé système…).

```tsx
import {
  DataTable, StatutBadge, FormulaireModal, GrilleCartes, CarteResume, ConfirmationAction,
  Champ, ChampTexte, ChampNombre, ChampZone, ChampSelect, ChampCheckbox,
  type ColonneTable, type FiltreSelect, type ResultatSoumission, type OptionChamp,
} from '@/components/dashboard/patterns';
```

## Découpage d'un écran — 3 fichiers

| Fichier | Directive | Rôle |
|---|---|---|
| `app/<section>/<ecran>/page.tsx` | server (défaut) | `apiFetch` les données, `<PageTitre>`, passe les données au composant client. Gère l'erreur (`messageErreur`). |
| `components/dashboard/<ecran>-ecran.tsx` | `'use client'` | `GrilleCartes` + `DataTable` + `FormulaireModal`. `useRouter().refresh()` après mutation. |
| `app/<section>/<ecran>/actions.ts` | `'use server'` | server actions : `apiFetch` vers NestJS + `revalidatePath` + renvoie `ResultatSoumission`. |

Vue détail : `app/<section>/<ecran>/[id]/page.tsx` (server, `notFound()` si 404) +
`components/dashboard/<ecran>-detail.tsx` (client).

**Un fichier `'use server'` ne peut exporter que des fonctions `async`.** Tout type
partagé (ex. la forme d'une réponse d'API) va dans un `types.ts` voisin, importé
en `import type`.

## `page.tsx` (server) — squelette

```tsx
import type { Metadata } from 'next';
import { PageTitre } from '@/components/page-titre';
import { MonEcran, type MonType } from '@/components/dashboard/mon-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Titre — Section' };

export default async function Page() {
  const res = await apiFetch('/api/v1/<module>/<ressource>');
  const donnees: MonType[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  return (
    <div className="space-y-8">
      <PageTitre titre="Titre" description="…" />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <MonEcran donnees={donnees} />}
    </div>
  );
}
```

## `actions.ts` (server actions) — squelette

```tsx
'use server';
import { revalidatePath } from 'next/cache';
import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/<ecran>';

export async function creer(input: { nom: string }): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/<module>/<ressource>', {
    method: 'POST', body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) }; // → error + erreurs[]
  revalidatePath(CIBLE);
  return { ok: true, message: 'Créé.' };
}
```

`detailErreur(res)` → `{ error, erreurs[] }` (la liste = messages class-validator de
NestJS, affichée telle quelle par `FormulaireModal`). `messageErreur(res)` → une string
simple, pour les actions sans formulaire (`{ ok } | { ok:false; error }`).

---

## `GrilleCartes` / `CarteResume`

Rangée de chiffres-clés en tête d'écran (`grid` responsive intégré).

```tsx
<GrilleCartes>
  <CarteResume libelle="Produits" valeur={produits.length} icon={Package} />
  <CarteResume libelle="Publiés" valeur={n} indice="+3 ce mois" tonIndice="positif" />
  <CarteResume libelle="Reste à encaisser" valeur="4 800 F" href="/…/cotisations" />
</GrilleCartes>
```

Props : `libelle`, `valeur` (ReactNode), `indice?`, `icon?` (LucideIcon),
`tonIndice?: 'neutre'|'positif'|'negatif'`, `href?`.

## `StatutBadge`

Badge coloré. **Tonalité déduite du jeton** : `ACTIF/ACTIVE/PUBLIE/HOMOLOGUE/OUVERT/PAYEE…`
→ vert ; `BROUILLON/EN_ATTENTE/EMIS/SUSPENDUE/DEVIS…` → ambre ;
`RESILIE/EXPIRE/ANNULE/RETIRE/NON_RENOUVELEE…` → rouge ; `CLOTURE/ARCHIVE/RENOUVELEE…` → gris.

```tsx
<StatutBadge statut={produit.statut} />                              {/* auto */}
<StatutBadge statut={p.statut} libelles={LIBELLE_POLICE} />          {/* texte custom */}
<StatutBadge statut={p.statut} map={TON_POLICE} libelles={LIBELLE_POLICE} /> {/* + tonalité forcée par jeton */}
<StatutBadge statut={s.type} ton="info" libelle="Entreprise" />      {/* tonalité + libellé fixes */}
```

Props : `statut` (requis), `ton?: 'succes'|'attention'|'danger'|'info'|'neutre'`,
`map?: Record<statut, ton>`, `libelle?: string`, `libelles?: Record<statut, string>`.
Quand les libellés/tonalités sont partagés entre la liste et le détail, les exporter
depuis le `*-ecran.tsx` (ex. `export const TON_POLICE`, `LIBELLE_POLICE`).

## `DataTable`

Recherche plein texte, filtres `select`, tri par colonne, **pagination** (`parPage`,
défaut 10 ; `0` = pas de pagination), **état de chargement** (`chargement`), état vide.
Tout est **client-side** (les données arrivent déjà chargées du server component).

```tsx
'use client';
const colonnes: ColonneTable<Souscripteur>[] = [
  { cle: 'nom', entete: 'Nom', triable: true },
  { cle: 'type', entete: 'Type', rendu: (s) => <StatutBadge statut={s.type} ton="info" /> },
  { cle: 'montant', entete: 'Montant', aligneDroite: true,
    valeur: (s) => Number(s.montant),                       // tri/recherche numériques
    rendu: (s) => `${Number(s.montant).toLocaleString('fr-FR')} F` },
  { cle: 'createdAt', entete: 'Créé le', triable: true,
    valeur: (s) => s.createdAt,
    rendu: (s) => new Date(s.createdAt).toLocaleDateString('fr-FR') },
];

<DataTable
  donnees={souscripteurs}
  cleLigne={(s) => s.id}
  parPage={10}
  recherche={{ placeholder: 'Nom, secteur…', champs: ['nom', 'souscripteur.nom'] }}  // chemins a.b OK
  filtres={[{ cle: 'type', libelle: 'Type', options: [
    { valeur: 'ENTREPRISE', libelle: 'Entreprise' },
    { valeur: 'COLLECTIVITE', libelle: 'Collectivité' },
  ]}]}
  colonnes={colonnes}
  actions={<FormulaireModal titre="Nouveau souscripteur" onSoumettre={creer}>…</FormulaireModal>}
  actionLigne={(s) => (
    <Button asChild size="xs" variant="ghost">
      <Link href={`/…/souscripteurs/${s.id}`}>Détails</Link>
    </Button>
  )}
  vide="Aucun souscripteur pour l’instant."
/>
```

`ColonneTable<T>` : `cle`, `entete`, `rendu?(row)`, `valeur?(row)` (valeur de tri /
recherche si différente de l'affichage — obligatoire pour trier des nombres ou des
dates rendues formatées), `triable?`, `aligneDroite?`, `className?`.
`filtres[].valeur?(row)` pour dériver la clé de filtre (ex. `souscripteurId ? 'NEGOCIE' : 'STANDARD'`).
`actionLigne` peut renvoyer `null` pour n'afficher l'action que sur certaines lignes.
Le générique est `T extends object` — passer des `interface` simples convient.

## `FormulaireModal` + `Champ*`

Drawer à droite (`mode="right"`, défaut — plein écran sur mobile) ou modale centrée
(`mode="center"`, pour un formulaire court / une confirmation). Se remonte à chaque
ouverture (les `defaultValue` se ré-appliquent).

`onSoumettre(formData)` → `ResultatSoumission` :
`{ ok:true; message? }` → ferme + `form.reset()` + `onSucces?()` ;
`{ ok:false; error; erreurs? }` → reste ouvert, affiche `error` + la liste `erreurs`.

```tsx
<FormulaireModal
  titre="Nouveau produit"
  description="Le produit est créé en brouillon."
  declencheurLabel="Nouveau produit"          // ou declencheur={<Button …/>} pour un bouton custom
  libelleSoumettre="Créer le brouillon"
  onSoumettre={async (fd) => creerProduit({ nom: String(fd.get('nom') ?? '') })}
  onSucces={() => router.refresh()}
>
  <ChampTexte name="nom" label="Nom du produit" required placeholder="Santé Essentiel" />
</FormulaireModal>
```

Champs (tous : `name` requis, `label`, `aide?`, + attributs `<input>`/`<select>`/`<textarea>` natifs) :

```tsx
<ChampTexte name="email" label="E-mail" type="email" required />
<ChampTexte name="dateDebut" label="Début" type="date" defaultValue="2026-01-01" />
<ChampNombre name="taux" label="Taux (%)" min={0} max={100} step="0.01" />
<ChampZone name="exclusions" label="Exclusions" aide="Une par ligne." />
<ChampSelect name="type" label="Type" required placeholder="Choisir…" options={[
  { valeur: 'ENTREPRISE', libelle: 'Entreprise' },
]} />
<ChampCheckbox name="subventionExterne" label="Bénéficie d’une subvention" />
```

Lecture dans `onSoumettre` : `fd.get('name')` (string) ; nombres →
`const v = fd.get('x'); const n = v === null || v === '' ? undefined : Number(v);` ;
zone multi-lignes → `String(fd.get('x') ?? '').split('\n').map(s => s.trim()).filter(Boolean)`.

### Champs dynamiques selon un choix

Mettre les `children` dans un petit composant client à état :

```tsx
function ChampsSouscripteur() {
  const [type, setType] = useState('ENTREPRISE');
  return (
    <>
      <ChampSelect name="type" label="Type" value={type}
        onChange={(e) => setType(e.target.value)} options={[…]} />
      {type === 'ENTREPRISE' && <ChampNombre name="effectifDeclare" label="Effectif" min={1} />}
      {type === 'COLLECTIVITE' && <ChampTexte name="organeGouvernance" label="Gouvernance" />}
    </>
  );
}
```

### Aperçu avant confirmation (calcul serveur)

Pour « afficher le détail avant de générer » (proratisation d'avenant, tarif de
cotisation…) : un bouton `type="button"` dans les `children` appelle une server action
de **simulation** (qui ne persiste rien) et affiche le résultat ; `onSoumettre` déclenche
ensuite la vraie création. Ne jamais recalculer côté client ce que l'API sait faire.

---

## `ConfirmationAction` — suppression, archivage, désarchivage (ADR-007) et décisions (ADR-008)

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

---

## Boutons d'action pilotés par l'API (machine à états)

Quand des boutons dépendent d'un statut courant (transitions de police, actions
d'homologation…), **ne pas coder en dur la liste côté frontend**. Exposer un endpoint
qui renvoie les actions valides depuis l'état courant (ex. `GET /policy/polices/:id/actions`)
et faire `actions.map((a) => <Button …>)`. Le frontend ne redéfinit jamais la machine
à états du backend — sinon les deux divergent.

Après publication / verrouillage (produit `PUBLIE`, police terminale…), retirer de l'UI
les boutons d'écriture (cohérent avec le `409` que l'API renverrait) plutôt que de les
désactiver silencieusement — sauf message explicite (« ajoutez une garantie pour publier »).

## Test — e2e navigateur réel

Script `.mjs` lancé **depuis `apps/web`** (pour résoudre `@supabase/ssr`) : login via
`createServerClient` + jar de cookies en mémoire, puis `fetch` de l'API (`Bearer`) et
des pages Next rendues (`cookie`). Comptes de test : voir le skill
`assurance-sante-core-system` / la mémoire. Nettoyer les données créées (SQL via
`prisma db execute`) et arrêter les serveurs après le test. Normaliser les espaces
insécables (` `, ` `) avant de comparer des montants formatés `fr-FR`.

## Rappels transverses

- `apiFetch` (server-only) porte le Bearer Supabase ; `apiFetchPublic` pour les parcours non authentifiés.
- Montants : `Number(v).toLocaleString('fr-FR')` + `' F'` ; `decimal.js` côté API, jamais côté UI.
- Après toute mutation : `router.refresh()` (client) et/ou `revalidatePath` (server action).
- `PageTitre` (titre, description?, action?) en tête de chaque page ; espacements `space-y-8` / `space-y-6`.
- Nouvelle section = ajouter l'entrée dans `lib/dashboard-nav.ts` (dashboards de rôle) ou
  `components/superadmin/shell.tsx` (superadmin).
- Doc vivante détaillée : `apps/web/components/dashboard/patterns/README.md`.

## Libellés du barème — jamais de code brut (ADR-008, lot 6)

Statuts de convention, règles d'origine du tarif (`FORFAIT`, `VALEUR_PROPRE`, `VALEUR_LETTRE_CLE`, `AUCUNE_CONVENTION`, `TARIF_PROPOSE`),
statuts du tarif proposé (`PROPOSE`, `VALIDE`, `AJUSTE`, `REFUSE`) et codes de rejet `E012`–`E017` s'affichent via les tables
`apps/web/lib/tarifs.ts` et `apps/web/lib/conventions.ts` (`libelleDe`). Décision avec motif obligatoire :
`ConfirmationAction action="refuser" motif={{ libelle, minimum: 5 }}` ; décision avec montant : `FormulaireModal`. Les écrans
d'établissement et de patient montrent le statut du tarif, le montant retenu et le motif du refus, et la mention « tarif en cours
d'examen » (part estimée à titre indicatif).
