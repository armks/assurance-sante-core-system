# Déploiement — ordre des migrations et vérifications

## Migrations SQL (`apps/api/prisma/sql/`)

- Les fichiers sont **numérotés** (`NNN_nom.sql`) et **idempotents** (rejouables sans erreur), mais ils doivent toujours
  être appliqués **dans l'ordre numérique**.
- Appliquer : `cd apps/api && node prisma/appliquer-sql.cjs --depuis <NNN>` (tous les fichiers à partir de NNN, dans
  l'ordre) ou `node prisma/appliquer-sql.cjs <fichier.sql>` (un seul).
- Après un changement de `schema.prisma` : arrêter tous les processus Node, `npx prisma generate`, puis relancer.
- **Ne jamais rejouer une ancienne migration seule après une plus récente.** Plusieurs fonctions sont redéfinies
  (`CREATE OR REPLACE FUNCTION`) par des migrations successives ; la dernière définition doit rester la dernière appliquée :

| Fonction | Définie par (dans l'ordre) | Version à jour |
|---|---|---|
| `lignes_facturation_tarif_fige()` | `082_resolution_tarif_trace.sql` puis `083_tarifs_proposes.sql` | 083 (trace provisoire remplaçable une fois, quantité et tarif proposé figés) |

  Constat du lot 4 : rejouer 082 après 083 retirait l'exception de la trace provisoire et faisait échouer la
  réintégration d'une ligne (HTTP 500). Si cela arrive : réappliquer 083 (`node prisma/appliquer-sql.cjs 083_tarifs_proposes.sql`).
- **Vérification automatique** : `npm run test:integration` (apps/api) contient `migrations-etat.int-spec.ts`, qui contrôle
  que les fonctions, triggers et contraintes partagés sont dans leur dernier état et que l'ordre des fichiers garde la plus
  récente définition en dernier. À lancer après chaque déploiement de migrations.

## Droits du rôle `svc_adjudication`

Source de vérité : ADR-003 (`ARCHITECTURE-DECISIONS.md`). Les migrations 080, 082 et 083 accordent des droits par
**colonnes** ; après déploiement, `information_schema.column_privileges` doit correspondre à l'ADR-003.

## Services

1. Base : migrations (ci-dessus).
2. Microservice Java : `cd adjudication-service && mvn -o package -DskipTests`, redémarrer avec les variables de `.env`.
3. API NestJS puis web.
4. Contrôles : `npm test` (apps/api), `mvn -o test` (adjudication-service), `npm run test:integration` (apps/api).

## Tâches manuelles (dette : aucun planificateur automatique)

- `POST /api/v1/billing/cotisations/marquer-en-retard` — passage des cotisations en retard.
- `POST /api/v1/tarifs-proposes/rappels` — rappel à J+2 (médecin conseil) et escalade à J+5 (direction) des tarifs proposés
  non décidés ; délais dans les paramètres de plateforme `tarif_propose_rappel_jours` et `tarif_propose_escalade_jours`.
  À brancher sur un planificateur (cron / tâche planifiée) : dette notée dans l'ADR-008.
