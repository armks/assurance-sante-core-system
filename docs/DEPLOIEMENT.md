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
- Migrations récentes (toutes idempotentes) : 087 (mois d'effet des entrants), 088 (contacts des bénéficiaires), 089 (actes déclarés par l'accueil), 090 (référentiel = catalogue national :
  rattachement des lignes existantes ; **après 090, un assureur sans activation ne voit plus aucun acte ni médicament à la saisie** — activer depuis « Référentiel médical », ADR-009).
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

## Moniteur de santé `GET /api/v1/sante`

- Sonde de supervision **non authentifiée**, sans donnée sensible : `200` si l'API ET le microservice d'adjudication répondent
  (`statut: UP`), `503` sinon (`DOWN` ou `INJOIGNABLE`, avec la latence). À brancher sur le moniteur d'infrastructure (alerte si
  non-`UP` plus de 2 minutes). Le test d'intégration `factures-paralleles` la consulte avant de commencer.
- L'écran « Santé du système » du superadmin affiche le même état.

## Planificateur des rappels (à brancher — dette)

Aucun planificateur automatique n'est branché ; deux tâches sont déclenchables **à la main** (ou par une tâche planifiée appelant l'API
avec un compte de service) :

| Tâche | Appel | Fréquence recommandée |
|---|---|---|
| Passage des cotisations en retard | `POST /api/v1/billing/cotisations/marquer-en-retard` | quotidienne |
| Rappel J+2 / escalade J+5 des tarifs proposés | `POST /api/v1/tarifs-proposes/rappels` | quotidienne (matin) |

Les deux sont idempotentes (une proposition n'est rappelée qu'une fois, une cotisation n'est passée en retard qu'une fois). Exemple
(cron) : `0 7 * * * curl -fsS -X POST -H "Authorization: Bearer $JETON_SERVICE" https://<hôte>/api/v1/tarifs-proposes/rappels`.

## Tests d'intégration et redémarrages de l'API (mode watch)

L'API de développement (`npm run api:dev`) est en **mode watch** : une modification du code sous `apps/api` (et, constaté, certaines
créations / suppressions de fichiers du projet) la **redémarre**. Un test d'intégration lancé à ce moment échoue avec « Plateforme non
prête (…/sante → injoignable) » ou « fetch failed / ECONNRESET » : ce n'est PAS un défaut du verrou des plafonds (lot 6 : 3 échecs
observés sur ~60 exécutions, tous avec un redémarrage de l'API enregistré dans son journal, aucun avec un plafond dépassé).

Le test `factures-paralleles.int-spec.ts` distingue maintenant les deux cas : il attend que la plateforme soit prête, relève
`api.demarrageLe` (horodatage de démarrage du processus, exposé par `/api/v1/sante`) avant et après l'essai, et **rejoue l'essai
avec des données neuves seulement si l'API a redémarré pendant l'essai** (avertissement « API redémarrée pendant l'essai… »). Toute
autre erreur — notamment un plafond dépassé — est relancée sans rejeu : les assertions restent strictes.

Pour des exécutions de contrôle propres : lancer l'API sans watch (`npm run api:build` puis `node apps/api/dist/main`) ou ne rien
modifier sous `apps/api` pendant la suite.

## Chargement du catalogue national officiel

Voir `docs/CHARGEMENT-NGAMBCI.md` (modèle vide, procédure, retrait des données fictives) et `docs/DEPRECIATION-ANCIEN-CIRCUIT.md`
(plan de retrait de l'ancien circuit des tarifs).
