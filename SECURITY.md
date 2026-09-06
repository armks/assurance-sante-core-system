# Sécurité — notes et décisions

Ce fichier consigne les décisions de sécurité qui, sans trace écrite, seraient
re-triées à chaque `npm install`. Ajouter, ne pas réécrire l'historique.

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
