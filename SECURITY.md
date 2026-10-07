# Sécurité — notes et décisions

Ce fichier consigne les décisions de sécurité qui, sans trace écrite, seraient
re-triées à chaque `npm install`. Ajouter, ne pas réécrire l'historique.

> Décisions d'architecture qui s'écartent d'une règle du skill (verrou de
> plafond, RLS *deny-by-default* sur `profils`/`organisations`, référence unique
> des grants `svc_adjudication`) : voir **`ARCHITECTURE-DECISIONS.md`**.

---

## 2026-09-06 — `npm audit` : 3 vulnérabilités « high » (deepmerge-ts) — ACCEPTÉES

### Décision

**Acceptées, non corrigées.** Ne **pas** lancer `npm audit fix`. Aucune action
de code. Réexamen conditionné (voir plus bas).

### Les 3 findings = 1 seule vulnérabilité

| Paquet | Rôle dans le finding |
|---|---|
| `deepmerge-ts@7.1.5` | **La vulnérabilité réelle** — [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), severity high. Épuisement de pile (déni de service) lors du merge d'un graphe d'objets récursif / circulaire. Corrigé dans `deepmerge-ts@8.0.0`. |
| `@prisma/config` | Flaggé uniquement parce qu'il dépend de `deepmerge-ts@7.1.5` (pin exact) |
| `prisma` | Flaggé uniquement parce qu'il dépend de `@prisma/config` |

Chaîne de dépendance :
`deepmerge-ts@7.1.5` ← `@prisma/config@6.19.3` ← `prisma@6.19.3`
(devDependency de `apps/api` ; également *optional peer* de `@prisma/client`).

### Analyse d'impact — aucune exposition en production

- **`prisma` est une devDependency** : c'est la CLI (`generate`, `migrate`,
  `db pull`, `studio`). Elle apparaît aussi sous `npm audit --omit=dev`
  uniquement parce que `@prisma/client` la déclare en *optional peer*
  (`peerOptional prisma@"*"`) — ce qui signifie « non chargée à l'exécution ».
- Vérifié dans `node_modules/@prisma/client/runtime/*` : **aucun
  `require('@prisma/config')` ni `require('deepmerge-ts')`**. La seule
  correspondance textuelle est un bloc de métadonnées `package.json` inerte
  embarqué dans le bundle. Le `PrismaService` du backend utilise le client
  généré + le binaire natif du query engine ; ni l'un ni l'autre ne touche
  `deepmerge-ts`.
- `@prisma/config` + `deepmerge-ts` ne s'exécutent que lorsque la CLI Prisma
  fusionne un fichier `prisma.config.ts` — une étape locale / CI sur **notre
  propre** configuration. Ce dépôt **n'a pas** de fichier `prisma.config.ts`.
- La vulnérabilité elle-même exige de fournir à `deepmerge` un objet
  délibérément circulaire en entrée. Non atteignable depuis une entrée non
  fiable dans la configuration actuelle.

### Pourquoi pas `npm audit fix`

- Le dry-run **rétrograde `prisma` 6.19.3 → 6.12.0** (retire 24 paquets, en
  change 7) tout en laissant `@prisma/client` en 6.19.3.
- Prisma exige que `prisma` et `@prisma/client` soient **exactement la même
  version** — cet écart casse `prisma generate` et provoque des erreurs de
  version d'engine.
- Et `npm audit` reporte **toujours** les 3 « high » après le fix simulé.
- Aucune version corrigée n'existe dans la ligne 6.x : chaque `prisma@6.19.x`
  épingle `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5`.

### Pourquoi pas un `overrides` deepmerge-ts@^8

Testé le 2026-09-06 : npm refuse d'appliquer l'override par-dessus le pin exact
`7.1.5` de `@prisma/config` sans réinstallation propre complète, et
`deepmerge-ts@8` est une version majeure (semver) pour laquelle
`@prisma/config@6.19` n'a pas été écrit — risque réel de casser le chargement
de configuration. Sans effet utile de toute façon (chemin de code mort ici).

### Correctif réel

`deepmerge-ts >= 8` n'est livré qu'avec **Prisma 8**. Au 2026-09-06, le tag npm
`latest` de `prisma` est `8.0.0-rc.13` — une *release candidate*, et une montée
de version majeure.

### Conditions de réexamen (l'une OU l'autre déclenche une réévaluation)

1. **Prisma 8 stable** — dès qu'une version `8.x` **stable** (pas `-rc`, pas
   `-dev`, pas `-beta`) est publiée sous le tag `latest`. Alors : planifier la
   montée `prisma` + `@prisma/client` en 8.x (guide de migration majeure),
   vérifier que `deepmerge-ts` passe en `>= 8`, relancer `npm audit`.

