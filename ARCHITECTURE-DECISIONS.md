# Décisions d'architecture (ADR)

Décisions structurantes qui **s'écartent d'une règle écrite du skill** ou qui,
sans trace unique, seraient re-débattues à chaque revue. Ajouter, ne jamais
réécrire l'historique. Pour les décisions purement sécurité/outillage machine,
voir `SECURITY.md`.

---

## ADR-001 — Verrou de plafond : `pg_advisory_xact_lock` au lieu de `SELECT … FOR UPDATE`

**Date :** 2026-09-10 · **Statut :** acceptée · **Composant :** `adjudication-service/`

### Contexte

Le skill (`references/…`, règle « verrouillage pessimiste sur les plafonds »)
décrit littéralement un `SELECT … FOR UPDATE` sur la police pour sérialiser deux
adjudications concurrentes du même adhérent avant de calculer
`plafond_annuel − Σ(remboursements de l'année)`.

`FOR UPDATE` exige le privilège `UPDATE` **au niveau table** sur la ligne
verrouillée. Or le rôle `svc_adjudication` (voir ADR-003) n'a **volontairement
pas** `UPDATE` sur `polices` — il n'a `UPDATE` que sur `reclamations(statut)`.
Un `SELECT id FROM polices … FOR UPDATE` exécuté par ce rôle échoue
(`ERROR: permission denied`, remonté en « bad SQL grammar » côté JDBC).

### Décision

`JdbcAdjudicationRepository.verrouillerPourPlafond(UUID cle)` prend un
**verrou consultatif transactionnel** :

```sql
SELECT pg_advisory_xact_lock(hashtextextended(?, 0))
```

La clé est `adherent_id` quand il est présent, sinon `police_id` (fallback pour
un bénéficiaire non rattaché). Le verrou est relâché automatiquement à la fin de
la transaction (`@Transactional`), comme l'aurait été un `FOR UPDATE`.

### Conséquences

- **Équivalence fonctionnelle vérifiée** : deux soumissions simultanées du même
  acte sérialisent bien (test e2e Phase 7 — cumul annuel `480 000 → 465 600`,
  jamais de double comptage).
- Le verrou porte sur **l'adhérent**, pas sur la police — c'est même plus juste
  pour le plafond annuel, qui est par adhérent.
- Écart assumé avec la formulation littérale du skill. Ne PAS « corriger » vers
  `FOR UPDATE` sans d'abord accorder `UPDATE` sur `polices` à `svc_adjudication`
  — ce qui serait un sur-privilège non justifié.
- Contrainte de cohérence : tout code qui touche au plafond d'un adhérent depuis
  un autre chemin (ex. futur module `payment`) doit prendre le **même** verrou
  (`hashtextextended(adherent_id::text, 0)`) pour rester sérialisé avec
  l'adjudication.

---

## ADR-002 — RLS en lecture *deny-by-default* sur `profils` et `organisations`

**Date :** 2026-09-10 · **Statut :** acceptée · **Composant :** Supabase / Postgres

### Contexte

Règle transverse du skill : « RLS partout, défense en profondeur ». La lecture
de la plupart des tables a une policy `SELECT` qui filtre par
`organisation_id = (select organisation_id from profils where id = auth.uid())`.

Deux tables font exception **en lecture** :

| Table | Policies présentes | Lecture directe `authenticated` |
|---|---|---|
| `profils` | `INSERT` uniquement | **refusée** (aucune policy `SELECT`) |
| `organisations` | `organisations_service_role_only` (`service_role` seul) | **refusée** |

### Décision

C'est **intentionnel**, pas un oubli.

1. NestJS se connecte à Postgres via le pooler avec le rôle **`postgres`**
   (propriétaire des tables) → il **contourne la RLS** de toute façon. La couche
   d'autorisation applicative (`IdentityService`, chaîne de rôles, guards) est la
   défense primaire pour tout accès passant par l'API.
2. Un refus **total** en lecture directe est ici *plus* protecteur qu'une policy
   par `organisation_id` : si un jeton `authenticated` valide fuitait et était
   utilisé directement contre PostgREST/REST Supabase (hors NestJS), il ne
   pourrait **rien** lire de l'annuaire des comptes ni de la liste des
   organisations — pas même « seulement sa propre organisation ». Ces deux tables
   sont l'annuaire d'identité : la surface d'énumération qu'on veut nulle.
3. `profils` garde une policy `INSERT` (auto-provisioning du profil à la
   première connexion), et `organisations` reste accessible en écriture au
   `service_role` (back-office).

### Conséquences

- Aucun accès « direct DB » (PostgREST, client Supabase navigateur) ne doit
  jamais être conçu pour lire `profils` / `organisations` — tout passe par un
  endpoint NestJS.
- Si un jour une fonctionnalité front a besoin de lire l'annuaire sans NestJS,
  il faudra une policy `SELECT` explicite **restreinte à `organisation_id`**, et
  mettre à jour cet ADR — pas un simple `using (true)`.
