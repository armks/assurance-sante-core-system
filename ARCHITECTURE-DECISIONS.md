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

### Vérification (2026-09-11)

Le point 1 (« `postgres` contourne la RLS ») a été vérifié empiriquement, pas
seulement supposé — à l'occasion de l'audit de la fuite inter-société sur
`ClaimsService.listerReclamations`/`obtenirReclamation` (aucune restriction de
rôle sur les endpoints `GET /claims/reclamations` et `/:id`, découverte après
le correctif équivalent sur `AdherentService`, voir PROGRESSION.md) :

```sql
SELECT current_user AS role, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
-- → { role: "postgres", rolsuper: false, rolbypassrls: true }
```

Confirmé : `rolbypassrls = true` sur le rôle `postgres` utilisé par la
`DATABASE_URL` de `apps/api`. **Toute policy RLS `SELECT`/`UPDATE`/`DELETE` est
donc totalement invisible pour NestJS/Prisma** — elle ne protège qu'un
éventuel accès direct avec le rôle `authenticated` (PostgREST, client Supabase
navigateur, hors NestJS). Conséquence pratique découverte au passage : la
policy `reclamations_lecture` elle-même ne filtrait que par `organisation_id`,
sans restriction de rôle — contrairement au pattern déjà établi ailleurs
(`polices_lecture`, `cotisations_lecture`, `grilles_tarifaires_lecture` :
`sr.entite_code = 'ASSUREUR'` via `profil_a_role()`). Corrigé dans
`prisma/sql/025_fix_reclamations_rls_role_scope.sql` — un trou distinct et
indépendant du bug applicatif (les deux corrections étaient nécessaires).

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
`pg_roles`), puis **re-relevé le 2026-10-07** (`information_schema.role_table_grants`
/ `column_privileges`) : ajout des grants des migrations 034 / 035 (tarif
conventionné), qui manquaient ici, et de 068 (cumul tiers payant, ADR-005),
puis 069 (plafond double, ADR-006) et 070 (date des soins, amendement d'ADR-006) — vérifiés en base le même jour.
Toute modification future doit être répercutée ici dans la même PR que la
migration SQL.

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
| `tarifs_conventionnes` | `SELECT` *(034)* |
| `remboursements` | `INSERT` |

#### Tables — privilèges au niveau colonne (aucun privilège table associé)

| Table | Privilège | Colonnes |
|---|---|---|
| `reclamations` | `SELECT` | `id`, `organisation_id`, `dossier_soins_id`, `acte_dossier_id`, `adherent_id`, `beneficiaire_id`, `police_id`, `garantie_id`, `montant`, `type_reclamation`, `statut`, `created_at`, `deleted_at` *(13 colonnes)* ; `dispensation_id` *(070)* |
| `reclamations` | `UPDATE` | `statut` *(uniquement)* |
| `remboursements` | `SELECT` | `id`, `reclamation_id`, `montant_rembourse`, `created_at` *(4 colonnes)* |
| `dossiers_soins` | `SELECT` | `id`, `etablissement_id` *(034)* ; `adherent_id`, `beneficiaire_id`, `police_id` *(068)* |
| `actes_dossier` | `SELECT` | `id`, `code_acte` *(034)*, `deleted_at` *(035)* ; `dossier_soins_id`, `categorie_acte` *(068)* ; `date_realisation`, `date_prescription` *(070 — date des soins)* |
| `lignes_facturation` | `SELECT` | `id`, `acte_dossier_id`, `montant_reclame`, `reportee_mois_suivant`, `created_at` *(068)* |
| `beneficiaires` | `SELECT` | `id`, `adherent_id`, `deleted_at` *(069 — rattachement au titulaire, clé de famille)* |
| `produits` | `SELECT` | `id`, `periode_cumul_plafond` *(069 — période de cumul des plafonds)* |
| `dispensations_pharmacie` | `SELECT` | `id`, `date_paiement`, `date_preparation` *(070 — date des soins d'une dispensation)* |

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
- Aucun accès à `profils`, `audit_log`, `tickets_soins`, `factures_dossier`,
  `souscripteurs`, `parametres_plateforme` ; sur `dossiers_soins`,
  `actes_dossier` et `lignes_facturation`, uniquement les colonnes listées
  ci-dessus (aucune donnée médicale : ni motif, ni diagnostic, ni libellé d'acte).
- Aucun `SELECT *` sur `reclamations` / `remboursements` — colonnes figées
  ci-dessus uniquement. Ajouter une colonne à l'une de ces tables ne l'expose
  PAS automatiquement au service.

### Conséquences

- Un nouveau champ requis côté Java ⇒ `GRANT SELECT (col) ON …` explicite +
  mise à jour de la table ci-dessus, dans la même PR.
- Sur un environnement neuf : rejouer `prisma/sql/018` → `021` dans l'ordre
  reconstitue exactement cet état ; en cas de doute, ce tableau prime et un
  `REVOKE ALL … ; GRANT …` conforme à cette section remet le rôle d'aplomb.

---

## ADR-004 — Référentiel unique des catégories d'acte et règle « non couvert »

**Date :** 2026-10-07 — **Statut :** acceptée — **Migration :** `prisma/sql/067_categories_acte.sql`

### Contexte

Trois vocabulaires de catégories coexistaient : actes (`CATEGORIES_ACTE`, API),
garanties (liste du formulaire produit, texte libre côté API) et type de
réclamation (`CATEGORIE_VERS_TYPE`). La part assurance apparie un acte à la
garantie de même catégorie par code exact : BIOLOGIE, ACTE_TECHNIQUE et
TRANSPORT ne trouvaient jamais de garantie et recevaient un taux par défaut de
80 % codé en dur (deux définitions, préautorisation et pharmacie), y compris pour
une catégorie que le produit excluait. Les garanties MATERNITE / SOINS_INFIRMIERS
n'étaient jamais utilisées. En parallèle, une réclamation d'acte était adjugée
avec la garantie CONSULTATION du dossier (`planCouvertureId`), quelle que soit
la catégorie de l'acte.

### Décision

1. **Une table `categories_acte`** (code, libellé, type de réclamation, rôle de
   revue, actif) est la seule source : validation des garanties et des actes (clés
   étrangères + `CategoriesActeService`), type de réclamation, rôle de revue
   manuelle, libellés et listes du web (`GET /reference/categories-acte`,
   `useCategoriesActe()`). Liste : CONSULTATION, HOSPITALISATION, MATERNITE,
   PHARMACIE, ANALYSES, IMAGERIE, OPTIQUE, DENTAIRE, ACTE_TECHNIQUE,
   SOINS_INFIRMIERS, TRANSPORT, AUTRE. Fusions : BIOLOGIE et
   ANALYSES_LABORATOIRE → ANALYSES ; TRANSPORT_SANITAIRE → TRANSPORT.
2. **Une seule garantie active par (produit, catégorie)** — index unique partiel
   `garanties_produit_categorie_unique`.
3. **Règle « non couvert »** : une catégorie sans garantie dans le produit n'est
   pas prise en charge — part assurance 0, le patient paie tout. Plus de taux par
   défaut : `garanties.taux_couverture` est obligatoire (NOT NULL), les deux
   constantes de 80 % sont supprimées (y compris en pharmacie, sur décision du
   2026-10-07). La simulation l'annonce dès l'ajout de l'acte
   (`categorieCouverte: false`).
4. **Publication** : BROUILLON → PUBLIE exige que chaque catégorie active sans
   garantie soit confirmée « non couverte » par l'assureur
   (`produits.categories_non_couvertes`), sinon 400 avec la liste.
5. **Réclamation d'un acte** : garantie = celle du produit pour la catégorie de
   l'acte. `planCouvertureId` reste réservé à l'éligibilité et à la carence de la
   consultation. Sans garantie : réclamation créée REJETE avec le code **E011**
   « catégorie d'acte non couverte par le produit », `garantie_id` NULL
   (contrainte `reclamations_garantie_ou_non_couverte`), **sans appel au
   microservice** d'adjudication.

### Conséquences

- Ajouter une catégorie = une ligne dans `categories_acte` (migration) ; le test
  `part-assurance-categories.spec.ts` échoue tant que son comportement chiffré
  n'est pas défini (il lit la liste dans la migration 067).
- Un produit publié avant 067 n'a pas de `categories_non_couvertes` confirmées :
  la règle « non couvert » s'y applique quand même.
- Une catégorie ajoutée après la publication d'un produit y est non couverte.
- Inchangés (hors périmètre, décision du 2026-10-07) : la répartition des calculs
  NestJS / Java, le plafond annuel, le reste du flux pharmacie. `svc_adjudication`
  (ADR-003) : aucun grant modifié ; une réclamation E011 n'atteint jamais le
  service. `TAUX_DEFAUT_PCT = 100` côté Java devient inatteignable (taux NOT NULL).
- Le rôle de revue est désormais lu dans le référentiel depuis la catégorie de
  l'acte (PHARMACIE pour une dispensation) : MATERNITE passe de AUTRE (revue
  exploitation) à HOSPITALISATION (revue médecin conseil).

---

## ADR-005 — Le microservice Java calcule TOUTE part assurance ; le plafond annuel est consommé par tout ce que l'assureur paie

**Date :** 2026-10-07 — **Statut :** acceptée — **Migration :** `prisma/sql/068_svc_adjudication_cumul_tiers_payant.sql`

### Contexte

Deux calculs de la part assurance coexistaient. NestJS calculait la facture
tiers payant, la simulation à l'ajout d'un acte et le comptoir pharmacie (taux
et plafond par acte seulement) ; le microservice Java adjugeait les réclamations
(tarif conventionné, éligibilité, franchise, taux, plafonds par acte ET annuel).
Une franchise ou un plafond annuel n'était donc jamais appliqué au patient au
centre ni au comptoir, et la pharmacie appliquait le plafond par acte ligne à
ligne alors que la réclamation le faisait sur le total. Par ailleurs, le cumul
annuel du Java ne comptait que les remboursements : les actes facturés en tiers
payant n'entamaient jamais le plafond. Le skill du projet place tout calcul
financier dans le microservice Java.

### Décision

1. **Une seule implémentation des règles financières : le Java.** Nouvel
   endpoint `POST /api/v1/adjudication/simuler` (même JWT de service) : calcul
   SANS écriture ni verrou, par `Adjudicateur.calculer` — exactement la règle de
   l'adjudication. Les lignes sont évaluées dans l'ordre ; chaque ligne consomme
   le plafond annuel de sa garantie pour les suivantes (actes d'une même facture).
2. **NestJS ne calcule plus aucune part assurance** ; il appelle ce service via
   le module `adjudication-client` (sorti de `claims/`) pour :
   - la simulation à l'ajout / au recalcul d'un acte (indicative : microservice
     indisponible → acte enregistré sans montants simulés) ;
   - la facture tiers payant d'un dossier (microservice indisponible → 503,
     aucune facture émise) ;
   - le comptoir pharmacie : la dispensation est UN acte, comme la réclamation
     adjugée au paiement ; la part couverte est répartie au prorata des lignes
     (reliquat d'arrondi sur la dernière) ; indisponible → 503.
   Restent dans NestJS : l'appariement acte ↔ garantie par catégorie et la règle
   « non couvert » (ADR-004 : pas de garantie → 0, sans appel), et le ticket
   modérateur affiché (simple pourcentage informatif).
3. **Cumul du plafond annuel = tout ce que l'assureur prend en charge** (une
   seule définition, `sommeConsommeeAnnee`, utilisée par l'adjudication et la
   simulation) : remboursements adjugés + part assurance des lignes de
   facturation tiers payant (`lignes_facturation.montant_reclame`, hors lignes
   reportées pour litige), par personne et par garantie (garantie d'une ligne =
   celle du produit pour la catégorie de l'acte). Les actes de la demande sont
   exclus du cumul (une ligne orpheline réattachée ne compte pas deux fois).
4. **Un acte facturé en tiers payant ne peut plus faire l'objet d'une
   réclamation** (409) : il serait payé et compté deux fois.

### Conséquences

- Part patient d'une simulation = montant facturé − part couverte (comme la
  facture) ; auparavant, avec un tarif conventionné, la simulation calculait la
  part patient sur le tarif.
- Le microservice devient nécessaire pour facturer et pour préparer une
  dispensation (503 sinon) ; la simulation reste tolérante.
- Grants `svc_adjudication` étendus (068) à des colonnes non médicales de
  `lignes_facturation`, `actes_dossier`, `dossiers_soins` — ADR-003 mis à jour
  (il omettait aussi 034 / 035).
- Concurrence : la simulation ne verrouille pas ; deux factures simultanées pour
  la même personne et la même garantie pourraient chacune voir le même plafond
  restant. L'adjudication d'une réclamation reste, elle, sous verrou.
- Le seuil de revue manuelle (E010) et le passage en revue sur plafond (E006)
  n'ont pas d'effet sur une facture : seule la part couverte est reprise.

### Amendement du 2026-10-07 — verrou des factures et supervision

- **Concurrence résolue** (remplace la limite ci-dessus) : la facture tiers payant
  calcule ET écrit dans une seule transaction, après
  `pg_advisory_xact_lock(hashtextextended(<personne>, 0))` — MÊME clé que
  l'adjudication Java (adhérent, sinon bénéficiaire, sinon police ;
  `adjudication-client/verrou-plafond.ts`). Factures et adjudications d'une même
  personne sont donc sérialisées : chacune lit le cumul après le commit de la
  précédente. L'appel au microservice se fait verrou tenu (le microservice ne
  verrouille pas en simulation : pas d'interblocage) ; délai de transaction =
  timeout de l'appel + 18 s. Vérifié en HTTP réel : deux factures simultanées de
  14 400 chacune sous un plafond de 20 000 → 14 400 puis 5 600 (28 800 sans verrou).
  La simulation à l'ajout d'un acte reste indicative et sans verrou.
- **Indisponibilité** : messages présentés aux utilisateurs centralisés
  (`MESSAGES_INDISPONIBILITE`) — ce qui s'est passé et quoi faire, sans détail
  technique (conservé dans les logs et l'audit). Au paiement d'une dispensation,
  le pharmacien apprend que le paiement est acquis et que la réclamation sera
  reprise par l'assureur.
- **Supervision** : sondes `/healthz` (vivacité) et `/readyz` (base joignable) du
  microservice, `GET /api/v1/sante` côté API, état affiché au superadmin ; health
  checks ECS / ALB décrits dans la doc de déploiement (§3.5).

---

## ADR-006 — Plafond annuel double : par personne ET par famille, période de cumul paramétrable

**Date :** 2026-10-07 — **Statut :** acceptée — **Migration :** `prisma/sql/069_plafond_annuel_personne_famille.sql`

### Contexte

Une garantie n'avait qu'un plafond annuel, cumulé par personne (titulaire ou
bénéficiaire, séparément) sur l'année civile — période codée en dur dans le
microservice (`date_trunc('year', now())` sur la date d'enregistrement), sans
paramètre nulle part. Les contrats collectifs prévoient couramment un plafond
par bénéficiaire ET un plafond partagé par la famille, et des compteurs qui
repartent à zéro à la date anniversaire du contrat.

### Décision

1. **Deux plafonds optionnels par garantie** : `plafond_annuel_personne`
   (l'ancien `plafond_annuel`, renommé — données et comportement inchangés) et
   `plafond_annuel_famille` (titulaire + tous ses bénéficiaires). **Le plus
   restrictif des deux restants s'applique** ; un plafond absent est ignoré ;
   sans aucun des deux, pas de limite annuelle. Décision et codes inchangés :
   restant épuisé → REJETE E006, remboursement réduit → REVUE_MANUELLE E006 ;
   `plafond_restant_apres` = le plus petit des restants.
2. **Famille** = clé de regroupement l'adhérent **titulaire** : le titulaire
   lui-même, ou `beneficiaires.adherent_id` pour un bénéficiaire (ses
   réclamations et dossiers ont `adherent_id` NULL). Le cumul famille compte la
   consommation du titulaire et de TOUS ses bénéficiaires, y compris supprimés
   depuis (leur consommation passée reste imputée). Même définition de « ce qui
   consomme » qu'ADR-005 : remboursements + part assurance des lignes de
   facturation tiers payant, par garantie.
3. **Période de cumul paramétrable PAR PRODUIT** (`produits.periode_cumul_plafond`,
   arbitrage de l'utilisateur : une clause du contrat, commune à toutes ses
   garanties) : `ANNEE_POLICE` — année d'anniversaire de la date de début de la
   police (défaut des nouveaux produits) — ou `ANNEE_CIVILE`. **Les produits
   existants ont été migrés en `ANNEE_CIVILE`** (arbitrage : aucun changement de
   comportement). La période en cours est déterminée par la date du jour, comme
   avant ; police sans date de début → année civile. Calcul pur et testé
   (`PeriodeCumul.java`, y compris un début au 29 février). Une nouvelle version
   d'un produit conserve sa période.
4. **Verrou** (`pg_advisory_xact_lock`) : sur la **famille** (titulaire) dès que
   le **produit** a au moins une garantie à plafond famille, sinon sur la
   personne — même règle côté Java (adjudication) et côté NestJS (facture,
   `verrou-plafond.ts`). La règle est au niveau du produit, pas de la garantie :
   une facture couvre plusieurs garanties, et facture et adjudication doivent
   choisir la même clé pour se sérialiser.
5. **Affichage** : nouvel endpoint Java sans écriture `POST /api/v1/adjudication/plafonds`
   (consommé / restant par personne et pour la famille, période en cours) exposé
   par `GET /api/v1/member/adherents/:id/plafonds`. Lecture réservée aux rôles qui
   lisent déjà les réclamations — l'adhérent pour son dossier, sa société
   (ASSUREE / ADMINISTRATION) pour ses propres adhérents, le personnel assureur
   habilité ; refusée à la réception et à la comptabilité de la société (c'est une
   consommation de soins par garantie). Microservice indisponible → 503 avec un
   message clair, la page reste utilisable.

### Conséquences

- Contrat d'API produit / garantie : `plafondAnnuel` devient
  `plafondAnnuelPersonne` + `plafondAnnuelFamille` ; `null` en modification
  **retire** un plafond (seuls champs effaçables — sans cela, impossible de
  passer d'un plafond par personne à un plafond familial). Produit :
  `periodeCumulPlafond` (création et modification en brouillon).
- Grants `svc_adjudication` étendus (069) à `beneficiaires(id, adherent_id,
  deleted_at)` et `produits(id, periode_cumul_plafond)` — ADR-003 mis à jour.
- Sérialisation plus large quand un plafond famille existe : toutes les
  factures et adjudications d'une famille passent l'une après l'autre (au plus
  quelques dizaines de millisecondes chacune ; coût accepté pour l'exactitude).
- La simulation à l'ajout d'un acte reste indicative et sans verrou.
- Vérifié en HTTP réel : deux bénéficiaires facturés en parallèle sous un
  plafond famille de 30 000 → 20 000 + 10 000 (contre-épreuve sans verrou
  famille : 20 000 + 20 000) ; mêmes montants pour deux réclamations adjugées en
  parallèle par le microservice.

### Amendement du 2026-10-07 — la période de cumul est celle de la DATE DES SOINS

Migration : `prisma/sql/070_svc_adjudication_date_soins.sql`.

- **Avant** : la période était celle du jour, et chaque consommation était datée
  par son ENREGISTREMENT (`remboursements.created_at` = date d'adjudication,
  `lignes_facturation.created_at` = date de facturation). Des soins de septembre
  facturés en octobre, après l'anniversaire de la police, consommaient la
  nouvelle période — et l'ancienne restait vierge.
- **Désormais** : une consommation appartient à la période qui contient la date
  de survenance des soins ; une réclamation ou une facture est plafonnée sur la
  période qui contient SES soins. Date des soins : acte → réalisation, à défaut
  prescription ; dispensation → délivrance (`date_paiement` : les lignes passent
  à SERVIE au paiement), à défaut préparation ; à défaut, date de la réclamation.
  Dates en UTC (Côte d'Ivoire, UTC+0 ; mêmes dates que celles envoyées par le core).
- **Facture à cheval** sur l'anniversaire : chaque acte consomme sa propre période
  (cumuls de simulation par garantie ET par période).
- **Affichage** (`/plafonds`) : inchangé, période en cours (contenant le jour),
  désormais alimentée par les soins de cette période uniquement.
- Vérifié en HTTP réel, avec contre-épreuve sur la version précédente du
  microservice (5 contrôles sur 11 en échec, aux montants prévus).
- **Non modifié (à arbitrer)** : l'éligibilité de la police (E001) et le tarif
  conventionné d'une réclamation restent appréciés à la date de la RÉCLAMATION ;
  la facture et la simulation utilisent déjà la date des soins.