2. **Changement du modèle de confiance de l'exécution de `prisma generate`** —
   dès que **l'une** de ces situations se présente :
   - le dépôt accepte des **contributions externes** (PR de personnes hors
     équipe cœur) qui pourraient toucher `prisma.config.ts`, le `schema.prisma`,
     ou des scripts npm ;
   - une **CI/CD** exécute `prisma generate` / `migrate` / `db pull` sur du code
     **non revu au préalable** (ex. workflow déclenché sur `pull_request` depuis
     un fork, avant approbation d'un mainteneur) ;
   - un fichier `prisma.config.ts` est ajouté au dépôt et son contenu peut être
     influencé par une source non entièrement fiable.

   Dans ces cas, le chemin de code `@prisma/config` → `deepmerge-ts` devient
   potentiellement atteignable avec une entrée hostile : la vulnérabilité
   redevient pertinente et doit être corrigée (montée de version, override
   validé, ou exécution de `prisma generate` uniquement après approbation
   humaine / dans un environnement isolé).

### État figé au moment de la décision

- `prisma` : `6.19.3` (devDependency `apps/api`)
- `@prisma/client` : `6.19.3` (dependency `apps/api`)
- `deepmerge-ts` : `7.1.5` (transitif)
- `npm audit` : 3 high, 0 critical / moderate / low
- Pas de fichier `prisma.config.ts` dans le dépôt
- Pas de CI/CD configurée ; dépôt privé, pas de contributions externes

---

## 2026-09-09 — Smart App Control (Windows 11) bloque les binaires natifs — contournements

### Contexte

Sur la machine de dev, **Smart App Control** (SAC) est activé en mode *enforce*
(`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 1`,
Policy ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`). SAC refuse de charger tout
binaire natif (`.dll`, `.node`) non signé au niveau « Enterprise » / non réputé.

Ça a cassé successivement, **en cours de développement** (SAC s'est durci après
les premiers prompts) :

| Binaire bloqué | Symptôme | Contournement retenu |
|---|---|---|
| `git-remote-https` → `libcurl-4.dll` | `git push/fetch` HTTPS en échec | Remote passé en **SSH** (`ssh.exe` est signé Microsoft) |
| `@next/swc-win32-x64-msvc/*.node` | Next.js SWC natif | **Fallback WASM automatique** de Next (plus lent, warnings) |
| `@tailwindcss/oxide-*/*.node` | Moteur Tailwind **v4** — pas de fallback WASM auto | **Rétrogradation `apps/web` en Tailwind v3** (100 % JS, zéro binaire natif) |

### Décisions

1. **git : transport SSH** — `git remote set-url origin git@github.com:...`.
   HTTPS git reste inutilisable tant que SAC est actif.
2. **`apps/web` : Tailwind CSS v3** (`^3.4.17`) au lieu de v4. `postcss.config.mjs`
   utilise `tailwindcss` + `autoprefixer` ; `tailwind.config.ts` porte les tokens
   shadcn (base neutral, HSL). shadcn/ui est né sur v3 → aucune perte.
   Ne **pas** repasser en Tailwind v4 sur cette machine sans désactiver SAC.
3. **`apps/web` : builds en Webpack** — `next build --webpack` / `next dev --webpack`
   (Turbopack exige les bindings natifs ; le fallback WASM ne lui suffit pas).

### Conditions de réexamen

- **SAC désactivé** (Paramètres → Sécurité Windows → Contrôle des applications
  et du navigateur — opération **irréversible** sans réinitialisation de Windows) :
  alors on peut revenir à git HTTPS, Turbopack, et éventuellement Tailwind v4.
- **Nouvelle machine de dev / CI Linux** : SAC ne s'applique pas ; les binaires
  natifs se chargent normalement. Tailwind v3 reste toutefois un choix valide et
  n'a pas besoin d'être annulé dans l'urgence.

### État figé

- git remote : SSH
- `apps/web` : Next 16 (webpack), Tailwind 3.4.x, PostCSS + autoprefixer
- `@next/swc` : fallback WASM (natif bloqué, non requis)
- `apps/api` : non affecté (pas de binaire natif ; Prisma query engine = exécutable
  séparé lancé en child process, pas un `.node` chargé en direct — fonctionne)

---

## 2026-10-07 — Incident : paramètre de filtre client écrasant le périmètre (fuite inter-société)

### Constat
Découvert le 2026-10-07 par le test HTTP réel de l'audit des filtres (commit `d6912b7`).
Dans `AdherentService.listerAdherents` (`GET /api/v1/member/adherents`), le `where`
Prisma était construit par étalements successifs : le périmètre société
(`souscripteurId = societeId` du token) puis le filtre client
(`souscripteurId` de la requête). Le second écrasait le premier.

**Impact** : tout compte `SOCIETE_AFFILIEE` (administration, assurée, comptable,
réception) pouvait lire le fichier des adhérents d'une autre société cliente de la
**même** organisation en passant `?souscripteurId=<autre société>` (noms, n°
d'adhérent, n° de carte, police, formule, nombre de bénéficiaires). Pas de fuite
inter-organisation (`organisationId` toujours imposé). Le web n'envoyait jamais ce
paramètre : il fallait forger la requête.

### Correctif (`d6912b7`)
- Les périmètres dérivés du token (société, adhérent) sont étalés **après** les
  filtres client : ils les écrasent toujours.
- `ListerAdherentsQueryDto` : `statut` en liste blanche, `souscripteurId` UUID, `q` ≤ 100.
- Test unitaire dédié (`adherent.service.spec.ts` : « un souscripteurId fourni par
  une société n'élargit jamais son périmètre ») ; test HTTP réel à deux sociétés.

### Règle
Un paramètre envoyé par le client (`souscripteurId`, `organisationId`,
`etablissementId`, `adherentId`, `policeId`…) ne remplace ni n'élargit jamais le
périmètre dérivé du token. Le périmètre est appliqué **après** les filtres client
(même clé), ou sur une **clé distincte** (relation, `AND` SQL) pour être en
intersection, ou le paramètre est vérifié (`assert…DansPerimetre`, 403/404).

### Audit de tous les endpoints de liste et de recherche (2026-10-07)
27 groupes d'endpoints GET acceptant un paramètre client (query ou chemin). Les
autres GET sont des fiches détail ou des listes sans paramètre client.

| Endpoint | Paramètres client | Périmètre (token) | Verdict |
|---|---|---|---|
| `member/adherents` | statut, souscripteurId, q | org + société + adhérent | **Vulnérable → corrigé** (`d6912b7`) |
| `member/recherche-carte` | numeroCarte | org, rôle accueil | OK |
| `member/adherents/:id/beneficiaires` | id | `chargerAdherent` org + société + adhérent | OK |
| `member/souscripteurs/:souscripteurId/brouillon-adherents` | souscripteurId | `societeId === souscripteurId` sinon 403 | OK |
| `billing/grilles-tarifaires` | produitId, souscripteurId | org, ASSUREUR | OK |
| `billing/cotisations` | statut, policeId | org + société sur la relation `police` | OK |
| `billing/polices/:policeId/cotisations` | policeId | `chargerPoliceLecture` org + société | OK |
| `billing/souscripteurs/:souscripteurId/adherents-facturation` | souscripteurId, periode | org, rôles comptable/informatique assureur | OK |
| `care-episode/dossiers` | statut, etablissementId | org ; centre médical : établissement du token appliqué après | OK |
| `claims/reclamations` | statut | org + société + adhérent | OK |
| `contestation/actes-a-examiner`, `ordonnances-a-examiner` | q, période, contestation, catégorie, page | org (`AND` SQL), rôles conseil | OK |
| `pharmacy/prescriptions/rechercher-par-carte` | numeroCarte | org, rôle pharmacie | OK |
| `pharmacy/dispensations` | q, statut, période, page | `pharmacieId` du token | OK |
| `pharmacy/dispensations/mes-dispensations` | statut, période | adhérent + bénéficiaires | OK |
| `preauthorization/codes-consultation`, `codes-ordonnance`, `codes-facturation` | statut, période, page | adhérent + bénéficiaires | OK |
| `plan/produits` | statut, nom | org | OK |
| `policy/polices` | statut, souscripteurId | org ; hors assureur : société du token, paramètre ignoré | OK |
| `policy/polices/:id/avenants` | id | `chargerPolice` org + société | OK |
| `provider/recherche` | lat, lng, rayonKm, cible | org | OK |
| `provider/etablissements`, `provider/pharmacies` | type, statut, ville | org | OK |
| `provider/{etablissements,pharmacies}/:id/{verifications,tarifs}` | id | `assert…DansPerimetre` org | OK |
| `reference/actes`, `reference/medicaments` | statut, essentiel | org | OK |
| `reference/catalogue-national/*`, `superadmin/catalogue-national/*` | statut | catalogue national partagé (par conception) | OK |
| `tenant/souscripteurs` | type | org, ASSUREUR | OK |
| `tenant/souscripteurs/:id/membres-comite` | id | org, ASSUREUR | OK |
| `underwriting/questionnaires` | decision, souscripteurId | médecin : org (relation) ∩ souscripteurId ; souscripteur : `societeId` du token, paramètres ignorés | OK |
| `public/statistiques`, `public/evenements` | organisation | public sans token (vitrine) | Hors classe |

**Vérification HTTP réelle (deux sociétés S1/S2, deux établissements E1/E2)** : la
société S1 demandant les données de S2 reçoit uniquement S1 (`member/adherents`,
`policy/polices`, `billing/cotisations`, `underwriting/questionnaires`) ou 403/404
(`brouillon-adherents`, `beneficiaires`, `polices/:id/cotisations`, `avenants`) ;
le centre E1 demandant E2 reçoit uniquement E1. Témoins assureur : les données de
S2 existent et lui sont visibles. Données de test supprimées.