- Écart de forme (pas de policy `SELECT`) assumé vis-à-vis de « RLS lisible
  partout » ; l'esprit de la règle (aucune fuite hors périmètre) est respecté
  *a fortiori*.

---

## ADR-003 — Grants de `svc_adjudication` : cette section est la **référence unique**

**Date :** 2026-09-10 · **Statut :** acceptée · **Composant :** Supabase / `adjudication-service/`

### Contexte

Le jeu de privilèges du rôle technique `svc_adjudication` (utilisé **uniquement**
par le microservice Java, jamais par une session utilisateur) a été construit en
plusieurs passes : `prisma/sql/018` (création + grants initiaux), `019` (ajout
`SELECT` sur `remboursements` pour le `RETURNING id`), `020` (`LOGIN` +
`SELECT(deleted_at)` sur `reclamations`). Recouper 3 migrations pour connaître
l'état réel est une source d'erreur.

### Décision

**L'état ci-dessous est la source de vérité.** Il a été relevé en base le
2026-09-10 (`pg_class.relacl` / `pg_attribute.attacl` / `pg_proc.proacl` /
`pg_roles`). Toute modification future doit être répercutée ici dans la même PR
que la migration SQL.

#### Attributs du rôle

```
LOGIN · BYPASSRLS · INHERIT
NOSUPERUSER · NOCREATEDB · NOCREATEROLE · NOREPLICATION
```

`BYPASSRLS` : le service lit des lignes de plusieurs organisations (il est
inter-tenant par nature) ; l'isolation est portée par la logique métier
(éligibilité police + garantie de la réclamation), pas par la RLS.
`LOGIN` : nécessaire à la connexion JDBC ; mot de passe hors dépôt
(`JDBC_PASSWORD`, `.env` gitignoré), jamais en dur.

#### Schéma

| Objet | Privilège |
|---|---|
| `SCHEMA public` | `USAGE` |

#### Tables — privilèges au niveau table

| Table | Privilèges |
|---|---|
| `garanties` *(= le « plan de couverture » ; table physique `garanties`)* | `SELECT` |
| `grilles_tarifaires` | `SELECT` |
| `medicaments` | `SELECT` |
| `polices` | `SELECT` |
| `referentiel_actes` | `SELECT` |
| `remboursements` | `INSERT` |

#### Tables — privilèges au niveau colonne (aucun privilège table associé)

| Table | Privilège | Colonnes |
|---|---|---|
| `reclamations` | `SELECT` | `id`, `organisation_id`, `dossier_soins_id`, `acte_dossier_id`, `adherent_id`, `beneficiaire_id`, `police_id`, `garantie_id`, `montant`, `type_reclamation`, `statut`, `created_at`, `deleted_at` *(13 colonnes)* |
| `reclamations` | `UPDATE` | `statut` *(uniquement)* |
| `remboursements` | `SELECT` | `id`, `reclamation_id`, `montant_rembourse`, `created_at` *(4 colonnes)* |

> `SELECT(id)` sur `remboursements` est requis par `INSERT … RETURNING id`
> (le `RETURNING` est évalué comme un `SELECT` sur les colonnes renvoyées).
> Les 3 autres colonnes servent au `Σ(remboursements de l'année)` par adhérent.

#### Fonctions

| Fonction | Privilège |
|---|---|
| `public.log_audit(text, text, uuid, uuid, jsonb)` | `EXECUTE` |

`log_audit` est `SECURITY DEFINER` (propriétaire `postgres`) : `svc_adjudication`
n'a donc **pas** besoin d'`INSERT` sur `audit_log` ni de `SELECT` sur `profils`.

#### Ce que le rôle ne peut PAS faire (invariants à préserver)

- Aucun `DELETE`, nulle part.
- Aucun `UPDATE` autre que `reclamations.statut` — en particulier **pas** sur
  `polices` (cf. ADR-001), `garanties`, `remboursements`.
- Aucun accès à `profils`, `audit_log`, `dossiers_soins`, `actes_dossier`,
  `tickets_soins`, `factures_dossier`, `souscripteurs`, `parametres_plateforme`.
- Aucun `SELECT *` sur `reclamations` / `remboursements` — colonnes figées
  ci-dessus uniquement. Ajouter une colonne à l'une de ces tables ne l'expose
  PAS automatiquement au service.

### Conséquences

- Un nouveau champ requis côté Java ⇒ `GRANT SELECT (col) ON …` explicite +
  mise à jour de la table ci-dessus, dans la même PR.
- Sur un environnement neuf : rejouer `prisma/sql/018` → `021` dans l'ordre
  reconstitue exactement cet état ; en cas de doute, ce tableau prime et un
  `REVOKE ALL … ; GRANT …` conforme à cette section remet le rôle d'aplomb.
