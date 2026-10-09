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
puis 069 (plafond double, ADR-006), 070 et 071 (date des soins, amendements d'ADR-006) — vérifiés en base le même jour.
**Mise à jour du 2026-10-09 (migration 082, ADR-008 lot 3)** : le Java ne lit plus la projection `tarifs_conventionnes`
(il lit les conventions) ; `referentiel_actes` passe d'un `SELECT` de table à un `SELECT` de colonnes ; ajout des colonnes
des conventions et du type de visite — vérifiés en base le même jour (`information_schema.column_privileges`).
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
| `remboursements` | `INSERT` |

#### Tables — privilèges au niveau colonne (aucun privilège table associé)

| Table | Privilège | Colonnes |
|---|---|---|
| `reclamations` | `SELECT` | `id`, `organisation_id`, `dossier_soins_id`, `acte_dossier_id`, `adherent_id`, `beneficiaire_id`, `police_id`, `garantie_id`, `montant`, `type_reclamation`, `statut`, `created_at`, `deleted_at` *(13 colonnes)* ; `dispensation_id` *(070)* |
| `reclamations` | `UPDATE` | `statut` *(uniquement)* |
| `remboursements` | `SELECT` | `id`, `reclamation_id`, `montant_rembourse`, `created_at` *(4 colonnes)* |
| `dossiers_soins` | `SELECT` | `id`, `etablissement_id` *(034)* ; `adherent_id`, `beneficiaire_id`, `police_id` *(068)* ; `type_visite` *(082 — contexte ambulatoire / hospitalisation du tarif)* |
| `actes_dossier` | `SELECT` | `id`, `code_acte` *(034)*, `deleted_at` *(035)* ; `dossier_soins_id`, `categorie_acte` *(068)* ; `date_realisation`, `date_prescription` *(070 — date des soins)* ; `referentiel_acte_id` *(080 — lien fort vers le référentiel)* ; `quantite` *(083 — tarif unitaire × quantité)* |
| `lignes_facturation` | `SELECT` | `id`, `acte_dossier_id`, `montant_reclame`, `reportee_mois_suivant`, `created_at` *(068)* ; `tarif_provisoire` *(083 — une ligne provisoire entame les plafonds ; le reste de la trace reste illisible)* |
| `beneficiaires` | `SELECT` | `id`, `adherent_id`, `deleted_at` *(069 — rattachement au titulaire, clé de famille)* |
| `produits` | `SELECT` | `id`, `periode_cumul_plafond` *(069 — période de cumul des plafonds)* ; `delai_declaration_jours` *(071 — délai de déclaration après la fin de la police)* |
| `dispensations_pharmacie` | `SELECT` | `id`, `date_paiement`, `date_preparation` *(070 — date des soins d'une dispensation)* |
| `referentiel_actes` | `SELECT` | `id`, `organisation_id`, `code`, `lettre_cle_code`, `coefficient`, `deleted_at` *(082 — remplace le `SELECT` de table : cotation de l'acte, isolation par organisation ; ni libellé, ni catégorie, ni statut)* |
| `conventions` | `SELECT` | `id`, `organisation_id`, `etablissement_id`, `numero`, `version`, `statut`, `date_debut`, `date_fin`, `politique_depassement`, `historique`, `deleted_at` *(082 — jamais le document, les auteurs, les dates de saisie / validation, ni le motif de refus)* |
| `convention_actes` | `SELECT` | `id`, `convention_id`, `referentiel_acte_id`, `prix_forfaitaire`, `valeur_lettre_cle`, `date_debut`, `date_fin`, `deleted_at` *(082)* |
| `convention_valeurs` | `SELECT` | `convention_id`, `lettre_cle_code`, `contexte`, `valeur`, `deleted_at` *(082)* |
| `tarifs_proposes` | `SELECT` | `id`, `organisation_id`, `acte_dossier_id`, `statut`, `montant_propose`, `montant_decide`, `date_proposition`, `deleted_at` *(083 — jamais la justification, les auteurs ni le motif de décision)* |

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

### Amendement du 2026-10-07 — éligibilité et tarif conventionné à la DATE DES SOINS

Migrations : `prisma/sql/071_produits_delai_declaration.sql`,
`prisma/sql/072_tarifs_conventionnes_historique.sql`.

- **Avant** : une réclamation était jugée à la date de la RÉCLAMATION (police ACTIVE ce
  jour-là, tarif en vigueur ce jour-là), alors que la facture utilisait déjà la date
  des soins : des soins reçus pendant la couverture, réclamés après la fin de la police,
  étaient rejetés ; une réclamation tardive prenait le tarif du jour ; deux chemins
  pouvaient diverger sur les mêmes soins.
- **Règle unique** (`EligibiliteSoins.java`, appelée par l'adjudication ET la
  simulation de facture), appréciée à la date des soins (acte : réalisation, à défaut
  prescription ; dispensation : délivrance, à défaut préparation ; à défaut la
  réclamation), dans l'ordre :
  1. soins postérieurs à la date de déclaration (réclamation, ou jour de la facture)
     → **E013** ;
  2. soins antérieurs au début de la police → **E012** ;
  3. soins après la fin de la police, ou police qui ne couvrait pas (suspendue, devis,
     en souscription, terminée sans date de fin connue) → **E001** ; une police
     résiliée / non renouvelée / renouvelée AVEC sa date de fin couvre les soins
     jusqu'à cette date ;
  4. déclaration plus de `produits.delai_declaration_jours` jours après la fin de la
     police → **E014** (pas de délai tant que la police court).
- **Délai de déclaration paramétrable par produit** : **90 jours par défaut** (3 mois,
  délai de forclusion usuel d'une demande de remboursement), appliqué aussi aux
  produits existants — ils refusaient jusqu'ici tout soin déclaré après la fin ; 0 =
  aucun délai. Formulaires produit (création, modification) et nouvelle version.
- **Tarif conventionné en vigueur à la date des soins** (réclamation : même expression
  de date que le cumul ; facture : date de chaque acte). Ce n'était applicable qu'avec
  un **historique des tarifs** : un seul tarif non supprimé par (établissement |
  pharmacie, acte) était permis et l'application imposait de le MODIFIER en place.
  Désormais (072) plusieurs tarifs successifs sont permis, sans chevauchement de
  période (contrainte d'exclusion `btree_gist` ; 409 explicite à la création ou à la
  modification) : changer de tarif = fixer la date de fin de l'ancien, puis créer le
  nouveau.
- **Facture** : un acte non couvert à la date des soins est EXCLU de la facture avec un
  motif et un message daté (ex. « déclaration hors délai — ces soins pouvaient être
  déclarés jusqu'au 28/09/2026 (fin de la police le 30/06/2026 + 90 jours) »), au lieu
  d'être facturé avec une part assurance nulle ; aucun acte restant → 409, rien n'est
  créé. Réclamation : REJETE avec le code (libellés E012–E014 côté API et web).
- **Garde-fous** : la saisie refusait déjà de marquer réalisé un acte daté dans le
  futur (400) ; E013 couvre toute donnée incohérente qui passerait outre.
- Vérifié par un test qui passe chaque cas par les deux chemins (même décision, mêmes
  codes, même montant) et en HTTP réel sur des actes jumeaux, avec contre-épreuve sur la
  version précédente (9 contrôles sur 13 en échec, dont 4 divergences réclamation /
  facture).

---

## ADR-007 — Suppression, archivage et désarchivage : `deleted_at` séparé de l'archivage, RESTRICT en base, refus tracés

**Date :** 2026-10-08 — **Statut :** acceptée (lot 1 « fondations ») — **Migration :** `prisma/sql/073_cascades_sensibles_restrict.sql`

### Contexte

L'audit du 2026-10-08 (lecture seule) a relevé : des suppressions existantes sans aucun
contrôle des dépendances (établissement, pharmacie, souscripteur, adhérent, tarif) ;
`deleted_at` utilisé comme une archive, sans retour possible ; des cascades
`ON DELETE CASCADE` qui effaceraient en silence factures, actes, cotisations,
bénéficiaires… si un parent était supprimé physiquement ; des confirmations disparates
(suppression en un clic au catalogue national) ; un audit écrit hors transaction
(événements).

### Décision

1. **`deleted_at` ≠ archivage.**
   - `deleted_at` = **suppression** : l'élément sort de l'application. Permise **uniquement
     sans aucune dépendance** (clés étrangères ET liens logiques). La ligne reste en base
     (l'audit et les liens logiques restent résolubles) ; l'application ne fait jamais de
     suppression physique.
   - **Archivage** = le statut métier existant, **réversible** (désarchivage) : établissement
     `RESILIE`, pharmacie `RESILIEE`, produit `ARCHIVE` (depuis `PUBLIE`), acte et
     médicament `RETIRE`, adhérent et bénéficiaire `RADIE`, organisation `ARCHIVEE`,
     événement `actif = false`, tarif conventionné **fermé** (`date_fin`, il est historisé).
     Entités sans statut d'archive (société cliente, compte utilisateur, compte financier) :
     archivage « pas encore disponible », à créer dans les lots suivants.
   - Règles d'état : produit modifiable / supprimable seulement en `BROUILLON` (sinon
     nouvelle version) ; police seulement au `DEVIS` sans lien ; garantie seulement si son
     produit est en brouillon ; avenant seulement en brouillon ; acte / médicament de
     référentiel supprimable seulement s'il n'a jamais été homologué ; tarif ayant servi à
     un calcul ni supprimable ni modifiable (on le ferme et on en crée un nouveau) ; une
     invitation n'est jamais supprimée ; un compte ne se supprime pas lui-même.
   - Jamais de suppression : réclamations, remboursements, factures, dispensations,
     dossiers de soins, paiements, lignes d'audit (aucune route, et RESTRICT en base).
2. **RESTRICT en base** (073) sur les cascades sensibles : `dossiers_soins` →
   `factures_dossier`, `actes_dossier` ; `polices` → `cotisations`, `avenants` ;
   `adherents` → `beneficiaires` ; `produits` → `garanties`, `grilles_tarifaires` ;
   `souscripteurs` → `grilles_tarifaires`, `questionnaires_medicaux`,
   `plan_paiement_collectivite`. La base refuse elle-même une suppression physique qui
   emporterait ces enfants (dernier rempart, derrière le contrôle applicatif).
   **Cascades techniques conservées** (enfant sans existence propre) :
   `consultations_dossier`, `tickets_soins`, `notes_dossier` → `dossiers_soins` ;
   `lignes_ordonnance` → `ordonnances` ; `lignes_dispensation` → `dispensations_pharmacie` ;
   `stock_medicaments_pharmacie`, `verifications_etablissement` → pharmacies /
   établissements ; `paiements_groupes_factures` → `paiements_groupes` ;
   `tarification_individuelle` → `polices` / `questionnaires_medicaux` ;
   `membres_comite_gestion` → `souscripteurs` ; `licences_organisation` → `organisations` ;
   `audit_log.organisation_id` (SET NULL).
3. **Service commun des dépendances** (module `dependances/`) : registre déclaratif de
   20 entités (rôles, chargement dans le périmètre, liens comptés, règles par action).
   Chaque lien = un `count`, **restreint au périmètre du jeton** (organisation ; sa propre
   société pour un rôle société ; le superadministrateur, sans organisation, pour le
   catalogue national et les organisations). Liens logiques comptés : profils et
   invitations → établissement / pharmacie / société ; `code_acte` → référentiel ;
   dénomination de médicament (insensible à la casse) → lignes d'ordonnance, stocks ;
   `audit_log.user_id` → compte utilisateur ; copies importées du catalogue national.
   `GET /api/v1/dependances/:entite/:id[/:action]` renvoie possible oui / non et la raison
   en français avec les nombres (« lié à 3 dossiers de soins et 1 tarif conventionné.
   Archivez-le plutôt. »). Enregistrement hors périmètre : 404, rien n'est compté.
4. **Le serveur décide** : `assertPossible` est appelé par les services métier avant
   d'écrire → **409** `{ message, liens }`. Branché dès ce lot sur les suppressions
   existantes : société cliente, établissement, pharmacie, tarif, adhérent, bénéficiaire,
   garantie, acte et médicament du catalogue national, événement. Effet : un adhérent qui a
   un bénéficiaire, un établissement qui a des dossiers ou des comptes rattachés… ne se
   suppriment plus (ils étaient masqués avec leurs dépendances).
5. **Journalisation** : action réussie → `log_audit()` dans la transaction métier
   (l'écriture et sa trace sont validées ou annulées ensemble) ; **refus → tracé HORS
   transaction** (`REFUS_SUPPRIMER`, `REFUS_ARCHIVER`… : qui, entité, raison, liens), sinon
   le rollback effacerait la trace. Les écritures des événements (création, modification,
   suppression) sont passées dans une transaction avec leur audit ; l'image n'est effacée
   du stockage qu'après validation.
6. **Un seul composant de confirmation** : `ConfirmationAction`
   (`components/dashboard/patterns/`), documenté dans le README des patterns et dans le
   skill `health-insurance-core-ui`. Premier usage : catalogue national (auparavant
   suppression en un clic, bouton « Retirer » qui supprimait).

### Conséquences et limites connues

- Les écrans des lots 2 à 5 (boutons archiver / désarchiver, révocation des comptes,
  archivage des sociétés) restent à faire ; l'endpoint et le composant sont prêts.
- Grilles tarifaires : aucune trace des cotisations calculées avec une grille (écart n° 9
  de l'audit) — comptées sans dépendance tant que ce lien n'existe pas.
- Tarifs de pharmacie : pas de lien établi avec un calcul (le comptoir utilise le prix du
  stock) — comptés sans calcul.
- Liens par dénomination ou par code : fragiles par nature (variantes d'écriture) ;
  comparaison insensible à la casse.
- **À confirmer** : « suppression réelle » est implémentée comme une suppression logique
  (`deleted_at`) permise seulement sans dépendance ; aucune suppression physique n'est faite
  par l'application.

### Lot 2 « entités de configuration » (2026-10-08) — migration `prisma/sql/074_suppression_logique_traces_calcul.sql`

Réponses du propriétaire aux points ouverts du lot 1, désormais **décidées** :

1. **Suppression logique confirmée** (`deleted_at`). Conséquence : toute unicité portant sur un
   code, un nom ou un slug SAISI par un utilisateur est un **index unique partiel**
   `WHERE deleted_at IS NULL` (074) — établissements et pharmacies (`code`), organisations
   (`slug`), produits (`organisation, nom, version`), actes du référentiel et du catalogue
   national (`code`). Un code, un nom ou un slug supprimé peut être recréé. Les identifiants
   GÉNÉRÉS (numéros de carte, d'adhérent, de police, de traitement, de consultation, codes de
   facturation, jetons d'invitation) restent uniques sur toute la table : jamais réattribués.
2. **Purge définitive des données personnelles = chantier futur.** La suppression logique garde
   la ligne (nom, date de naissance, contacts…) : elle ne répond pas à une demande d'effacement
   (RGPD / loi ivoirienne sur les données personnelles). Il faudra une procédure distincte,
   tracée et réservée à un rôle précis : anonymisation des colonnes personnelles en conservant
   les montants et les liens comptables. Non réalisée ici.
3. **Produit BROUILLON sans police** : sa suppression emporte ses garanties (suppression
   logique), en une transaction, avec une ligne d'audit `SUPPRESSION_PRODUIT` portant
   `garantiesSupprimees`, et **seulement si aucune garantie n'est utilisée**. La confirmation
   annonce le nombre de garanties emportées.
4. **Traces des liens de calcul** (écart n° 9 de l'audit), clés étrangères `ON DELETE RESTRICT` :
   `cotisations.grille_tarifaire_id` et `tarification_individuelle.grille_tarifaire_id` (grille
   ayant servi à la prime), `actes_dossier.tarif_conventionne_id` (tarif appliqué à l'acte,
   renseigné au calcul par la facture, la simulation et le microservice d'adjudication — seule
   colonne de `actes_dossier` qu'il peut écrire), `lignes_dispensation.tarif_pharmacie_id`.
   Le registre des dépendances compte ces liens : une grille ou un tarif ayant servi n'est
   plus supprimable, un tarif ayant servi n'est plus modifiable en montant. La migration
   rattache l'existant avec la même règle que le calcul et liste par `NOTICE` ce qui ne peut
   pas l'être. Les cotisations CONSOLIDÉES (société) sont une somme, jamais calculées sur une
   grille : elles restent sans grille par construction.
   **Limite connue** : le comptoir de pharmacie calcule au prix du stock ; `tarif_pharmacie_id`
   reste vide tant qu'un tarif de pharmacie n'est pas rattaché à un médicament (lot ultérieur).
5. **Règles par entité** (registre + services) :
   - Produit : modifier en BROUILLON ; supprimer en BROUILLON sans police (avec ses garanties) ;
     archiver (quel que soit l'état sauf déjà archivé) ; **désarchiver** `ARCHIVE → PUBLIE`
     refusé (409) si une autre version du même produit est publiée.
   - Grille tarifaire : modifier **même utilisée** (chaque cotisation garde le montant calculé à
     sa date) ; supprimer seulement si jamais utilisée.
   - Tarif conventionné (établissement et pharmacie) : « **Changer à partir du…** » = une action,
     une transaction (l'ancien est fermé la veille, le nouveau prend le relais) ; archiver =
     fermer ; désarchiver = rouvrir si aucun tarif suivant n'a pris le relais ; ni suppression
     ni modification de montant d'un tarif ayant servi.
   - Acte / médicament du référentiel : retirer = archiver (médecin / pharmacien conseil),
     re-proposer = désarchiver (informatique), supprimer seulement s'il n'a jamais été
     homologué et sans lien.
   - Catalogue national : retirer / réactiver (superadministrateur), suppression refusée si une
     organisation l'a importé.
   - Événement : archiver / désarchiver (`actif`), supprimer sans lien.
6. **Rôles** : suppression réelle réservée au **service informatique** (et à la **direction**
   pour les produits). Le registre porte `rolesSuppression` ; un autre rôle reçoit le verdict
   `ROLE` (« la suppression définitive est réservée au service informatique ») et un **403**
   (jamais un 409). L'archivage garde les rôles de l'entité.
7. **Écrans** : `ConfirmationAction` partout (produits, garanties, tarifs, grilles, référentiel
   médical, homologation, catalogue national, événements) ; case **« Archivés »** sur les
   listes concernées (masqués par défaut) ; les boutons de suppression ne sont montrés qu'au
   rôle autorisé et la confirmation interroge l'endpoint « action possible ? »
   (`POST /api/v1/dependances/:entite/verdicts` pour toute une liste).

**Reste à faire** : lots 3 à 5 (comptes utilisateurs, sociétés, comptes financiers, polices et
avenants) ; purge des données personnelles ; tarifs de pharmacie rattachés aux médicaments.

### Lot 3 « entités partenaires » (2026-10-08) — migration `prisma/sql/075_souscripteurs_statut_archivage.sql`

Entités : établissements de santé, pharmacies, sociétés clientes (souscripteurs).

1. **Statut d'archivage des sociétés** : `souscripteurs.statut` ∈ {ACTIF, ARCHIVE} (CHECK),
   distinct de `deleted_at`. Établissements (RESILIE ↔ ACTIF) et pharmacies (RESILIEE ↔ ACTIVE)
   avaient déjà leur statut. **Unicité** : les index uniques de `etablissements_sante.code` et
   `pharmacies.code` sont partiels (`WHERE deleted_at IS NULL`, 074 — vérifié en base) ; `souscripteurs`
   n'a aucun index unique hors clé primaire, rien à rendre partiel.
2. **Modifier** : contact et adresse libres ; `nom` et `code` tracés à l'audit (ancienne et nouvelle
   valeur) ; code unique parmi les non supprimés (le code d'un élément n'est pas comparé à
   lui-même). L'archivage ne passe **jamais** par `statut` du PATCH (409 qui renvoie à l'action
   « Archiver ») ; un élément archivé ne se modifie pas (409 : désarchivez-le d'abord).
   Les sociétés n'ont ni adresse ni contact en base : seuls nom, secteur, effectif, type de
   collectivité sont modifiables.
3. **Supprimer** : suppression logique, seulement sans aucune dépendance, liens logiques compris
   (comptes, invitations, dossiers…) ; 409 avec raison et nombres, refus tracé à part.
4. **Archiver / désarchiver** : `POST …/archiver` et `…/desarchiver` (établissements, pharmacies,
   sociétés). **Blocages** (raison en français, nombres exacts) : établissement — dossier OUVERT,
   facture non réglée, facture mensuelle non payée ; pharmacie — dispensation non payée (ni
   PAYEE ni ANNULEE), facture mensuelle non payée ; société — police ACTIVE ou SUSPENDUE,
   adhérent ACTIF, cotisation à payer (A_PAYER **et EN_RETARD**, ajout par rapport à la demande :
   une cotisation en retard est a fortiori impayée).
5. **Effets d'un archivage**, tous contrôlés **côté serveur** :
   - les comptes rattachés sont **désactivés dans la même transaction** (`profils.desactive_le` /
     `desactive_motif`, 075 ; le nombre est tracé à l'audit) — distinct de `deleted_at` ;
   - `IdentityService.getMe`, point de passage de tous les services authentifiés, refuse (403
     `COMPTE_DESACTIVE`) un compte désactivé, et (403 `PERIMETRE_ARCHIVE`) un compte dont
     l'établissement, la pharmacie ou la société est archivé(e) ou supprimé(e) ; l'écran
     « Accès coupé » explique le motif ;
   - **le désarchivage ne réactive pas les comptes** : l'informatique les rétablit un à un
     (`POST /identity/comptes/:id/reactiver`, 409 tant que la structure est encore archivée,
     tracé `REACTIVATION_COMPTE` ; bouton « Réactiver » dans la liste des utilisateurs) ;
   - garde de service en plus de la coupure des comptes (défense en profondeur, testée) :
     ouverture de dossier (statut ACTIF exigé), préparation d'une dispensation, facture par
     sélection d'actes, factures mensuelles établissement et pharmacie ; nouvelle police,
     nouvel adhérent et import d'adhérents sur une société archivée → 409 ;
   - disparition de l'annuaire public (liste et carte) : les vues `etablissements_sante_public`
     et `pharmacies_public` ne retiennent que ACTIF / ACTIVE non supprimé — vérifié en base et sur la
     page `/reseau-de-soins` ;
   - historique, factures passées et fiches restent lisibles côté assureur ; rien n'est supprimé.
6. **Changement d'adresse** : relance le géocodage Nominatim (adresse fusionnée avec l'existante)
   sans jamais bloquer l'enregistrement. Succès : nouvelle position (avertissement
   `GEOCODAGE_AUTO`). Échec ou exception : adresse enregistrée, **ancienne position retirée**
   (elle ne correspond plus à la nouvelle adresse), avertissement `GEOCODAGE_ECHOUE`. Coordonnées
   saisies à la main : pas de géocodage. L'annuaire public lit directement ces colonnes.
7. **Rôles** : établissements et pharmacies — modification, archivage, suppression : informatique.
   Sociétés — modification : direction, exploitation, informatique, comptable (inchangé) ;
   **archivage et suppression : direction et informatique** (`rolesArchivage` du registre, verdict
   `ROLE` et 403). Réactivation d'un compte : informatique.
8. **Journalisation** : succès via `log_audit()` dans la transaction métier (statut, désactivation
   des comptes et audit validés ou annulés ensemble) ; refus tracés à part (`REFUS_ARCHIVER`,
   `REFUS_SUPPRIMER`…).
9. **Registre** : comptage des cotisations d'une société restreint à l'organisation du jeton
   (une cotisation d'une autre organisation pointant sur la société n'est pas comptée).

**Limites connues** : le blocage des comptes archivés vaut pour l'API (point `getMe`) mais n'est
pas doublé par une policy RLS comme pour les organisations suspendues (065) — accès PostgREST
direct non couvert. La coupure est totale (lecture comprise) pour les comptes rattachés ; seul
l'assureur consulte l'historique d'une structure archivée. Un compte créé APRÈS l'archivage d'une
structure est refusé par `PERIMETRE_ARCHIVE` sans être marqué désactivé.

### Lot 4 « personnes » (2026-10-08) — migration `prisma/sql/076_profils_revocation_rls_actif.sql`

Entités : comptes utilisateurs actifs, adhérents, bénéficiaires, invitations.

1. **Comptes — révoquer / réactiver.** `profils.statut` ∈ {ACTIF, REVOQUE} (+ `revoque_le`,
   `revoque_par`, `revoque_motif`). Révoquer **ne supprime jamais** le compte : statut REVOQUE
   (transaction + audit `REVOCATION_COMPTE`), puis sessions Auth supprimées et compte Supabase
   **bloqué** (`ban_duration`). Réactiver est **explicite** (`POST /identity/comptes/:id/reactiver`,
   levée du blocage). Distinct de `desactive_le` (désactivation automatique à l'archivage d'une
   structure, lot 3), que la même action de réactivation lève aussi.
2. **Un jeton signé reste valide jusqu'à son expiration** : il est donc refusé de trois façons
   indépendantes, **relues en base à chaque requête** — (a) `SupabaseAuthGuard` (403
   `COMPTE_REVOQUE`), (b) `IdentityService.getMe`, (c) **RLS** : la fonction réutilisable
   `profil_appelant_actif()` (faux si le profil est supprimé, révoqué, désactivé ou rattaché à une
   structure archivée) est exigée par `organisation_appelant_active()` — donc par toutes les
   policies bâties sur `profil_a_role`, `peut_creer_role`, `peut_inviter_role` — et par une policy
   **RESTRICTIVE** `profil_actif_exige` posée sur **toutes** les tables du schéma `public` à RLS
   activée (rôle `authenticated`). Un accès direct PostgREST avec le jeton d'un compte révoqué est
   refusé immédiatement, en lecture comme en écriture, et rétabli dès la réactivation.
   Constat préexistant : plusieurs policies lisent `profils` en sous-requête alors que `profils`
   n'a aucune policy SELECT → pour un client direct elles ne voient aucune ligne ; seules les
   policies passant par les fonctions SECURITY DEFINER donnent un accès direct réel.
3. **Changer le rôle** (`PATCH /identity/comptes/:id/role`) : seulement vers un rôle permis par
   `regles_provisioning` pour l'appelant, **de la même entité** (le périmètre établissement /
   pharmacie / société ne change pas), jamais au-dessus du niveau de l'appelant ; ancien et nouveau
   rôle tracés (`CHANGEMENT_ROLE`) ; **effet immédiat** : le rôle est lu en base à chaque requête,
   il n'est jamais porté par le jeton.
4. **Garde-fous des comptes** (registre, entité `utilisateur`, libellés « Révocation »,
   « Réactivation », « Changement de rôle ») : pas d'auto-révocation ni d'auto-suppression ni de
   changement de son propre rôle ; **dernier administrateur actif protégé** (révocation,
   suppression, changement de rôle — administrateurs = `ASSUREUR_INFORMATIQUE` et son adjoint ;
   garde-fou à MOTIF, prioritaire sur les autres règles, via `bloquantSiNul`) ; aucune action sur un
   compte d'un **niveau supérieur** (niveau d'accès au-dessus du sien, ou son propre rôle parent) ;
   hors organisation → 404 ; rôle : informatique seulement. **Suppression** d'un compte seulement
   sans aucune référence ni ligne d'audit (compte Auth supprimé après validation ; la ligne `profils`
   est retirée avec lui par la cascade de la base).
5. **Adhérents et bénéficiaires.** Archiver = **sortie** (RADIE), désarchiver = réactivation
   (ACTIF). Blocages (raison et nombres) : dossier OUVERT, réclamation en cours (SOUMISE,
   EN_ADJUDICATION, AUTO_ADJUDIQUE, REVUE_MANUELLE), cotisation due (A_PAYER, EN_RETARD) — pour
   l'adhérent **et ses bénéficiaires**. **Archiver un adhérent archive ses bénéficiaires** dans la
   même transaction (la confirmation l'annonce) ; le désarchivage **ne les réactive pas** à sa place.
   **Mécanisme sortants/entrants respecté** : une société ne radie pas, elle **propose** la sortie
   (`PROPOSE_SORTANT` → RADIE) que l'assureur valide ; la validation d'une sortie par radiation
   applique les mêmes blocages et entraîne aussi les bénéficiaires. Le changement de statut libre
   (`PATCH …/statut`) ne pose plus ni ne quitte RADIE. Modifier un archivé : 409. Suppression :
   logique, sans aucun lien. Rôles : direction, exploitation, informatique ; société pour SES
   adhérents (réactivation réservée à l'assureur).
6. **Invitations.** `POST /invitations/:id/renvoyer-nouvelle` depuis REVOQUEE ou EXPIREE (statut,
   ou échéance dépassée) : **nouvelle** invitation (nouveau jeton, nouvelle échéance, même adresse /
   rôle / périmètre, règle de provisioning revérifiée), l'ancienne **reste** et pointe vers la
   nouvelle (`remplacee_par`) ; une invitation déjà remplacée ne se renvoie plus ; jamais de
   suppression.
7. **Réactivation groupée** d'un périmètre désarchivé : `GET /identity/comptes/desactives` (liste
   de la confirmation) et `POST /identity/comptes/reactiver-perimetre` (une transaction, un audit par
   compte) — refusés tant que le périmètre est archivé ; les comptes **révoqués à la main** ne sont
   jamais touchés.
8. **Géocodage en échec** : signal « Position non résolue » sur la liste et la fiche des
   établissements et pharmacies (côté informatique).
9. **Journalisation** : succès via `log_audit()` dans la transaction, refus tracés à part. Comptages
   du registre restreints à l'organisation du jeton (cotisations, consultations, actes prescrits,
   dispensations, avenants).

Écrans : `ConfirmationAction` sur utilisateurs (révoquer, réactiver, changer le rôle, supprimer ;
case « Révoqués »), invitations (« Renvoyer l'invitation »), adhérents (liste et fiche : archiver,
désarchiver, **supprimer — bouton manquant relevé par l'audit** —, modifier ; case « Archivés »),
bénéficiaires, « Tout réactiver » (la confirmation liste les comptes). `ConfirmationAction` accepte
des `libelles` propres (Révoquer, Réactiver, Renvoyer, Tout réactiver).

**Limites connues** : la RLS restrictive est appliquée à toutes les tables à RLS activée, pas à
celles qui n'ont pas la RLS (la table `profils` elle-même n'expose aucun SELECT à un client) ;
l'invalidation des sessions Auth passe par la base (`auth.sessions`) faute d'endpoint dédié — le
refus ne dépend pas d'elle ; un compte créé après une révocation de son e-mail suit le parcours
d'invitation normal (`assertPasDejaCompte`).

### Lot 5 « finance » (2026-10-08) — migration `prisma/sql/077_finance_archivage_annulations.sql`
- **Polices** : modifier librement et supprimer (logique) seulement au stade DEVIS sans aucun lien
  vivant (adhérents, avenants, cotisations, dossiers, réclamations — les lignes supprimées ne comptent
  plus). Statuts finaux (renouvelée, résiliée, non renouvelée) = archive DÉFINITIVE : ni archivage ni
  désarchivage par le registre ; « Dupliquer en devis » repart d'un nouveau DEVIS (même société, même
  formule publiée, sans dates ni donnée reprise ; refusé si la société est archivée ou la formule n'est
  plus publiée).
- **Avenants** : modifier / supprimer (logique) en BROUILLON seulement. **Annuler un avenant APPLIQUE**
  = statut ANNULE + motif obligatoire + auteur + date, jamais de suppression. Décision : appliquer un
  avenant ne modifie ni la police, ni les adhérents, ni les cotisations (statut seul ; `impact_cotisation`
  est informatif) ; l'annuler n'a donc AUCUN effet sur la police ni sur les cotisations déjà calculées :
  pas de recalcul ni de compensation. L'audit garde motif, auteur, impact et l'état (nombre, total dû)
  des cotisations de la police à cet instant.
- **Cotisations** : `POST /billing/cotisations/:id/annuler` (A_PAYER sans aucun paiement, motif
  obligatoire, comptable et informatique — l'adjoint hérite des droits de facturation comme ailleurs
  dans `billing`) ; jamais supprimées (aucune route). Une ANNULEE ne bloque plus l'archivage de la
  société (seules A_PAYER / EN_RETARD comptent) mais reste dans l'historique. EN_RETARD non annulable
  (lettre de la demande). Limite : une cotisation annulée occupe sa période (unicité police / adhérent
  ou société / période, sans condition de statut).
- **Comptes financiers** : `statut` ACTIF | ARCHIVE. Modifier le libellé ; archiver (solde nul et aucun
  paiement programmé — facture mensuelle ou paiement groupé non payé) ; désarchiver ; supprimer
  (logique) seulement sans mouvement, sans paiement lié et **solde nul** (règle ajoutée : un compte à
  150 000 F sans mouvement — les fonds initiaux n'en créent pas — était supprimable). Le solde ne se
  modifie jamais directement. Un compte archivé ne reçoit ni ne sert plus aucun mouvement (409).
  Rôles : cycle de vie = comptable et informatique (rôle propre, jamais les adjoints) ; créer et
  mouvementer l'argent restent au comptable.
- **Propositions d'import** : `imports_adherents.deleted_at` ; la liste en BROUILLON se supprime
  (entière ou ligne à ligne), soumise ou validée elle est conservée ; entité `propositionImport` du registre.
- **Garde-fou administrateur durci** : le contrôle « au moins un administrateur actif » est rejoué dans
  la transaction sous verrou consultatif par organisation (révocations / changements de rôle / suppression
  croisés simultanés : le second voit le premier validé → 409 explicite).
- UI : la confirmation partagée accepte un motif obligatoire (annulations).

### Comptoir de pharmacie — prix saisi, majoration surveillée (2026-10-09) — migration `prisma/sql/078_comptoir_prix_saisi_majoration.sql`
- **Décision métier** : la base nationale des médicaments (prix de référence) est UNIQUE pour toute la
  Côte d'Ivoire ; chaque pharmacie applique sa propre majoration. On ne crée donc PAS de base de médicaments
  ni de tarifs par pharmacie. L'assureur n'a pas de tarif conventionné de médicament avec les pharmacies : il
  suit la garantie du contrat (taux de couverture) appliquée au prix réellement facturé, sans plafond.
- Le caissier SAISIT le prix pratiqué de chaque médicament au comptoir (obligatoire, jamais lu dans une base
  de la pharmacie). Le prix national de référence (médicament homologué de l'organisation, à défaut référentiel
  national) est affiché et sert à mesurer la majoration.
- **Alerte, jamais blocage** : au-delà du seuil (paramètre de plateforme `majoration_maximale_pharmacie_pourcent`,
  20 % par défaut), la ligne est marquée « majoration anormale » (prix de référence, pourcentage et indicateur
  enregistrés sur la ligne de dispensation), signalée au caissier, tracée dans l'audit et visible du
  pharmacien-conseil dans le détail des factures mensuelles. Sans prix national connu : pas d'alerte.
- Le stock de la pharmacie ne porte plus de prix (colonne conservée, inutilisée) : il ne sert qu'à signaler un
  médicament indisponible (409). `tarif_pharmacie_id` n'est plus renseigné (jamais utilisé) : le registre traite
  le tarif de pharmacie comme un tarif sans calcul (modifiable, supprimable). Dette `tarif_pharmacie_id` soldée.

### Liste nationale des médicaments remboursables (CMU / MUGEF-CI, éd. novembre 2022) — migration `prisma/sql/079_catalogue_national_liste_cmu.sql` (2026-10-09)
- La liste officielle (PDF de 22 pages, 736 produits, 99 DCI, 41 groupes thérapeutiques) est chargée en
  masse dans le **catalogue national** unique `referentiel_national_medicaments` (jamais le PDF : les données).
  Extraction contrôlée : 736 lignes lues par le tableau = 736 lignes du texte, somme des prix identique en base
  (2 209 253 F), aucun code en double.
- Mapping : DCI → `denomination_commune`, nom commercial → `nom_commercial`, groupe thérapeutique →
  `classe_therapeutique`, prix → `prix_reference_xof` UNIQUEMENT (`prix_max_remboursable` reste vide) : ce prix ne sert
  qu'aux ALERTES de majoration du comptoir, il ne plafonne ni ne calcule aucun remboursement, `remboursable = true`, homologué ; nouveaux champs `code_produit` (clé d'import,
  unique), `categorie_remboursement` (R = remboursable, EP = remboursable après entente préalable — lecture à
  confirmer avec la MUGEF-CI), `regime_remboursement` (CMU), `source_liste`.
- Chargement : `node apps/api/scripts/charger-liste-cmu.js` (`--simuler` pour compter) — idempotent (clé = code
  produit), un seul lot transactionnel, une ligne d'audit. Données : `apps/api/prisma/data/cmu-medicaments-2022-11.json`.
  L'import Excel existant ne convenait pas (clé = DCI, doublons de DCI refusés alors que la liste a plusieurs
  produits par DCI).
- Comptoir : le prix national se retrouve par nom commercial exact d'abord, sinon par DCI (prix le plus élevé
  de la DCI — l'alerte de majoration n'est levée que si même le produit le plus cher est dépassé).
- À faire : la prescription du médecin est encore un texte libre ; la faire choisir dans ce catalogue national.

## ADR-008 — Barème conventionnel : quatre couches séparées ; lot 1 « nomenclature » (2026-10-09)

**Contexte.** Le tarif d'un acte résulte de quatre couches séparées : (1) la nomenclature nationale des actes
(code, libellé, lettre-clé, coefficient, isolé / groupé, catégorie de garantie) — AUCUN prix en FCFA ; (2) la
convention de l'établissement avec l'assureur (valeurs négociées) ; (3) le tarif reconnu (forfait de l'acte, sinon
valeur de lettre-clé propre à l'acte, sinon valeur de lettre-clé de la convention par contexte, sinon tarif
proposé — jamais de prix par défaut) ; (4) le remboursement (taux, franchise, plafonds), calculé par le Java sur le
tarif reconnu, le taux restant dans la garantie du produit. Le lot 1 pose la couche 1 ; les couches 2 à 4 suivent.

**Décisions du lot 1** (migration `prisma/sql/080_nomenclature_lettres_cles_cotation.sql`) :
- `lettres_cles` : référentiel paramétrable, géré par le superadmin (B, Z, K, D, KA, KC, KE, P, AMI, AMK),
  **sans valeur chiffrée**. Libellés d'amorçage neutres (« Lettre-clé B »…) : la signification officielle est à
  saisir par le superadmin, rien n'est inventé. Désactiver = ne plus proposer à la cotation (actes déjà cotés
  conservés) ; supprimer = seulement si aucun acte (national ou d'organisation) ne la porte (ADR-007).
  `code` est la clé étrangère des actes ; `id` (uuid) sert aux écrans et au registre des dépendances.
- Cotation sur `referentiel_national_actes` ET `referentiel_actes` : `lettre_cle_code` (FK), `coefficient`
  (numeric 8,2 > 0), `mode_cotation` (ISOLE par défaut | GROUPE), `categorie_garantie` (FK `categories_acte`),
  `groupe_code`. CHECK en base : lettre-clé et coefficient vont ensemble ; GROUPE ⇔ code de groupe. La même
  validation sert l'API et l'import (`LettresClesService.analyser`, toutes les erreurs d'une ligne remontées).
- **Chapitre ≠ catégorie de garantie** : `categorie` redevient un chapitre de nomenclature en texte libre (les clés
  étrangères vers `categories_acte` de la migration 067 sont supprimées sur `categorie`) ; l'existant est copié
  dans `categorie_garantie`. Compatibilité : un chapitre qui est un code ou un libellé de catégorie tient lieu de
  catégorie de garantie quand celle-ci n'est pas fournie.
- **Code d'acte unique PAR ORGANISATION** (et non plus globalement) : deux organisations peuvent avoir le même
  code ; l'index `(organisation_id, code)` remplace l'index global. Le code unique global révélait en outre
  l'existence d'un code dans une autre organisation (409).
- `actes_dossier.referentiel_acte_id` (FK, RESTRICT) remplace la jointure par `code_acte` en texte libre ; posé à
  l'ajout de l'acte dans l'organisation du dossier. Rattachement de l'existant par (organisation du dossier, code)
  : base de développement vide d'actes de dossier ; cas non rattachables (code absent, code inconnu de
  l'organisation, code présent seulement dans une autre organisation) restent NULL — vérifié par test.
- **Java** : la recherche du tarif est filtrée par organisation — réclamation : `ra.id = acte.referentiel_acte_id
  AND ra.organisation_id = réclamation.organisation_id` ; simulation : `(code, organisation de la police)`.
  `svc_adjudication` ne lit que des colonnes (migration 070) : deux GRANT de colonnes ajoutés.
- Import Excel du catalogue national étendu (`lettre_cle`, `coefficient`, `mode`, `categorie_garantie`,
  `groupe_code`) : validation ligne par ligne avec rapport d'erreurs ; fichier sans colonne de cotation = ancien
  format (une mise à jour ne touche pas la cotation existante) ; l'import vers une organisation copie la cotation.
- Données : jeux de test FICTIFS uniquement ; ni la vraie nomenclature NGAMBCI (à importer depuis la source
  officielle) ni les valeurs CMU (B 100, K 250, Z 300, D 200), jamais défaut en production.

### Lot 2 « conventions » (2026-10-09) — migration `prisma/sql/081_conventions.sql` (ADR-008)
- **Tables** : `conventions` (établissement, numéro + version, période, document signé, statut PROPOSEE | VALIDEE |
  REFUSEE | ARCHIVEE, politique de dépassement PATIENT | REJET, saisie / modification / validation / refus tracés),
  `convention_valeurs` (lettre-clé × contexte AMBULATOIRE | HOSPITALISATION, unique par convention), `convention_actes`
  (forfait OU valeur de lettre-clé propre à l'acte — CHECK « exactement un des deux »). Soft delete et index uniques
  partiels partout. `EXCLUDE` : pas deux conventions VALIDEES qui se chevauchent pour un établissement ; `EXCLUDE` aussi
  sur les lignes d'un même acte dans une convention (l'historique migré porte des périodes successives).
- **Circuit** : saisie par l'assurance informatique ; validation / refus par le médecin conseil ou la direction, **jamais
  par la personne qui a saisi ou modifié** (refus 403 tracé à part ; CHECK en base `valide_par ≠ saisi_par, modifie_par`,
  donc impossible à contourner hors API). Document signé et au moins une valeur ou exception obligatoires pour valider.
  Refus : motif de 5 caractères minimum ; une convention refusée se corrige après « reproposer ». Une convention VALIDEE
  n'est plus modifiable : « nouvelle version » (copie PROPOSEE, version + 1, document non copié) ; à la validation de la
  nouvelle, l'ancienne est fermée la veille de la date d'effet et passe ARCHIVEE (sa période reste en vigueur jusqu'à sa
  fin). Chevauchement : refusé avec le numéro de la convention en cause.
- **Projection vers le Java** : `tarifs_conventionnes` reste la table lue par le microservice jusqu'au lot 3 (calcul Java
  non touché). Les forfaits d'une convention VALIDEE y sont projetés **sous le même identifiant** que leur ligne ; fermés
  avec la convention. Les valeurs de lettres-clés et les « valeurs propres » ne sont pas projetées (lot 3). Les tarifs
  d'ÉTABLISSEMENT ne se gèrent plus que par les conventions (les routes de tarifs répondent 409) ; ceux des pharmacies sont
  inchangés.
- **Migration** : une convention « historique » VALIDEE par établissement ayant des tarifs non supprimés ; chaque tarif
  devient une ligne forfaitaire du MÊME identifiant ; période propre conservée ; aucun montant ne change ;
  `tarif_conventionne_id` des actes calculés reste valide. Ne sont pas migrés : les tarifs supprimés (logiquement) et les
  tarifs de pharmacie. Base de développement : aucun tarif, donc rien à migrer ; logique vérifiée par rejeu en transaction
  annulée (idempotente).
- **Registre (ADR-007)** : entités `convention` et `conventionActe` ; règle « tarif ayant servi » reprise : un forfait déjà
  utilisé par un calcul bloque suppression et modification (409 chiffré) ; validée / archivée conservées ; archiver =
  fermer (réservé à une convention validée).
- **Document** : bucket privé `conventions`, écrit et signé par le seul service_role ; chemin préfixé par l'organisation et
  l'établissement ; URL signée de 10 minutes ; 404 hors de l'organisation.
- **Indicateur** : « établissements actifs sans convention validée en vigueur » (statut VALIDEE ou ARCHIVEE dont la
  période couvre aujourd'hui) sur le tableau de bord de l'assurance informatique.
- `etablissements_sante.date_convention` / `date_fin_convention` : dépréciées (commentaires SQL et Prisma), conservées.
- Libellés d'amorçage des lettres-clés marqués « (fictif) » ; le superadmin les remplace.

### Lot 3 « résolution du tarif dans le Java » (2026-10-09) — migration `prisma/sql/082_resolution_tarif_trace.sql` (ADR-008)
- **Un seul résolveur** (`ResolveurTarif`), utilisé par la simulation (donc la facture et le comptoir), et par la réclamation :
  mêmes données, mêmes décisions. Ordre : (1) forfait de l'acte dans la convention en vigueur à la date des soins ;
  (2) valeur de lettre-clé PROPRE à l'acte × coefficient ; (3) valeur de la lettre-clé de la convention selon le contexte
  × coefficient ; (4) sinon **non tarifable**. Jamais de prix par défaut.
- **Contexte** : `HOSPITALISATION` si le type de visite du dossier est `HOSPITALISATION_MEDICALE`, sinon `AMBULATOIRE`.
  Le core transmet `type_visite` ; à défaut le Java le lit sur le dossier de l'acte.
- **Convention en vigueur** : `VALIDEE`, ou `ARCHIVEE` (fermée par une nouvelle version) dont la période couvre la date des
  soins. Une version fermée la veille de la suivante ne laisse aucun trou. Sans convention en vigueur : **mode de
  transition**, comportement historique (prix affiché reconnu), règle `AUCUNE_CONVENTION`. Une convention « historique »
  (migration des anciens tarifs) n'est pas un barème complet : l'acte qu'elle ne liste pas garde ce même comportement.
- **Arrondi HALF_UP à l'unité** : tarif reconnu arrondi par acte ; part assurance arrondie par acte ; part patient = total −
  part assurance ; les cumuls (plafonds annuels) portent sur des montants arrondis. Montants entiers existants inchangés.
- **Dépassement** (prix affiché > tarif reconnu), lu sur la convention : `PATIENT` (le calcul part du tarif reconnu, l'excédent
  reste au patient) ou `REJET` (acte rejeté, code **E015**). Acte non tarifable : rejeté, code **E016**, message clair
  (lettre-clé et contexte manquants, convention citée). Dans une facture, ces actes sont EXCLUS avec leur message (comme
  les inéligibilités à la date des soins) ; en réclamation, la décision est `REJETE` (le circuit « tarif proposé » du lot 4
  remplacera ce rejet par un renvoi au médecin conseil).
- **Instantané figé** sur la ligne de facturation (colonnes `tarif_*`) : statut, règle d'origine (`FORFAIT`, `VALEUR_PROPRE`,
  `VALEUR_LETTRE_CLE`, `AUCUNE_CONVENTION`), lettre-clé, coefficient, valeur appliquée, convention, politique, prix affiché,
  tarif reconnu, écart. Valeurs copiées, jamais recalculées ; un trigger interdit de les modifier après l'émission (sauf
  ré-émission de la ligne dans une nouvelle facture).
- **Droits `svc_adjudication`** (ADR-003 mis à jour) : lecture des seules colonnes nécessaires des conventions, lignes et
  valeurs, du type de visite et de la cotation des actes ; plus aucun accès à `tarifs_conventionnes` ni aux autres colonnes
  de `referentiel_actes`. Toutes les lectures sont filtrées par organisation dans les requêtes (le rôle contourne la RLS) :
  même code d'acte dans deux organisations = deux actes, deux conventions, jamais de mélange.
- **Limites assumées** : (1) le tarif reconnu est celui de la LIGNE : la quantité n'est pas multipliée (comportement
  historique conservé, montants existants inchangés) — à trancher avec le lot 4 ; (2) la simulation indicative faite à
  l'ajout d'un acte (date des soins encore inconnue) prend la date du jour ; la facture et la réclamation recalculent à la
  date des soins ; (3) la réclamation trace le forfait sur l'acte (`tarif_conventionne_id`) mais pas encore l'instantané
  complet (il vit sur la ligne de facturation).

### Lot 4 « tarif proposé » (2026-10-09) — migration `prisma/sql/083_tarifs_proposes.sql` (ADR-008)
- **Quantité** (point laissé ouvert au lot 3) : le résolveur calcule le tarif UNITAIRE (arrondi HALF_UP), puis multiplie par la
  quantité ; le prix affiché (total de la ligne) est comparé au total reconnu. Quantité 1 : montants inchangés. Forfait 3 000 :
  quantité 2 → reconnu 6 000, quantité 3 → 9 000. Unitaire 2 582,5 → 2 583 puis × 3 = 7 749 (l'arrondi précède la multiplication).
- **Acte non tarifable (E016) ne bloque plus** : le comptable ou l'administratif de l'établissement propose un montant TOTAL avec
  une justification (10 caractères au moins). Table `tarifs_proposes` : acte, ligne de facturation, montant, justification, statut
  `PROPOSE | VALIDE | AJUSTE | REFUSE`, proposé par / décidé par, montant décidé, motif, dates, `deleted_at`. Garde-fous en base :
  le proposant ne décide jamais (`decide_par ≠ propose_par`), décision tracée (qui, quand), `AJUSTE` chiffré et motivé, `REFUSE`
  motivé, une proposition décidée ne se modifie plus (trigger), UNE seule proposition vivante par acte (index unique partiel
  `WHERE deleted_at IS NULL AND statut <> 'REFUSE'` : un refus permet d'en proposer une autre). La proposition n'est acceptée que
  si le Java confirme que l'acte est réellement non tarifable (aucun contournement d'un tarif négocié).
- **Calcul provisoire** : le Java prend le montant proposé comme tarif reconnu (règle `TARIF_PROPOSE`, dernière de la liste : la
  convention l'emporte toujours si elle tarife l'acte). `PROPOSE` → provisoire (revue manuelle, code **E017**) ; `VALIDE` → montant
  proposé ; `AJUSTE` → montant décidé ; `REFUSE` → l'acte reste non tarifable. Sans proposition, E016 passe de « rejet » à
  **REVUE_MANUELLE à 0** : plus de rejet sec (le rejet E015 de la politique REJET est inchangé).
- **Plafonds** : une ligne provisoire est exclue du paiement (`reportee_mois_suivant`) mais ENTAME les plafonds personne et famille
  (le cumul compte `tarif_provisoire`) ; un refus restitue le plafond. Colonnes ajoutées à `lignes_facturation` : `tarif_unitaire`,
  `tarif_quantite`, `tarif_provisoire`, `tarif_propose_id`. La trace provisoire peut être remplacée UNE fois par la décision, puis se
  fige (trigger).
- **Facture patient** : l'acte à tarif proposé non décidé sort de la facture (montants hors facture), le patient règle le reste ; la
  facture renvoie `actesTarifEnExamen` avec la part estimée, INDICATIVE, et la mention « tarif en cours d'examen » (affichée aussi
  dans « Mes factures » du patient).
- **Facture mensuelle** : une ligne dont le tarif n'est pas `VALIDE` / `AJUSTE` est exclue et non payable (reportée) ; à la
  consolidation, `synchroniserLignes` réintègre les lignes décidées (nouveau calcul avec le montant retenu) ; double exclusion avec un
  litige testée (une ligne ajustée reste dehors tant que le litige dure, puis est réintégrée).
- **Réclamation** : même circuit (REVUE_MANUELLE avec le montant provisoire sous E017). L'approbation manuelle est refusée tant que
  le tarif est en examen ; une fois décidé, le montant recalculé doit être précisé (le montant provisoire n'est plus valable).
- **Droits et traces** : lecture et proposition réservées à l'établissement de l'acte (404 hors établissement / organisation) ;
  l'assureur (médecin conseil, direction, informatique) lit ; les sociétés n'ont aucun accès ; `log_audit()` dans la transaction
  (`PROPOSITION_TARIF`, `REINTEGRATION_LIGNE_TARIF_PROPOSE`), refus métier tracés à part (`REFUS_PROPOSITION_TARIF`).
- **Hors périmètre (lot 5)** : la file du médecin conseil et les décisions (VALIDE / AJUSTE / REFUSE) ; la part patient d'un acte
  décidé après coup ; l'archivage / suppression de propositions.
- **Attention aux migrations** : 083 redéfinit `lignes_facturation_tarif_fige()` (déjà définie en 082) ; les appliquer dans l'ordre.

### Lot 5 « file du médecin conseil et décisions » (2026-10-09) — migration `prisma/sql/084_file_medecin_conseil_decisions.sql` (ADR-008)
- **File « Tarifs proposés à examiner »** (`GET /tarifs-proposes/file`, médecin conseil ; direction en lecture) : pagination SERVEUR,
  filtres établissement / statut (PROPOSE par défaut) / ancienneté minimale / catégorie, tri **alerte renforcée d'abord, puis ancienneté**
  (index `tarifs_proposes_file_idx`). Compteur sur le tableau de bord (à examiner, alertes renforcées, en retard).
- **Décisions** (`POST /tarifs-proposes/:id/valider | ajuster | refuser`, médecin conseil uniquement) : valider ; ajuster (montant ET
  motif obligatoires, montant différent du proposé) ; refuser (motif obligatoire, l'acte reste non tarifable, l'établissement est prévenu
  par e-mail et par l'écran). Le proposant ne décide jamais (403 tracé + CHECK en base). Tout se passe dans UNE transaction, sous le MÊME
  verrou personne / famille que la facture et l'adjudication : décision enregistrée, **recalcul par le Java** (la décision lui est imposée
  dans la requête, car elle n'est pas encore validée en base), ligne réintégrée (non provisoire, payable ; une ligne en litige reste exclue
  par la consolidation — double exclusion), facture complémentaire, `log_audit()`. Refus de décision tracés à part (`REFUS_DECISION_TARIF_*`).
- **Part patient après décision — facture complémentaire** (arbitrage validé) : VALIDE / AJUSTE → prix affiché − part assurance recalculée
  (le dépassement éventuel reste au patient, comme sur une facture normale) ; REFUSE → **tout le prix affiché** (l'assurance ne paie rien,
  comme un acte non couvert). Document `factures_dossier` (lien unique `tarif_propose_id`, montant assurance 0 : l'assurance est déjà
  portée par la ligne), avec code de validation, visible dans « Mes factures » du patient (statut du tarif, montant retenu, motif du refus),
  **sans bloquer d'autres soins** (testé : un autre acte du même dossier se facture normalement). Aucune facture si la part patient est nulle
  ou si l'acte n'était pas encore facturé (il sera facturé avec le tarif décidé).
- **Option « ajouter à la convention »** (VALIDE ou AJUSTE) : exception d'acte (forfait par unité, ou valeur de lettre-clé propre = unitaire /
  coefficient, acte coté exigé) dans une **nouvelle version PROPOSEE** de la convention en vigueur — jamais dans une VALIDEE (testé : statut
  et lignes inchangés) ; une version PROPOSEE déjà en cours reçoit la ligne (pas de version supplémentaire) ; effet le lendemain. La version est
  validée par le circuit normal : le médecin conseil qui l'a créée ne peut pas la valider (403), la direction le peut après le document.
- **Alertes** (paramètres de plateforme, modifiables par le superadmin) : *renforcée* si le montant PAR UNITÉ dépasse de
  `tarif_propose_alerte_ecart_mediane_pourcent` (50 %) la médiane des tarifs reconnus par unité de la même catégorie sur 12 mois
  (tarifs de convention uniquement, jamais d'un autre tarif proposé), **systématique sans historique** ; *récurrence* à partir de
  `tarif_propose_recurrence_nombre` (5) propositions du même établissement sur `tarif_propose_recurrence_jours` (30) ; *plafond* (ci-dessous).
- **Rappel J+2 / escalade J+5** : `POST /tarifs-proposes/rappels` (informatique, direction, médecin conseil) — rappel aux médecins conseil
  puis escalade à la direction par `EmailService`, une seule fois par proposition (`rappel_envoye_le`, `escalade_envoyee_le`), audit.
  **Dette : aucun planificateur automatique** (comme `marquer-en-retard`, tâche manuelle) — à brancher sur une tâche planifiée.
- **Alerte de plafond** : si une décision modifie la ligne alors qu'un plafond (famille ou personne) de la catégorie était DÉJÀ atteint (avant
  ou après), le médecin conseil reçoit une alerte (réponse, écran, `alerte_plafond` en base, audit). **Limite acceptée** : le recalcul de la
  ligne décidée respecte le plafond (il ne peut pas le dépasser), mais les lignes acceptées APRÈS elle ne sont pas recalculées — plafonnées à
  cause de la ligne provisoire, elles ne retrouvent pas le montant libéré par un refus ou un ajustement à la baisse ; la correction est manuelle.
- **Visibilité** : l'établissement voit statut, montant retenu (validé : le proposé ; ajusté : le décidé), motif du refus / de l'ajustement et
  qu'il a été prévenu ; le patient voit sa facture complémentaire et le statut du tarif (validé / ajusté / refusé), le montant retenu et le motif du refus.
- **Migrations** : 084 ne redéfinit aucune fonction partagée. L'ordre d'application et les fonctions redéfinies (`lignes_facturation_tarif_fige` :
  082 puis 083) sont documentés dans `docs/DEPLOIEMENT.md` et contrôlés par `test/integration/migrations-etat.int-spec.ts` (état des fonctions,
  triggers et contraintes après toutes les migrations ; ordre des fichiers).
- **Hors périmètre / dettes** : planificateur automatique des rappels ; recalcul des lignes postérieures plafonnées ; facture complémentaire
  pour un acte réclamé (hors facture tiers payant) ; archivage de propositions.
