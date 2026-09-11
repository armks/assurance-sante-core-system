# Progression du projet — Core System Assurance Santé

## Avant incident disque
- ✅ PROMPT 0 — Monorepo Next.js 16 + NestJS initialisé
- ✅ PROMPT 1 — Tables organisations + audit_log créées dans Supabase (confirmé présentes en base après incident)
- ✅ PROMPT 2 — Auth Supabase + guard NestJS (code perdu, à reconstruire)
- ⚠️ PROMPT 3 — Rôles/profils (jamais créé en base, à faire maintenant)

## Incident
- Perte du code local (disque), projet Supabase cloud intact, code local à reconstruire.
- Mise en place Git + GitHub (dépôt privé armks/assurance-sante-core-system) pour éviter la récidive.

## Reprise
- ✅ Git initialisé, premier commit poussé
- ✅ Node.js, Claude Code réinstallés
- ✅ Mode manuel de permission confirmé (global + projet)
- ✅ Tables entites_metier, sous_roles (25 sous-rôles), profils créées dans Supabase via SQL Editor (RLS + policies de lecture)

## 2026-09-06 — PROMPT 3 (partie NestJS) + reconstruction fondations apps/api
- Contexte : le code local était vide (PROMPT 0 monorepo et PROMPT 2 guard perdus,
  jamais reconstruits en code). Base Supabase cloud intacte.
- Créé :
  - Racine : `package.json` (npm workspaces `apps/*`), `.gitignore` étendu (dist/, client Prisma)
  - `apps/api/` : scaffold NestJS 11 (package.json, tsconfig, nest-cli.json, jest.config.js),
    `.env.example` (DATABASE_URL/DIRECT_URL/SUPABASE_JWKS_URL — pas de secret partagé),
    `src/main.ts` (préfixe global `api/v1`), `src/app.module.ts`
  - `src/prisma/` : `PrismaService` + `PrismaModule` (@Global)
  - `prisma/schema.prisma` : modèles `EntiteMetier`, `SousRole` (héritage role_parent_code),
    `Profil` (numero_ordre_medecin) — rédigés d'après la spec (v9 addendum A, v10 §2.2),
    **à réconcilier via `npx prisma db pull`** une fois `.env` renseigné
  - `src/auth/` (reconstruction PROMPT 2) : `SupabaseAuthGuard` (vérif JWT via JWKS/ES256,
    aucun secret partagé), `@CurrentUser()`, `authenticated-user.interface.ts`, `AuthModule`
  - `src/identity/` : `IdentityModule`, `IdentityService` (profil + résolution chaîne
    d'héritage des sous-rôles + permissions effectives via Prisma), `IdentityController`
    exposant `GET /api/v1/identity/me` (protégé par `SupabaseAuthGuard`), tests unitaires
- Statut : ⏳ EN ATTENTE — `npm install` puis `npx prisma generate` / `db pull` à lancer
  après reconstitution manuelle des fichiers `.env` par l'utilisateur. Pas encore compilé/exécuté.
- À faire ensuite : réconcilier le schéma Prisma avec la base réelle (db pull), vérifier le
  build (`npm run build --workspace apps/api`) et les tests, puis commit "Prompt 3 - rôles et identity".

## 2026-09-06 — PROMPT 0 (complément) : scaffold apps/web + fichiers .env
- `apps/web/` créé : Next.js 16 App Router + TypeScript + Tailwind v4 + base ShadCN
  (package.json, tsconfig, next.config.ts, postcss.config.mjs, app/layout.tsx, app/page.tsx,
  app/globals.css avec tokens shadcn, components.json, lib/utils.ts `cn()`,
  lib/supabase/client.ts + server.ts via @supabase/ssr)
- Fichiers d'environnement créés avec variables VIDES à remplir (gitignorés) :
  - `apps/web/.env.local` : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
  - `apps/api/.env` : DATABASE_URL, DIRECT_URL, SUPABASE_JWKS_URL, SUPABASE_JWT_ISSUER,
    SUPABASE_JWT_AUDIENCE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT
- `apps/api` : ajout de `@nestjs/jwt` aux dépendances (conformité PROMPT 0), `.env.example` complété
- Racine : scripts `web:dev` / `web:build`, `.gitignore` étendu (.next/, out/)

## 2026-09-06 — Install + synchro Prisma + build (fichiers .env remplis par l'utilisateur)
- `npm install` (workspaces) : 676 paquets. Node 24, npm 11.
- Correctif : mot de passe DB contenant `@` → encodé `%40` dans DATABASE_URL/DIRECT_URL.
- `npx prisma db pull --force` (schémas `auth` + `public`) : introspection de la base réelle.
  Schéma ré-écrit proprement à la main d'après l'introspection :
  - 5 modèles PascalCase mappés (`@@map`) : `Organisation`, `AuditLog`, `EntiteMetier`,
    `SousRole`, `Profil` — schéma `public` uniquement.
  - Schéma `auth` (GoTrue) NON modélisé ; la FK `profils.id → auth.users.id` existe en base
    mais n'est pas représentée côté Prisma (l'email vient du JWT vérifié).
  - **Colonnes réelles de `profils`** (différentes de l'ébauche) : role NULLABLE, `societe_id`
    (pas `souscripteur_id`), `adherent_id`, `mfa_active`, `methode_connexion` ; PAS de
    colonnes email/nom/prenom/actif → l'email provient de `@CurrentUser().email` (JWT).
  - `sous_roles.dashboard_route` NOT NULL ; `entites_metier` = (code, libelle) seulement.
- `IdentityService` / types / controller / tests adaptés au schéma réel.
  `getMe(user)` : profil + permissions ; permissions = null si aucun rôle assigné.
- `npx prisma generate` : client OK (v6.19.3).
- Build : `npm run build --workspace apps/api` ✅ ; `npm run build --workspace apps/web` ✅
  (Next 16.3.4). Tests API : `npm test --workspace apps/api` ✅ 4/4.
- Statut : ✅ compile et passe les tests. Serveur non démarré, endpoint non testé en HTTP réel
  (nécessite un JWT Supabase valide). Prochaine étape : commit "Prompt 3 - rôles et identity".

## 2026-09-06 — npm audit : 3 « high » (deepmerge-ts) analysées et ACCEPTÉES
- 3 findings = 1 vuln unique (deepmerge-ts <8, GHSA-ggr8-5vv4-36mx, DoS), remontée
  transitivement via @prisma/config ← prisma (CLI, devDependency).
- Aucune exposition en production : le runtime @prisma/client ne charge pas deepmerge-ts ;
  chemin de code atteint uniquement par la CLI Prisma lisant un prisma.config.ts (absent ici).
- `npm audit fix` rejeté : rétrograde prisma 6.19.3 → 6.12.0 (désync avec @prisma/client) et
  ne corrige rien. Override deepmerge-ts@8 rejeté (majeure risquée, chemin mort).
- Analyse complète + conditions de réexamen explicites → `SECURITY.md`.
  Réexamen si : (1) Prisma 8 STABLE publié, OU (2) contributions externes / CI-CD exécutant
  prisma generate sur du code non approuvé au préalable.

## 2026-09-06 — PROMPT 3 : ✅ TERMINÉ ET TESTÉ DE BOUT EN BOUT (HTTP réel)
- `GET /api/v1/identity/me` testé sur le serveur lancé (`npm run start:dev --workspace apps/api`,
  port 3001) avec un vrai JWT Supabase obtenu par password grant (`grant_type=password`).
- Correctif en cours de test : `SUPABASE_JWKS_URL` doit être `/auth/v1/.well-known/jwks.json`
  (le `/auth/v1/jwks` du skill renvoie 401 gateway / 404 avec apikey — n'existe pas).
  → corrigé dans `apps/api/.env.example` et dans le skill `01-plan-directeur-v9.md` addendum B.
- Correctif : `apps/api/tsconfig.json` → `tsBuildInfoFile` dans `./dist` (cache incrémental
  périmé après `deleteOutDir` = "Cannot find module dist/main" au `start:dev`).
- Résultats vérifiés :
  - `role = null` → HTTP 200, `permissions: null` (compte non provisionné).
  - `role = ASSUREUR_COMPTABLE_ADJOINT` → HTTP 200 avec héritage RBAC correct :
    `roleChain = ["ASSUREUR_COMPTABLE_ADJOINT","ASSUREUR_COMPTABLE"]`, `niveauAcces = MODIFICATION`,
    `peutValider = true` **hérité du parent** (l'adjoint a `peut_valider = false`),
    `dashboardRoute = /dashboard-assureur/comptable-adjoint`, `estRoleMedical = false`.
  - Sans token → 401 ; token invalide/expiré → 401 ; profil absent → 404.
  - Chaîne complète prouvée : Supabase Auth → SupabaseAuthGuard (ES256/JWKS) → @CurrentUser()
    → IdentityService → Prisma → Postgres.
- Commits : `c90f275` (correctifs JWKS + tsconfig + skill), poussés sur origin/main via SSH
  (voir entrée infra ci-dessous).
- ⚠️ **Donnée de test laissée en base** : ligne `profils` id `6fc93835-10e0-4187-85d0-ba6b2bdcda30`
  (user Supabase `armelk01@yahoo.fr`), actuellement `role = ASSUREUR_COMPTABLE_ADJOINT`.
  Conservée comme référence de test. **À SUPPRIMER avant toute mise en production réelle.**

## 2026-09-06 — Infra : push git bloqué par Smart App Control → bascule en SSH
- `git push` HTTPS cassé en cours de session : Smart App Control (Windows 11, mode enforce)
  bloque le chargement de `libcurl-4.dll` par `git-remote-https.exe`
  (CodeIntegrity events 3077/3118, Policy ID {0283ac0f-fff1-49ae-ada1-8a933130cad6}).
- Contournement : remote passé en SSH (`git@github.com:armks/assurance-sante-core-system.git`).
  `ssh.exe` est un composant Windows signé, non bloqué. push/fetch/pull OK via SSH.
- HTTPS git reste inutilisable tant que SAC est actif (désactivation SAC = irréversible, non faite).

## 2026-09-09 — PROMPT 4 : module tenant + souscripteurs / membres_comite_gestion
- **Base Supabase** (DDL via `prisma db execute`, trace dans `apps/api/prisma/sql/001_prompt4_souscripteurs.sql`) :
  - Table `souscripteurs` : colonnes du prompt (v9 §1.2), CHECK `type in (ENTREPRISE,COLLECTIVITE,INDIVIDUEL)`,
    FK `organisation_id → organisations`, `questionnaire_medical_id` = uuid sans FK (table PROMPT 10),
    index (organisation_id, type, deleted_at). RLS activée + policies `souscripteurs_select`
    (lecture : entité ASSUREUR, même org) / `souscripteurs_modif` (écriture : rôles
    DIRECTION / EXPLOITATION / INFORMATIQUE, héritage via `coalesce(role_parent_code, code)`).
  - Table `membres_comite_gestion` (v9 §1.3) : id + timestamps + `deleted_at` ajoutés (règle
    transverse), FK `souscripteur_id` (cascade) et `user_id → profils`, CHECK cohérence des
    dates de mandat, index unique partiel (1 mandat actif max par (souscripteur, user)).
    RLS activée + policies alignées sur la visibilité du souscripteur parent.
  - NB : NestJS se connecte via le rôle `postgres` (pooler) et CONTOURNE la RLS ; les policies
    protègent l'accès direct client Supabase. L'enforcement du chemin NestJS est dans TenantService.
- **Prisma** : `db pull --force` (schémas auth+public) puis schéma ré-écrit proprement à la
  main — 7 modèles PascalCase (ajout `Souscripteur`, `MembreComiteGestion`), `@updatedAt`
  ajouté aux modèles concernés, schéma `auth` non modélisé (comme PROMPT 3). `prisma generate` OK.
- **apps/api** — module `tenant/` :
  - `TenantService` : CRUD souscripteurs + comité, **strictement scopé par `organisation_id`**.
    Autorisation via `IdentityService.getMe` (org de l'appelant + `roleChain` hérité).
    Lecture = entité ASSUREUR ; écriture = DIRECTION / EXPLOITATION / INFORMATIQUE.
    Soft-delete. Audit via `log_audit()` (SELECT en transaction). Accès cross-org → 404
    (ne révèle pas l'existence). Comité réservé aux COLLECTIVITE.
  - `TenantController` : 8 routes REST sous `/api/v1/tenant/souscripteurs` (+ `/:id/membres-comite`),
    `@UseGuards(SupabaseAuthGuard)`, `ParseUUIDPipe`.
  - Tests : `tenant.service.spec.ts` — 7 cas dont les 3 exigés (création ENTREPRISE ;
    création COLLECTIVITE + membre comité ; refus cross-org) + refus rôle insuffisant /
    hors entité ASSUREUR / sans organisation / membresComite hors COLLECTIVITE.
- **Vérifs** : `npm run build --workspace apps/api` ✅ ; `npm test` ✅ 11/11 ;
  bootstrap OK (8 routes tenant mappées, DI TenantModule initialisé).

## 2026-09-09 — PROMPT 4 : test HTTP réel de bout en bout ✅ + correctif audit_log
- **Bug découvert et corrigé** : `audit_log.id` créé (PROMPT 1) SANS `default gen_random_uuid()`,
  alors que `log_audit()` (skill §1.6) n'insère pas d'`id` → tout appel échouait en 23502.
  L'audit n'avait jamais fonctionné (aucun chemin d'écriture ne l'exerçait avant tenant/).
  Fix : `alter table audit_log alter column id set default gen_random_uuid()`
  (`apps/api/prisma/sql/002_fix_audit_log_id_default.sql`) + `@default(dbgenerated(...))` dans le schéma Prisma.
- **Jeu de données de test** (à nettoyer avant prod, `scratchpad/prompt4_test_setup.sql`) :
  - `organisations` : `aaaaaaaa-…0001` (Assureur Test A), `bbbbbbbb-…0002` (Assureur Test B)
  - profil de test `6fc93835-…` repositionné : `organisation_id = …0001`, `role = ASSUREUR_INFORMATIQUE`
  - souscripteur `cccccccc-…0003` (« Client confidentiel de B ») dans l'org B
- **Résultats API réels** (serveur lancé, JWT password grant frais) :
  - `POST /api/v1/tenant/souscripteurs` ENTREPRISE → **201**, `organisationId` = org A (forcé côté service)
  - `POST` COLLECTIVITE + `membresComite:[{userId, fonction:PRESIDENT}]` → **201**, membre imbriqué créé
  - `GET /api/v1/tenant/souscripteurs` → **200**, 2 résultats (org A uniquement) ; le souscripteur
    de l'org B **absent** de la liste
  - `GET /…/{souscripteur de l'org B}` → **404** (cross-org, conditions réelles) ; `PATCH` idem **404**
  - `GET /…/{collectivité}/membres-comite` → **200**, le PRESIDENT
  - `audit_log` : 2 lignes `CREATION_SOUSCRIPTEUR` avec `organisation_id` auto-résolu + `details` JSON
- Serveur arrêté ensuite.
- ⚠️ **Données de test en base** (en plus du profil `6fc93835-…`) : 2 organisations `aaaa…/bbbb…`,
  3 souscripteurs (ACME BTP `76d6d833…`, Mutuelle Bouaké `a43b89a6…`, Client B `cccc…0003`),
  1 membre de comité. **À SUPPRIMER avant mise en production.**

## 2026-09-09 — PROMPT 5 : regles_provisioning + RLS INSERT profils + endpoint roles-proposables
- **Base Supabase** (`apps/api/prisma/sql/003_prompt5_regles_provisioning.sql`) :
  - Table `regles_provisioning` (id, role_createur, role_cree, scope_verifie, mode, role_validateur
    + timestamps/deleted_at). CHECK sur scope/mode, UNIQUE (role_createur, role_cree),
    CHECK « validateur ⟺ mode = PROPOSITION ». RLS activée, lecture publique.
  - **22 règles** exactes (v9 §1.4 / §1.5) :
    - `SUPERADMIN_PRINCIPAL` → SUPERADMIN_UTILISATEUR_ADMIN / ASSUREUR_DIRECTION /
      ASSUREUR_INFORMATIQUE — CREATION_DIRECTE, scope null (3)
    - `ASSUREUR_INFORMATIQUE` → 18 sous-rôles ASSUREUR(8) / PHARMACIE(2 : pharmacien+comptable) /
      CENTRE_MEDICAL(4) / SOCIETE_AFFILIEE(4) — CREATION_DIRECTE, scope organisation_id
    - `PHARMACIE_PHARMACIEN` → PHARMACIE_CAISSIERE — **PROPOSITION**, scope pharmacie_id,
      validateur ASSUREUR_INFORMATIQUE (1)
    - Interprétation : PHARMACIE_CAISSIERE **uniquement** par la voie proposition (raison d'être
      de la délégation) — pas de règle directe ASSUREUR_INFORMATIQUE → CAISSIERE.
  - Fonction `peut_creer_role(role_cree, organisation_id, pharmacie_id)` (SECURITY DEFINER) :
    résout le rôle de `auth.uid()` + son parent (héritage adjoint), cherche une règle
    CREATION_DIRECTE correspondante et valide le scope.
  - Policy RLS **INSERT** sur `profils` : `profils_insert_provisioning`
    `with check (role is not null and peut_creer_role(role, organisation_id, pharmacie_id))`,
    `to authenticated`. (NB : `profils` n'avait AUCUNE policy avant — RLS activée, 0 policy.)
- **Prisma** : `db pull --force` puis schéma ré-écrit — 8 modèles (ajout `RegleProvisioning`,
  relations `createur`/`cree`/`validateur` vers SousRole). `generate` OK.
- **apps/api** — `identity/` étendu (pas de module séparé : couplage fort avec identité/rôles) :
  - `ProvisioningService.rolesProposables(user)` : lit `regles_provisioning` filtré sur
    `roleChain` (héritage inclus via IdentityService), dédoublonne, mappe. Renvoie `[]` si
    aucun droit (jamais d'erreur).
  - `GET /api/v1/identity/roles-proposables` ajouté à `IdentityController`.
  - `provisioning.service.spec.ts` : 6 cas (liste normale, **liste vide sans erreur**,
    compte sans rôle, héritage adjoint, dédoublonnage, mode PROPOSITION).
- **Vérifs** : build ✅ ; tests ✅ 17/17.
- **Test HTTP réel** (serveur lancé, JWT frais, profil `6fc93835-…` repositionné par rôle) :
  - role `ASSUREUR_INFORMATIQUE` → **200**, 18 rôles (ASSUREUR 8 / CENTRE_MEDICAL 4 / PHARMACIE 2 / SOCIETE 4)
  - role `ASSUREUR_COMPTABLE` → **200 + `[]`** (liste vide, PAS d'erreur — cas explicitement demandé)
  - role `SUPERADMIN_PRINCIPAL` → **200**, 3 rôles, scope null
  - role `PHARMACIE_PHARMACIEN` → **200**, 1 rôle PHARMACIE_CAISSIERE mode PROPOSITION
  - RLS : `peut_creer_role()` testée avec `request.jwt.claims` simulé (profil = ASSUREUR_INFORMATIQUE) :
    `ASSUREUR_COMPTABLE`+org propre → true ; +autre org → false ; scope null → false ;
    `ASSUREUR_DIRECTION` (non autorisé) → false ; `PHARMACIE_CAISSIERE` (proposition) → false.
  - **Cohérence formulaire ↔ RLS confirmée** : chaque rôle listé passe `peut_creer_role` avec
    l'org de l'appelant ; les rôles non listés échouent.
  - Profil de test remis à `role = ASSUREUR_INFORMATIQUE` en fin de test.
- Serveur arrêté ensuite.

## 2026-09-09 — apps/web : premiers écrans réels /login + /dashboard
- **Bloc d'auth Supabase UI** ajouté via `npx shadcn add https://supabase.com/ui/r/password-based-auth-nextjs.json`
  (22 fichiers) : `components/{login,sign-up,forgot-password,update-password}-form`,
  `components/{logout-button}`, `components/ui/{button,card,input,label}`, `app/auth/*`
  (sign-up, forgot-password, update-password, confirm route, error), `proxy.ts`, `lib/{middleware,safe-next-path}`.
- **Réconciliation** :
  - Clients Supabase : `lib/supabase/client.ts` + `server.ts` conservés comme sources uniques
    (orphelins `lib/client.ts` / `lib/server.ts` générés → supprimés). Le bloc importait déjà `@/lib/supabase/*`.
  - Env standardisé sur `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ex-`ANON_KEY`) + `API_URL`.
  - Redirections : `/protected` → `/dashboard`, `/auth/login` → `/login` (middleware, forms, logout).
  - `proxy.ts` corrigé pour Next 16 : `export function proxy` (ex-`middleware`).
  - `components/ui/*` : import `cn` depuis `@/lib/utils` (pas le paquet `cn`) ; paquet `cn` retiré.
  - Ajouts : `components/ui/badge.tsx`, `components/brand.tsx`.
- **Écrans** :
  - `app/login/page.tsx` : layout brandé (composant `Brand`, dégradé discret) + `<LoginForm/>`.
  - `app/dashboard/page.tsx` : **server component** protégé. `getUser()` → redirect `/login` sinon ;
    `getSession()` → token ; `fetch(API_URL + /api/v1/identity/me, Bearer)`. Rendu : rôle, libellé,
    badge entité, permissions (niveau, peutValider, rôle médical, roleChain, dashboardRoute),
    périmètre multi-tenant, `<details>` JSON brut. États 401 / 404 (profil non provisionné) / erreur réseau.
  - `app/page.tsx` → `redirect('/dashboard')`.
- **Tailwind : rétrogradé v4 → v3** (`^3.4.17`) — Smart App Control bloque le binaire natif
  `@tailwindcss/oxide` (v4) et v4 n'a pas de fallback WASM auto. Ajout `tailwind.config.ts`
  (tokens shadcn neutral HSL), `postcss.config.mjs` → `tailwindcss` + `autoprefixer`,
  `globals.css` ré-écrit en syntaxe v3. `tailwindcss-animate` non ajouté (aucun composant
  ne l'utilise encore). Détails + conditions de réexamen → `SECURITY.md`.
- **Build : Webpack** (`next build/dev --webpack`) — Turbopack exige les bindings natifs SWC
  que SAC bloque (fallback WASM insuffisant pour Turbopack, OK pour Webpack).
- **Test HTTP réel de bout en bout** (api + web lancés, connexion Supabase via cookie jar) :
  - `GET /login` → **200** (form + brand)
  - `GET /dashboard` sans session → **307** → `/login?next=%2Fdashboard`
  - login + `GET /dashboard` authentifié → **200**, rendu complet : `ASSUREUR_INFORMATIQUE`,
    « Assurance Informatique », badge `ASSUREUR`, niveau `ADMIN`, `peutValider` oui,
    `/dashboard-assureur/informatique`, email header, bouton déconnexion, CSS Tailwind chargé.
  - Chaîne prouvée : navigateur → Supabase Auth (cookie) → Next server component → NestJS (JWKS) → Prisma → Postgres.
- **Vérifs** : `npm run build --workspace apps/web` ✅ ; tests apps/api toujours ✅ 17/17. Serveurs arrêtés.

---

## 🎯 JALON — 2026-09-09 — Première connexion réelle : chaîne complète confirmée de bout en bout

Pour la première fois, une **session utilisateur authentifiée** traverse toute la pile et
affiche des données métier réelles :

**Auth Supabase (cookie de session) → Next.js 16 (server component `/dashboard`) →
NestJS `GET /api/v1/identity/me` (JWT vérifié via JWKS) → Prisma → Postgres → retour rendu.**

- Utilisateur `armelk01@yahoo.fr`, profil `6fc93835-…`, **rôle `ASSUREUR_INFORMATIQUE`
  affiché correctement** avec son libellé « Assurance Informatique », l'entité `ASSUREUR`,
  le niveau d'accès `ADMIN`, `peutValider`, la `dashboardRoute`, et le périmètre org.
- Redirection `/dashboard` → `/login` opérationnelle quand il n'y a pas de session.
- Contexte du test : serveurs `apps/api` + `apps/web` lancés en local, connexion via une
  vraie session Supabase, requêtes HTTP réelles vers le serveur Next.js (pas un clic dans
  un navigateur graphique, mais l'intégralité du chemin d'exécution runtime).

**Décision de stack actée à ce jalon** : `apps/web` utilise **Tailwind CSS v3** (et non v4).
Cause : Smart App Control (Windows 11) bloque le binaire natif `@tailwindcss/oxide` de la
v4, qui n'a pas de fallback WASM automatique. v3 est 100 % JavaScript. Analyse complète,
autres contournements SAC (git → SSH, Next SWC → WASM, build → Webpack) et conditions de
réexamen : **`SECURITY.md`**.

Prochaines étapes possibles : PROMPT 6 (invitations sécurisées) puis PROMPT 7 (interface de
gestion des comptes, qui consommera `GET /api/v1/identity/roles-proposables`).

## 2026-09-09 — PROMPT 8 : module plan/ + produits versionnés + garanties
- **Base Supabase** (`apps/api/prisma/sql/004_prompt8_produits_garanties.sql`) :
  - Table `produits` : id, organisation_id (FK), nom, version (int ≥ 1), statut
    (CHECK `BROUILLON|PUBLIE|ARCHIVE`), date_publication, timestamps, deleted_at.
    **UNIQUE (organisation_id, nom, version)** — une police référencera toujours une
    (org, nom, version) FIGÉE. CHECK de cohérence statut↔date_publication.
  - Table `garanties` : produit_id (FK cascade), categorie_acte, taux_couverture / plafonds
    / franchise / ticket_moderateur en **`numeric` (Decimal, jamais float)** avec CHECK de
    bornes (0–100 pour les %), delai_carence_jours, reseau_soins (CHECK
    `CONVENTIONNE_SEUL|TOUT_RESEAU`), exclusions `text[]`, timestamps, deleted_at.
  - Fonction `profil_a_role(organisation_id, roles[])` SECURITY DEFINER — **même pattern
    que `peut_creer_role` (PROMPT 5)** : rôle de `auth.uid()` + parent (héritage adjoint),
    membership dans la liste, même organisation.
  - RLS : `produits_lecture` / `garanties_lecture` = toute personne de l'organisation
    (produits PUBLIE largement visibles pour la souscription) ; `produits_ecriture` /
    `garanties_ecriture` = `ASSUREUR_DIRECTION` / `ASSUREUR_INFORMATIQUE` via `profil_a_role`.
    `garanties_ecriture` bloque aussi si le produit n'est plus `BROUILLON` (défense en profondeur).
- **Prisma** : `db pull --force` puis schéma ré-écrit — 10 modèles (ajout `Produit`,
  `Garantie` avec `Decimal`). `generate` OK.
- **apps/api** — module `plan/` :
  - `PlanService` : `creerProduit` (BROUILLON v1 ; refus si un produit actif du même nom
    existe → `/nouvelle-version`), `ajouterGarantie`, `publier` (BROUILLON→PUBLIE, exige ≥ 1
    garantie, pose `date_publication`), `archiver`, `creerNouvelleVersion` (clone produit +
    garanties en BROUILLON v+1), `modifier/supprimerGarantie`, `modifierProduit`.
    **Immutabilité** : toute écriture sur un produit non-BROUILLON → `ConflictException` (409).
    Scope strict `organisation_id`, rôle via `roleChain` (comme tenant/), audit `log_audit()`
    en transaction, cross-org → 404.
  - `PlanController` : 10 routes REST sous `/api/v1/plan/produits`.
  - `plan.service.spec.ts` : 7 cas dont les 3 exigés (création + publication ; refus de
    modification d'un produit publié — garantie/produit/ajout ; refus de publication par un
    rôle non autorisé) + refus publication sans garantie / sans organisation / clone de version.
- **Vérifs** : build ✅ ; tests **24/24** ✅.
- **Test HTTP réel** (serveur lancé, JWT frais, profil `6fc93835-…` = ASSUREUR_INFORMATIQUE) :
  - `POST /plan/produits` → **201** BROUILLON v1 ; 2× `POST /:id/garanties` → **201**
    (Decimal, reseau_soins, exclusions[] persistés)
  - `POST /:id/publier` → statut **PUBLIE** + `date_publication`
  - **`PATCH /:id/garanties/:gid` sur produit PUBLIE → 409** (cas critique demandé) ;
    `POST /:id/garanties` → **409** ; `PATCH /:id` (renommage) → **409**
  - `POST /:id/nouvelle-version` → **201** BROUILLON **v2** avec 2 garanties clonées ;
    `PATCH` d'une garantie de la v2 (BROUILLON) → **200**
  - profil repositionné en `ASSUREUR_COMPTABLE` → `POST /plan/produits` → **403** ; puis remis
  - RLS `profil_a_role()` (jwt.claims simulé) : rôle+org OK → true ; autre org → false ;
    rôle hors liste → false
  - `audit_log` : CREATION_PRODUIT×2, AJOUT_GARANTIE×2, PUBLICATION_PRODUIT, NOUVELLE_VERSION_PRODUIT,
    MODIFICATION_GARANTIE — alimenté correctement
- Serveur arrêté. Profil de test remis à `ASSUREUR_INFORMATIQUE`.
- ⚠️ **Données de test ajoutées en base à supprimer avant prod** : produits « Formule
  Essentielle » (v1 BROUILLON orpheline d'un 1er essai) et « Formule Essentielle NNNNN »
  (v1 PUBLIE + v2 BROUILLON) avec leurs garanties, + lignes `audit_log` associées.

## 2026-09-09 — PROMPT 9 : module policy/ + polices (machine à états) + avenants
- **Base Supabase** (`apps/api/prisma/sql/005_prompt9_polices_avenants.sql`) :
  - Séquence `polices_numero_seq` + colonne `numero_police` UNIQUE avec DEFAULT
    `POL-YYYY-NNNNNN` (généré en base).
  - Table `polices` : organisation_id / souscripteur_id / produit_id (FK), statut CHECK
    (`DEVIS|EN_SOUSCRIPTION|ACTIVE|SUSPENDUE|RENOUVELEE|RESILIEE|NON_RENOUVELEE`),
    date_debut / date_fin, CHECK période cohérente.
  - **Trigger `polices_produit_publie`** (before insert / update of produit_id) : rejette
    toute police dont le produit référencé n'est pas `PUBLIE` (défense en profondeur ;
    PolicyService vérifie aussi).
  - Table `avenants` : police_id (FK cascade), type CHECK (6 valeurs), date_effet,
    date_creation, cree_par (FK profils), proratisation_appliquee bool, impact_cotisation
    `numeric(14,2)`, statut CHECK (`BROUILLON|APPLIQUE|ANNULE`).
  - RLS (**même `profil_a_role()` que PROMPTs 5 / 8**) : lecture = personnel ASSUREUR de
    l'org **OU** le souscripteur concerné (`profils.societe_id = polices.souscripteur_id` —
    un SOCIETE_ADMINISTRATION voit sa propre police) ; écriture = `ASSUREUR_DIRECTION` /
    `ASSUREUR_EXPLOITATION` / `ASSUREUR_INFORMATIQUE`.
- **Prisma** : `db pull --force` puis schéma ré-écrit — 12 modèles (ajout `Police`,
  `Avenant`). Ajout dépendance `decimal.js` (calcul de proratisation). `generate` OK.
- **apps/api** — module `policy/` :
  - `policy.types.ts` : `TRANSITIONS_POLICE` = machine à états STRICTE
    (DEVIS→EN_SOUSCRIPTION→ACTIVE ; ACTIVE→{SUSPENDUE,RENOUVELEE,RESILIEE,NON_RENOUVELEE} ;
    SUSPENDUE→ACTIVE). Toute transition absente → `ConflictException`.
  - `PolicyService` : `creerDevis` (vérifie produit **PUBLIE**), `souscrire`
    (DEVIS→EN_SOUSCRIPTION→ACTIVE, chaque étape validée par la machine), `changerStatut`
    (applique `TRANSITIONS_POLICE`), `creerAvenant` (proratisation via **decimal.js** :
    `impact = tarif_mensuel × jours_restants / jours_total`, arrondi 2 déc.),
    `appliquer/annulerAvenant`. Scope `organisation_id` + société pour la lecture, audit
    `log_audit()` en transaction.
  - `PolicyController` : 9 routes REST `/api/v1/policy/polices`.
  - `policy.service.spec.ts` : 9 cas dont les 4 exigés (souscription DEVIS→ACTIVE ; refus
    transition invalide DEVIS→ACTIVE direct ; refus devis sur produit BROUILLON ;
    proratisation AJOUT_ADHERENT milieu de période = **5027.47**).
- **Vérifs** : build ✅ ; tests **33/33** ✅.
- **Test HTTP réel** (serveur lancé, JWT frais, profil = ASSUREUR_INFORMATIQUE) :
  - `POST /policy/polices` (produit PUBLIE) → **201** DEVIS, `numero=POL-2026-000001`
  - **`POST /:id/statut {ACTIVE}` sur DEVIS → 409** (cas critique : pas de saut d'étape)
  - **`POST /policy/polices` avec produit BROUILLON → 400** (cas critique : produit non PUBLIE)
  - `POST /:id/souscrire` → **ACTIVE** (via EN_SOUSCRIPTION), dates posées
  - `ACTIVE→DEVIS` → **409** ; `ACTIVE→SUSPENDUE` → OK ; `SUSPENDUE→ACTIVE` (réactivation) → OK
  - avenant AJOUT_ADHERENT (dateEffet 2026-07-01, tarif 10000) → `proratisationAppliquee=true`,
    **`impactCotisation=5027.47`** ; appliquer → APPLIQUE ; annuler → ANNULE
  - `ACTIVE→RESILIEE` → OK (date_fin posée) ; `RESILIEE→ACTIVE` → **409**
  - profil → `ASSUREUR_COMPTABLE` → `POST /policy/polices` → **403** ; puis remis
  - RLS `profil_a_role()` (jwt.claims simulé) : rôle+org OK → true ; autre org / rôle hors liste → false
  - `audit_log` : 8 entrées policy (CREATION_DEVIS, SOUSCRIPTION_POLICE, CHANGEMENT_STATUT_POLICE×3,
    CREATION_AVENANT, APPLICATION_AVENANT, ANNULATION_AVENANT)
- Serveur arrêté. Profil de test remis à `ASSUREUR_INFORMATIQUE`.
- ⚠️ **Données de test en base à supprimer avant prod** (en plus des précédentes) :
  police `POL-2026-000001` (statut RESILIEE) + son avenant, + lignes `audit_log` associées.

## 2026-09-09 — PROMPT 11 : module billing/ + tarification collective
- **Base Supabase** (`apps/api/prisma/sql/006_prompt11_billing.sql`) :
  - `grilles_tarifaires` : organisation_id / produit_id (FK), tranche_age_min/max,
    `souscripteur_id` NULL = tarif STANDARD / renseigné = tarif NÉGOCIÉ, montant_mensuel
    `numeric`. Index uniques partiels (1 standard par tranche, 1 négocié par (souscripteur, tranche)).
  - `plan_paiement_collectivite` : periodicite CHECK (MENSUELLE/TRIMESTRIELLE/SAISONNIERE/
    ANNUELLE), part_membre_pourcent + part_subvention_pourcent (CHECK = 100), echeances jsonb.
    **Trigger** : souscripteur obligatoirement de type COLLECTIVITE. Unique 1 plan actif par souscripteur.
  - `cotisations` : police_id (FK), `adherent_id` **XOR** `societe_id` (CHECK), periode, montant_du /
    montant_paye / penalite_appliquee `numeric`, date_echeance, statut CHECK (A_PAYER/PAYEE/
    EN_RETARD/ANNULEE). Index uniques partiels (police, cible, periode).
  - RLS (**même `profil_a_role()` que PROMPTs 5/8/9**) : écriture = `ASSUREUR_COMPTABLE` /
    `ASSUREUR_INFORMATIQUE` ; lecture cotisations élargie au souscripteur concerné (comme les polices).
- **Prisma** : `db pull --force` puis schéma ré-écrit — **15 modèles** (ajout `GrilleTarifaire`,
  `PlanPaiementCollectivite`, `Cotisation` en `Decimal`). `generate` OK.
- **apps/api** — module `billing/` :
  - `BillingService.calculerCotisation` : priorité **grille NÉGOCIÉE** (souscripteur) > grille
    STANDARD (produit), par tranche d'âge ; applique `part_membre_pourcent` si COLLECTIVITE avec
    plan subventionné. **Tous les calculs via decimal.js**, montants renvoyés en chaîne 2 décimales.
  - `genererCotisationsPeriode` (1 ligne par adhérent, saute les doublons), `enregistrerPaiement`
    (PAYEE si `montant_paye ≥ montant_du + pénalité`), `marquerEnRetard` (tâche : A_PAYER échues →
    EN_RETARD + pénalité `montant_du × taux`, taux 0 par défaut — table `baremes_penalite`
    pas encore créée, mécanisme en place, v14 §7). CRUD grilles (`creerGrille` / `listerGrilles`).
  - `BillingController` : 8 routes `/api/v1/billing`.
  - `billing.service.spec.ts` : 5 cas (dont les 4 exigés : tarif standard par tranche ; tarif
    négocié qui prime ; subvention collectivité part_membre < 100 ; passage EN_RETARD).
- **Vérifs** : build ✅ ; tests **38/38** ✅.
- **Test HTTP réel** (serveur lancé, JWT frais, profil = ASSUREUR_INFORMATIQUE) :
  - grille STANDARD (18-59 : 12000) créée ; re-création → **409** (message clair)
  - `POST /billing/cotisations/calculer` (police ENTREPRISE, âge 35), **sans** grille négociée →
    montantDu **12000.00**, source STANDARD
  - grille NÉGOCIÉE ACME (18-59 : 9500) créée
  - **`calculer` (même police, âge 35) → montantDu 9500.00, source NEGOCIE** — le tarif négocié
    prend bien priorité en conditions réelles (cas critique demandé)
  - `calculer` police COLLECTIVITE (plan 60/40, âge 35) → tarifBase 12000.00, **montantDu 7200.00**
    (12000 × 60 %), partMembrePourcent 60
  - `genererCotisationsPeriode` → cotisation montantDu 9500 (utilise le négocié), échéance +30 j
  - `enregistrerPaiement` : +5000 → A_PAYER ; +4500 → **PAYEE**
  - `marquerEnRetard` sur une cotisation échue → **misEnRetard: 1**, EN_RETARD, pénalité 0.00
  - profil → `ASSUREUR_EXPLOITATION` → `POST /billing/grilles-tarifaires` → **403** ; puis remis
  - RLS `profil_a_role()` (jwt.claims simulé) : rôle+org OK → true ; autre org / rôle hors liste → false
  - `audit_log` : 7 entrées billing (CREATION_GRILLE_TARIFAIRE×2, GENERATION_COTISATION×2,
    ENREGISTREMENT_PAIEMENT×2, PASSAGE_EN_RETARD)
- Serveur arrêté. Profil de test remis à `ASSUREUR_INFORMATIQUE`.
- ⚠️ **Données de test en base à supprimer avant prod** (en plus des précédentes) : 2 polices
  `d1d1d1d1-…`/`d2d2d2d2-…` (ACTIVE), 1 `plan_paiement_collectivite` (Mutuelle 60/40),
  2 grilles tarifaires, 2 cotisations, + lignes `audit_log` associées.
- Note technique : sur cette machine, ne pas lancer `npm run build` pendant que `start:dev`
  (watch) tourne — course entre `deleteOutDir` et le watcher → `MODULE_NOT_FOUND` sur `dist/main`.
  Utiliser `start:prod` après un build propre pour les tests, ou arrêter le watch avant.

## 2026-09-09 — PROMPT 10 (ORIGINAL) : module underwriting/ — rattrapé après le PROMPT 11
> C'est le **PROMPT 10** de la séquence (questionnaire médical + tarification individuelle),
> traité APRÈS le PROMPT 11 (billing) faute d'ordre strict. Il n'y avait pas de dépendance
> bloquante : `underwriting` ré-utilise `grilles_tarifaires` (créée au PROMPT 11) pour la
> prime de base — c'est la seule raison pour laquelle l'inversion a fonctionné sans accroc.

- **Base Supabase** (`apps/api/prisma/sql/007_prompt10_underwriting.sql`) :
  - `questionnaires_medicaux` : souscripteur_id (FK), reponses jsonb, antecedents_declares text[],
    date_soumission, `decision` NULLABLE CHECK (ACCEPTE / ACCEPTE_AVEC_EXCLUSION / ACCEPTE_SURPRIME
    / REFUSE), exclusions_specifiques text[], surprime_pourcent numeric, valide_par (FK profils),
    date_decision. CHECK `decision ⟺ (valide_par + date_decision)`. **Trigger** : souscripteur
    obligatoirement de type INDIVIDUEL. Unique 1 questionnaire actif / souscripteur.
  - `tarification_individuelle` : police_id / questionnaire_medical_id (FK), age_a_souscription,
    prime_base + surprime_medicale numeric, **`prime_finale` GENERATED ALWAYS AS
    (prime_base + surprime_medicale) STORED**.
  - **RLS — SÉPARATION STRICTE (v10 §3)** :
    - `questionnaires_medicaux` : SELECT / UPDATE / DELETE via `profil_a_role(..., ['ASSUREUR_MEDECIN_SOUSCRIPTEUR'])`
      **uniquement** (INSERT aussi ouvert au souscripteur lui-même). `ASSUREUR_MEDECIN_CONSEIL`
      n'apparaît dans **aucune** liste et n'a **aucune parenté** avec SOUSCRIPTEUR → `profil_a_role`
      renvoie `false` pour lui → **AUCUN accès, ni lecture ni écriture**.
    - `tarification_individuelle` : lecture ASSUREUR org + souscripteur ; écriture DIRECTION /
      EXPLOITATION / MEDECIN_SOUSCRIPTEUR.
- **Prisma** : `db pull --force` puis schéma ré-écrit — **17 modèles** (ajout `QuestionnaireMedical`,
  `TarificationIndividuelle` ; `primeFinale` marquée lecture seule — colonne GENERATED).
- **apps/api** — module `underwriting/` :
  - `UnderwritingService` : `soumettreQuestionnaire` (par le souscripteur ou le médecin
    souscripteur ; souscripteur INDIVIDUEL requis), `evaluerQuestionnaire` (**garde centrale
    `assertMedecinSouscripteur` → 403 pour tout autre rôle, CONSEIL inclus**),
    `calculerPrime` (prime_base depuis grille STANDARD par âge + surprime `× surprime_pourcent`
    via **decimal.js** ; refuse si questionnaire non évalué ou REFUSE), `obtenir` / `lister`
    (médecin souscripteur OU souscripteur concerné, sinon 403).
  - `UnderwritingController` : 5 routes `/api/v1/underwriting`.
  - `underwriting.service.spec.ts` : **7 cas**, dont **LE test exigé** : un `ASSUREUR_MEDECIN_CONSEIL`
    qui tente d'évaluer → **403** (+ ne peut même pas charger le questionnaire), + il ne peut pas
    lire, + le SOUSCRIPTEUR peut évaluer, + soumission par le souscripteur, + refus ACCEPTE_SURPRIME
    sans surprime, + calcul de prime (10000 → surprime 20 % → 2000).
- **Vérifs** : build ✅ ; tests **44/44** ✅.
- **Test HTTP réel — DEUX profils Supabase distincts** :
  - 2ᵉ utilisateur créé via l'API Admin (compte de test `ASSUREUR_MEDECIN_CONSEIL`,
    supprimé depuis — voir 2026-09-10) + profil `ASSUREUR_MEDECIN_CONSEIL` ; profil
    principal `6fc93835-…` repositionné en `ASSUREUR_MEDECIN_SOUSCRIPTEUR`.
    (Note : l'API Admin Supabase refuse la clé `sb_secret_` avec `Invoke-RestMethod` — « secret key
    in browser » — utilisée via `curl.exe`.)
  - **SOUSCRIPTEUR** : `POST /underwriting/questionnaires` → **201** ; `POST /:id/evaluer`
    (ACCEPTE_SURPRIME 20 %) → **201**, `validePar` = son uid ; relit → **200** voit la décision ;
    `POST /underwriting/tarifications` (âge 40) → **201**, primeBase 12000, surprime **2400**,
    **primeFinale 14400** (colonne GENERATED)
  - **CONSEIL** : `POST /:id/evaluer` → **403** ; `GET /:id` → **403** ; `GET /questionnaires`
    (liste) → **403** ; `POST /underwriting/tarifications` → **403**
  - RLS `profil_a_role()` (jwt.claims simulé) : user CONSEIL + `['ASSUREUR_MEDECIN_SOUSCRIPTEUR']`
    → **false** ; user SOUSCRIPTEUR → **true**
  - `audit_log` : 3 entrées (SOUMISSION_QUESTIONNAIRE, DECISION_QUESTIONNAIRE, CALCUL_PRIME_INDIVIDUELLE)
- Serveur arrêté. Profil de test remis à `ASSUREUR_INFORMATIQUE`.
- Correctif annexe : `decimal.js` (ajouté au PROMPT 9) n'avait pas été committé dans
  `package-lock.json` (le `git add apps/api` manquait la racine) — corrigé dans ce commit.
- ⚠️ **Données de test en base à supprimer avant prod** (en plus des précédentes) : souscripteur
  INDIVIDUEL `50c1a1a1-…1111` + police `50c1a1a1-…2222`, questionnaire + tarification associés,
  + lignes `audit_log`. (Le compte de test `ASSUREUR_MEDECIN_CONSEIL` associé a été supprimé
  le 2026-09-10 — voir l'entrée « Nettoyage des comptes de test ».)

## 2026-09-09 — Frontend : structure de navigation d'`apps/web`
- Objectif : coquille de navigation générale (landing publique + dispatch de dashboard +
  layout `/dashboard-assureur/*` filtré par permissions). Pas de logique métier, pages vides.
- Note : la skill `frontend-design` demandée n'est pas disponible dans cet environnement —
  rendu réalisé avec les primitives shadcn déjà installées et le composant `Brand`.
- **Créé :**
  - `apps/web/lib/identity.ts` — chargeur d'identité serveur mutualisé (`React.cache`) :
    `chargerIdentiteBrut` (getUser → getSession → `GET /api/v1/identity/me`), états
    `anonyme | ok | non-provisionne | erreur` ; `exigerIdentite(cible)` (redirige `/login?next=`),
    `aUneSession()`. Type `IdentityMeProvisionne` (permissions non-null garanti).
  - `apps/web/lib/dashboard-nav.ts` — modèle de nav : `NavItem` (label, href, icône lucide,
    `minNiveau`, `requiertValidation`, `bientot`), `NAV_PAR_DASHBOARD` (INFORMATIQUE :
    Vue d'ensemble / Souscripteurs / Produits / Polices / Cotisations / Utilisateurs),
    `navPourDashboard(route)`, `RANG_NIVEAU`.
  - `apps/web/components/ecran-message.tsx` — écran pleine page brandé (tonalités
    neutre / attention / erreur) + déconnexion + retour accueil.
  - `apps/web/components/page-titre.tsx`, `apps/web/components/section-vide.tsx` — en-tête
    de page + placeholder pointillé pour les sections non implémentées.
  - `apps/web/components/dashboard/shell.tsx` (`'use client'`) — sidebar : `Brand`, carte
    rôle (libellé + badge entité + badge niveau d'accès + badge « Validation » si `peutValider`),
    nav filtrée (`niveauAcces` vs `minNiveau`, `peutValider` vs `requiertValidation`,
    liens `bientot` non cliquables), déconnexion ; en-tête avec e-mail ; nav mobile horizontale.
  - `apps/web/app/page.tsx` — landing minimaliste : `Brand`, badge « Plateforme métier —
    Côte d'Ivoire », titre court, bouton « Se connecter » → `/login`. Redirige vers `/dashboard`
    si session active.
  - `apps/web/app/dashboard/page.tsx` — devient un dispatcher : `non-provisionne` →
    écran « Votre compte n'a pas encore de rôle assigné, contactez votre administrateur » ;
    `erreur` → écran d'erreur lisible ; sinon `redirect(dashboardRoute)`.
  - `apps/web/app/dashboard-assureur/layout.tsx` — layout partagé (garde `entite === 'ASSUREUR'`,
    monte le `DashboardShell` avec les permissions d'`identity/me`).
  - `apps/web/app/dashboard-assureur/informatique/layout.tsx` + `page.tsx` (Vue d'ensemble,
    cartes de sections) + 5 sous-pages vides : `souscripteurs`, `produits`, `polices`,
    `cotisations`, `utilisateurs` (lien actif mais page « bientôt » — PROMPT 7 pas fait).
  - `apps/web/lib/middleware.ts` — `/` ajouté aux routes publiques.
- **Test navigateur réel** (serveurs `next start` + `nest` en mode prod, login
  `armelk01@yahoo.fr` via `@supabase/ssr`, cookies réels) :
  - `GET /` anonyme → 200, landing rendue (titre + « Se connecter »).
  - `GET /dashboard` anonyme → 307 `/login?next=%2Fdashboard`.
  - `GET /dashboard` authentifié → 307 `/dashboard-assureur/informatique`.
  - `GET /dashboard-assureur/informatique` → 200 : libellé rôle « Assurance Informatique »,
    badge entité `ASSUREUR`, badge niveau « Administration », badge « Validation »,
    nav Souscripteurs / Produits / Polices / Cotisations, Utilisateurs marqué « bientôt »,
    lien « Se déconnecter », titre « Vue d'ensemble », sous-pages `souscripteurs` /
    `utilisateurs` → 200.
  - Écran non-provisionné : rôle du profil de test mis à `null` en base → `GET /dashboard`
    rend « …pas encore de rôle… contactez votre administrateur » (200, pas d'erreur brute) ;
    rôle restauré à `ASSUREUR_INFORMATIQUE` ensuite.
- **Vérifs** : `next build --webpack` ✅ (toutes les routes présentes). Serveurs arrêtés,
  profil de test remis à `ASSUREUR_INFORMATIQUE`.

## 2026-09-09 — PROMPT 6 (rattrapage) — Invitations sécurisées + interface Super Admin
- Contexte : le PROMPT 6 (module `invitations/`) avait été sauté. Rattrapé ici avec, dans la
  foulée, l'interface Super Admin (PROMPT 7 partiel : page /utilisateurs branchée).
- **Supabase** (`prisma/sql/008_prompt6_invitations.sql`) :
  - Table `invitations` (email, telephone, role_propose FK sous_roles, organisation_id /
    societe_id / etablissement_id / pharmacie_id / adherent_id, invite_par FK profils,
    token unique, statut EN_ATTENTE_VALIDATION_INFORMATIQUE / EN_ATTENTE / ACCEPTEE /
    REJETEE / EXPIREE / REVOQUEE, mode CREATION_DIRECTE / PROPOSITION, role_validateur,
    auth_user_id, motif_rejet, `expire_le` défaut now()+72h, accepte_le). CHECK :
    validateur ⟺ mode = PROPOSITION.
  - Fonction `peut_inviter_role()` — même logique que `peut_creer_role` (héritage adjoint +
    scope organisation_id / pharmacie_id) mais SANS filtrer sur le mode. RLS INSERT
    (`invite_par = auth.uid()` + `peut_inviter_role`), SELECT (émetteur ou rôle validateur
    d'une proposition en attente), UPDATE (validateur). Défense en profondeur — le module
    NestJS passe par `postgres` (pooler) et contourne la RLS.
  - `sous_roles.dashboard_route` de SUPERADMIN_PRINCIPAL / _UTILISATEUR_ADMIN → `/superadmin`.
- **Prisma** : modèle `Invitation` ajouté à la main (17 → 18 modèles), `prisma generate`.
- **apps/api** — module `invitations/` :
  - `SupabaseAdminService` : appels `fetch` natifs (UA Node, pas « navigateur ») à l'API
    Admin GoTrue. `inviterUtilisateur` = `inviteUserByEmail` (crée le compte + envoie
    l'e-mail) avec repli sur `admin/users` si SMTP absent ; `definirMotDePasse` (PUT
    `admin/users/:id`) posé au moment de l'acceptation ; `supprimerUtilisateur` (révocation).
  - `InvitationsService` : `creerInvitation` (vérifie `regles_provisioning` AVANT tout appel
    Supabase ; mode PROPOSITION → statut EN_ATTENTE_VALIDATION_INFORMATIQUE, aucun appel
    externe), `validerProposition` / `rejeterProposition` (réservés au `roleValidateur`),
    `revoquer`, `listerMesInvitations`, `consulterParToken` (public, aucun secret),
    `accepterInvitation` (public — l'invité pose SON mot de passe, jamais généré ni stocké ;
    création du profil applicatif + audit dans une transaction). Scoping du compte créé
    dérivé de `scope_verifie`, jamais d'une valeur libre de l'appelant (sauf l'organisation
    cible d'un superadmin).
  - `InvitationsController` : `POST /invitations`, `GET /invitations`, `POST /:id/valider`,
    `/:id/rejeter`, `/:id/revoquer` (guardés) ; `GET /invitations/token/:token` +
    `POST /invitations/accepter` (PUBLICS — l'invité n'a pas encore de session).
  - `invitations.service.spec.ts` : 8 cas (règle absente → 403 ; CREATION_DIRECTE vérifie la
    règle AVANT l'API Admin ; PROPOSITION sans appel Admin ; validation refusée hors rôle
    validateur ; validation OK ; acceptation expirée → 410 ; acceptation avant validation →
    409 ; acceptation OK → mot de passe posé + profil créé + statut ACCEPTEE).
- **apps/api** — `identity/` étendu :
  - `OrganisationsService` (`GET`/`POST /identity/organisations`, réservé SUPERADMIN_PRINCIPAL).
  - `ProvisioningService.listerComptesOrganisation` (`GET /identity/comptes`) — comptes de
    l'organisation + e-mail via SQL brut sur `auth.users` (rôles ASSUREUR_INFORMATIQUE /
    _DIRECTION uniquement).
- **apps/web** :
  - `lib/api.ts` (`apiFetch` avec Bearer session, `apiFetchPublic`, `messageErreur`).
  - `/superadmin` : layout gardé SUPERADMIN_PRINCIPAL + `SuperadminShell` ; `/superadmin`
    → redirect `/superadmin/societes` ; `/superadmin/societes` (liste des organisations +
    formulaire de création + formulaire « inviter le premier compte » ASSUREUR_DIRECTION /
    _INFORMATIQUE). Server actions `creerOrganisation` / `inviterPremierCompte`.
  - `/accepter-invitation/[token]` (public, ajouté aux routes publiques du middleware) :
    contexte via `GET /invitations/token/:token`, formulaire mot de passe + confirmation →
    server action `accepterInvitation` → connexion auto + redirection dashboard.
  - `/dashboard-assureur/informatique/utilisateurs` : vraie page (lien « bientôt » retiré) —
    formulaire alimenté par `GET /identity/roles-proposables`, table des invitations en
    cours (valider / révoquer), table des comptes de l'organisation.
- **Test HTTP réel — parcours complet** (serveurs prod, compte de test `SUPERADMIN_PRINCIPAL`
  créé — supprimé depuis, voir 2026-09-10) : 14/14 OK —
  - Super Admin : `GET /superadmin` → 307 `/superadmin/societes` ; page rendue ;
    `POST /identity/organisations` → 201, organisation listée.
  - `POST /invitations` (ASSUREUR_INFORMATIQUE, `emailEnvoye=true`) → 201 statut EN_ATTENTE ;
    `GET /invitations/token/:token` (public) → `acceptable=true` ;
    `POST /invitations/accepter` → 200 `dashboardRoute=/dashboard-assureur/informatique` ;
    rejeu → 409.
  - Nouveau compte : `identity/me` → rôle ASSUREUR_INFORMATIQUE ; `GET /dashboard` → 307
    `/dashboard-assureur/informatique` ; dashboard + page `/utilisateurs` rendus, le compte
    apparaît dans la liste.
  - Cloisonnement : un non-superadmin est redirigé hors de `/superadmin` et reçoit 403 sur
    `GET /identity/organisations`.
  - `audit_log` : CREATION_ORGANISATION, CREATION_INVITATION, ACCEPTATION_INVITATION.
- **Vérifs** : build API ✅ ; `jest` **52/52** ✅ ; `next build --webpack` ✅ (20 routes).
  Données de test du parcours e2e supprimées ; serveurs arrêtés.
- (Le compte de test `SUPERADMIN_PRINCIPAL` a été supprimé le 2026-09-10 — voir l'entrée
  « Nettoyage des comptes de test ».)
- Le mode PROPOSITION (pharmacien → caissière) est couvert par les tests unitaires ; pas
  encore de parcours e2e HTTP (nécessite un profil PHARMACIE_PHARMACIEN scopé).

## 2026-09-09 — PROMPT 14 — Module provider (réseau de soins) + mode PROPOSITION validé de bout en bout
- **Supabase** (`prisma/sql/009_prompt14_provider.sql`) :
  - Table `etablissements_sante` (25 colonnes : `type_etablissement`
    HOPITAL_PUBLIC/CLINIQUE_PRIVEE/CABINET_MEDICAL/CENTRE_SANTE/LABORATOIRE/CENTRE_IMAGERIE/
    OPTICIEN/DENTISTE/MATERNITE, `code` unique, `pays` défaut « Côte d'Ivoire »,
    lat/lng `double precision` bornées, `statut`
    ACTIF/SUSPENDU/EN_ATTENTE_VALIDATION/RESILIE défaut EN_ATTENTE_VALIDATION,
    `garde_weekend`, `horaires_garde`/`horaires_semaine` jsonb, `tiers_payant` défaut true,
    `date_convention`/`date_fin_convention`).
  - Table `pharmacies` (22 colonnes : mêmes colonnes pertinentes, `statut`
    ACTIVE/SUSPENDUE/RESILIEE défaut ACTIVE, pas de `type_etablissement` ni
    `telephone_urgence` ni `horaires_semaine`).
  - RLS `profil_a_role()` (pattern PROMPT 8) : **écriture réservée à
    `ASSUREUR_INFORMATIQUE`** (v9 §2.2 — l'Informatique gère aussi le réseau de
    prestataires) ; lecture ouverte à toute personne de l'organisation.
  - Lecture publique **limitée** via deux vues (`etablissements_sante_public`,
    `pharmacies_public`) — colonnes réduites (nom, ville, commune, statut, garde_weekend,
    lat/lng), seules les lignes ACTIF/ACTIVE, `grant select to anon, authenticated`
    (pour la future recherche par les adhérents).
- **Prisma** : modèles `EtablissementSante` + `Pharmacie` (18 → 20 modèles), `prisma generate`.
- **apps/api** — module `provider/` :
  - `ProviderService` : CRUD `etablissements_sante` + `pharmacies` (soft-delete, audit
    `log_audit()` dans une transaction, `assertGestion` → `ASSUREUR_INFORMATIQUE` seul,
    `code` unique), `rechercheGeolocalisee` — **formule de Haversine** en mémoire :
    filtre par rayon, tri par distance croissante, `distanceKm` à 2 décimales, cible
    ETABLISSEMENTS/PHARMACIES/TOUS.
  - `ProviderController` : `/api/v1/provider/recherche` + `/etablissements` + `/pharmacies`
    (POST/GET/GET:id/PATCH/DELETE).
  - `provider.service.spec.ts` : 5 cas (création établissement ; refus par rôle non
    autorisé → 403 ; refus sans organisation ; recherche géo triée par distance + hors
    rayon exclu ; cible ETABLISSEMENTS n'interroge pas les pharmacies) → **jest 57/57**.
- **apps/web** :
  - `/dashboard-assureur/informatique/etablissements` et `/pharmacies` : liste (table) +
    formulaire de création (server actions `creerEtablissement` / `creerPharmacie`).
    Entrées de nav + cartes ajoutées à la vue d'ensemble.
- **Test HTTP réel — 16/16 OK** (serveurs prod) :
  - `POST /provider/etablissements` + `/pharmacies` (ASSUREUR_INFORMATIQUE) → 201.
  - `POST /provider/etablissements` par `ASSUREUR_MEDECIN_CONSEIL` → **403**.
  - Recherche géo depuis (5.32, -4.02), rayon 20 km : Bouaké (~300 km) exclu, Cocody
    (5,54 km) **avant** Yopougon (7,01 km), `distanceKm` croissant.
  - Pages `/etablissements` et `/pharmacies` rendues (200), entrées visibles.
  - **Mode PROPOSITION enfin validé de bout en bout** :
    - `ASSUREUR_INFORMATIQUE` invite un `PHARMACIE_PHARMACIEN` scopé à une pharmacie de
      test → 201 EN_ATTENTE ; acceptation → profil créé avec `pharmacieId` renseigné.
    - Le `PHARMACIE_PHARMACIEN` propose une `PHARMACIE_CAISSIERE` (`POST /invitations`) →
      statut **`EN_ATTENTE_VALIDATION_INFORMATIQUE`** (mode PROPOSITION), **pas** ACCEPTEE
      ni EN_ATTENTE ; `roleValidateur = ASSUREUR_INFORMATIQUE` ; token pas encore
      acceptable.
    - Reconnexion en `ASSUREUR_INFORMATIQUE` : la proposition apparaît dans
      `GET /invitations` ; `POST /invitations/:id/valider` → statut **`EN_ATTENTE`**,
      e-mail d'invitation envoyé.
- **Vérifs** : build API ✅ ; `jest` **57/57** ✅ ; `next build --webpack` ✅ (22 routes).
  Données de test du parcours e2e supprimées (établissements, pharmacie, profil + compte
  Supabase du pharmacien, invitations) ; serveurs arrêtés.

## 2026-09-09 — PROMPT 16 — Référentiels médicaux + gouvernance d'homologation (croisement des rôles conseil)
- **Supabase** (`prisma/sql/010_prompt16_reference.sql`) :
  - Table `referentiel_actes` (code unique, `statut` PROPOSE/HOMOLOGUE/SUSPENDU/RETIRE
    défaut PROPOSE, `homologue_par` FK profils, `date_homologation`/`date_retrait`).
  - Table `medicaments` (DCI, nom commercial, EAN, forme/dosage/conditionnement, classe
    thérapeutique, `remboursable`, `taux_remboursement_std`, `prix_reference_xof`,
    `prix_max_remboursable`, `medicament_essentiel`, `generique_disponible`,
    `ordonnance_obligatoire`, `medicament_controle`, `usage`
    AMBULATOIRE/HOSPITALIER/LES_DEUX, `statut_homologation` défaut PROPOSE, `homologue_par`).
  - **RLS — gouvernance v8 §10.2** : lecture ouverte à l'organisation ; INSERT (statut
    PROPOSE) réservé à `ASSUREUR_INFORMATIQUE` ; **deux policies UPDATE permissives** —
    l'une « informatique » avec `WITH CHECK statut <> 'HOMOLOGUE'` (l'Informatique peut
    tout sauf poser HOMOLOGUE), l'autre réservée au rôle conseil correspondant
    (`ASSUREUR_MEDECIN_CONSEIL` pour les actes, `ASSUREUR_PHARMACIEN_CONSEIL` pour les
    médicaments). Aucun autre rôle n'a de policy d'écriture → transition HOMOLOGUE
    impossible pour lui, y compris le mauvais rôle conseil.
  - **Pré-remplissage** : 16 médicaments essentiels de Côte d'Ivoire au statut PROPOSE
    (antipaludéens : Artéméther+Luméfantrine, Artésunate, Sulfadoxine-Pyriméthamine ;
    antibiotiques : Amoxicilline ±ac. clavulanique, Ceftriaxone, Métronidazole,
    Cotrimoxazole ; antihypertenseurs : Amlodipine, Nifédipine LP, Hydrochlorothiazide,
    Énalapril ; analgésiques : Paracétamol, Ibuprofène, Acide acétylsalicylique, Tramadol).
- **Prisma** : modèles `ReferentielActe` + `Medicament` (20 → 22 modèles), `prisma generate`.
- **apps/api** — module `reference/` :
  - `ReferenceService` : `proposerActe`/`proposerMedicament` (garde `ASSUREUR_INFORMATIQUE`),
    `homologuerActe` (**garde stricte `ASSUREUR_MEDECIN_CONSEIL`**),
    `homologuerMedicament` (**garde stricte `ASSUREUR_PHARMACIEN_CONSEIL`**, renseigne
    prix/taux via decimal.js), `suspendre*`, `retirer*` (rôle conseil), `reproposer*`
    (informatique). **Machine à états** : `assertTransitionVersHomologue` → on n'homologue
    QUE depuis PROPOSE (un élément SUSPENDU/RETIRE doit d'abord être re-proposé), même
    logique que la machine à états des polices.
  - `ReferenceController` : `/api/v1/reference/actes` + `/medicaments`
    (proposer/lister/obtenir/homologuer/suspendre/retirer/reproposer).
  - `reference.service.spec.ts` : **9 cas**, dont **LE croisement** :
    `ASSUREUR_PHARMACIEN_CONSEIL` homologue un acte → 403 ; `ASSUREUR_MEDECIN_CONSEIL`
    homologue un médicament → 403 ; `ASSUREUR_INFORMATIQUE` ne peut homologuer ni l'un ni
    l'autre ; homologation depuis SUSPENDU/RETIRE → 409. → **jest 66/66**.
- **apps/web** :
  - `/dashboard-assureur/medecin-conseil` (+ `/actes-a-homologuer`) et
    `/dashboard-assureur/pharmacien-conseil` (+ `/medicaments-a-homologuer`) — layout
    gardé par `dashboardRoute`, `HomologationPanneau` (compteurs par statut, boutons
    Homologuer / Suspendre / Re-proposer selon le statut). Entrées de nav ajoutées.
- **Test HTTP réel — 16/16** (compte de test `ASSUREUR_PHARMACIEN_CONSEIL` créé —
  supprimé depuis, voir 2026-09-10) :
  - `ASSUREUR_INFORMATIQUE` propose des actes (PROPOSE) ; `ASSUREUR_MEDECIN_CONSEIL`
    homologue un acte → HOMOLOGUE.
  - **CROISEMENT** : `ASSUREUR_PHARMACIEN_CONSEIL` homologue un acte → **403** ;
    `ASSUREUR_MEDECIN_CONSEIL` homologue un médicament → **403** ; `ASSUREUR_INFORMATIQUE`
    homologue (acte ou médicament) → **403**.
  - `ASSUREUR_PHARMACIEN_CONSEIL` homologue un médicament → HOMOLOGUE + `remboursable`
    + `taux_remboursement_std = 80.00` (vérifié en base).
  - Machine à états : suspension d'un acte HOMOLOGUE → SUSPENDU ; ré-homologation directe
    → **409** ; re-proposition par l'Informatique → PROPOSE ; ré-homologation → HOMOLOGUE.
  - Pages web rendues (200) ; cloisonnement : le médecin conseil ne peut ouvrir le
    dashboard pharmacien conseil (redirect 307).
  - `audit_log` : PROPOSITION_ACTE, HOMOLOGATION_ACTE, SUSPENSION_ACTE, REPROPOSITION_ACTE,
    HOMOLOGATION_MEDICAMENT.
- **Vérifs** : build API ✅ ; `jest` **66/66** ✅ ; `next build --webpack` ✅ (26 routes).
  Actes de test supprimés ; les 16 médicaments essentiels remis à PROPOSE (données de
  démo « à homologuer ») ; serveurs arrêtés.
- (Le compte de test `ASSUREUR_PHARMACIEN_CONSEIL` a été supprimé le 2026-09-10 — voir
  l'entrée « Nettoyage des comptes de test ».)

## 2026-09-09 — PROMPT 17 — Dossier de Soins + Numéro de Traitement (module care-episode)
- **Supabase** (`prisma/sql/011_prompt17_care_episode.sql`) :
  - Table `dossiers_soins` (v1 §15.1) : `numero_traitement` unique généré par séquence
    au format **TRT-YYYY-MM-NNNNNN**, `adherent_id`/`beneficiaire_id` nullables (CHECK :
    au moins un), `etablissement_id` FK etablissements_sante, `police_id` FK polices,
    `plan_couverture_id` FK garanties, `statut`
    OUVERT/SUSPENDU/TRANSFERE/CLOTURE/FORCE_CLOS, flags d'éligibilité (`carte_valide`,
    `adherent_eligible`, `aucun_dossier_ouvert`, `hors_delai_carence`), `blocage_raison`,
    `cloture_par`/`cloture_motif`/`cloture_type` (NORMALE|FORCEE), `transfere_vers`,
    `dossier_origine` (self-FK). **Index unique partiel** : un seul dossier OUVERT par
    patient (garde-fou du MoteurOuvertureDossier).
  - Table `consultations_dossier` : `numero_consultation` unique généré (CST-YYYY-MM-NNNNNN),
    `dossier_soins_id` FK, `medecin_id` FK profils, `statut` EN_COURS/TERMINEE/ANNULEE.
  - **Intégrité du médecin traitant (v10 §1.2)** — `medecin_id` DOIT référencer un compte
    `CENTRE_MEDICAL_MEDECIN` du **même établissement** que le dossier : vérifié par un
    **TRIGGER** `verifier_medecin_traitant()` (s'applique à tout le monde, y compris le
    rôle `postgres` du pooler) **ET** une **policy RLS** d'insertion — pas de confiance
    dans la valeur envoyée par le client.
  - RLS : lecture ouverte à l'organisation ; écriture (`profil_a_role`) réservée aux rôles
    `CENTRE_MEDICAL_*` + `ASSUREUR_EXPLOITATION` + `ASSUREUR_INFORMATIQUE`.
- **Prisma** : modèles `DossierSoins` + `ConsultationDossier` (22 → 24 modèles),
  `numeroTraitement`/`numeroConsultation` en `@default(dbgenerated(...))`, `prisma generate`.
- **apps/api** — module `care-episode/` :
  - `CareEpisodeService.ouvrirDossier` = **MoteurOuvertureDossier** (v1 §15.4) : évalue
    établissement ACTIF dans le réseau + carte valide (police ACTIVE couvrant la date du
    jour) + aucun dossier déjà OUVERT pour ce patient + hors délai de carence (via
    `garanties.delai_carence_jours` de la garantie CONSULTATION). En cas de refus →
    **409 avec la liste précise des blocages** + l'état des 4 conditions, jamais un
    message générique.
  - `ajouterConsultation` : garde applicative « médecin du même établissement » (en plus
    du trigger et de la RLS).
  - `clotureNormale` (rôles de gestion) ; `clotureForcee` (**réservée à
    `ASSUREUR_EXPLOITATION`**, `motif` obligatoire) → statut FORCE_CLOS ; les consultations
    EN_COURS passent TERMINEE à la clôture.
  - `CareEpisodeController` : `/api/v1/care-episode/dossiers` (ouvrir/lister/obtenir),
    `/:id/consultations`, `/:id/cloturer`, `/:id/cloture-forcee`.
  - `care-episode.service.spec.ts` : **8 cas** (ouverture OK ; refus si dossier déjà
    ouvert → blocage précis ; refus si police non ACTIVE → `carteValide=false` ; refus
    consultation médecin d'un autre établissement ; consultation OK bon établissement ;
    clôture forcée refusée hors EXPLOITATION ; clôture forcée EXPLOITATION → FORCE_CLOS ;
    ouverture refusée à un rôle non autorisé) → **jest 74/74**.
- **Test HTTP réel — 11/11** (2 établissements ACTIF + 2 comptes `CENTRE_MEDICAL_MEDECIN`
  provisionnés via le module invitations, police réelle `POL-2026-000004` ACTIVE et
  `POL-2026-000001` RÉSILIÉE) :
  - Ouverture d'un vrai dossier → 201, **Numéro de Traitement `TRT-2026-09-000001`**,
    `carte_valide=true`.
  - 2ᵉ ouverture pour le même patient → **409** + blocage
    « Un dossier de soins est déjà ouvert pour ce patient (TRT-…) ».
  - Ouverture avec police RÉSILIÉE → **409** + blocage « Carte non valide : la police
    n'est pas active (statut : RESILIEE) ».
  - Consultation avec le médecin de l'établissement du dossier → 201, `CST-2026-09-000001`.
  - Consultation avec un médecin d'un **autre** établissement → **403** « Le médecin
    n'appartient pas à l'établissement du dossier de soins ».
  - **Trigger Postgres** vérifié : insertion directe (hors NestJS) d'une consultation avec
    un médecin du mauvais établissement → **rejetée** par `verifier_medecin_traitant()`.
  - Clôture forcée par `ASSUREUR_INFORMATIQUE` → **403** (réservée EXPLOITATION) ; clôture
    normale → CLOTURE ; ré-ouverture du même patient ensuite → 201.
  - `audit_log` : OUVERTURE_DOSSIER_SOINS, AJOUT_CONSULTATION_DOSSIER, CLOTURE_DOSSIER_SOINS.
- **Vérifs** : build API ✅ ; `jest` **74/74** ✅. Données de test du parcours e2e
  supprimées (dossiers, consultations, établissements, profils + comptes Supabase des
  2 médecins, invitations) ; serveur arrêté. Aucun changement frontend ce prompt.

## 2026-09-09 — PROMPT 18 — Code de Consultation (module preauthorization) + verrou d'ouverture du dossier
- **Supabase** (`prisma/sql/012_prompt18_code_consultation.sql`) :
  - Table `codes_consultation` (v8 §2) : `code` unique (CHECK `^[A-Z0-9]{6,8}$`),
    `date_expiration` défaut `now()+48h`, `statut`
    EMIS/CONFIRME_PATIENT/UTILISE_ETABLISSEMENT/EXPIRE/ANNULE, `canal_envoi text[]`
    défaut `{APP,SMS}`, `dossier_soins_id` FK (rempli uniquement à la validation),
    `police_id` FK (nécessaire au MoteurOuvertureDossier).
  - RLS : **l'établissement n'a AUCUNE policy de lecture** sur cette table — le code
    n'est jamais lisible de l'établissement ; SELECT réservé à l'adhérent concerné
    (`adherent_id = profils.adherent_id`), INSERT aux rôles ADHERENT_TITULAIRE /
    SOUSCRIPTEUR_INDIVIDUEL pour eux-mêmes.
- **Prisma** : modèle `CodeConsultation` (24 → 25 modèles), `prisma generate`.
- **apps/api** — nouveau module `preauthorization/` (choix cohérent avec v19, PROMPT 18 :
  module `preauthorization/`) :
  - `genererCodeConsultation` (adhérent) : vérifie d'abord l'éligibilité via
    `CareEpisodeService.evaluerEligibilite` (**MoteurOuvertureDossier SANS ouvrir le
    dossier** — nouvelle méthode publique extraite du service), génère un code
    **`crypto.randomInt`** (jamais `Math.random`) sur un alphabet sans caractères
    ambigus (30 symboles, 8 car. → 30⁸ combinaisons), l'enregistre en EMIS et **le
    renvoie à l'adhérent uniquement** (jamais dans une réponse côté établissement).
  - `validerCodeConsultation` (établissement) : code inconnu / autre organisation →
    404 générique ; déjà UTILISE_ETABLISSEMENT → 409 ; ANNULE → 410 ; **expiré → passe
    EXPIRE + 410** ; **établissement ≠ celui d'émission → 403** ; sinon appelle
    `CareEpisodeService.ouvrirDossier(user, …, { codeConsultationId })` qui ouvre le
    dossier ET marque le code UTILISE_ETABLISSEMENT + lie `dossier_soins_id` **dans la
    même transaction**. La réponse ne contient jamais la valeur du code.
  - `confirmerPresence` / `annulerCode` / `listerMesCodes` (adhérent).
  - `PreauthorizationController` : `POST/GET /api/v1/preauthorization/codes-consultation`,
    `/:id/confirmer`, `/:id/annuler` (adhérent) ; `/codes-consultation/valider`
    (établissement).
  - `preauthorization.service.spec.ts` : **7 cas** (génération refusée hors adhérent ;
    refusée si éligibilité KO ; code sûr 8 car. + EMIS ; validation mauvais établissement
    → 403 ; code expiré → 410 + statut EXPIRE ; code déjà utilisé → 409 ; validation OK →
    `ouvrirDossier` appelé avec `codeConsultationId`, valeur du code absente de la
    réponse). → **jest 81/81**.
- **VERROU (checklist v19 : « un dossier ne peut être créé que via un code validé »)** :
  la route `POST /api/v1/care-episode/dossiers` a été **supprimée**.
  `CareEpisodeService.ouvrirDossier` est désormais un **appel interne uniquement**,
  déclenché seulement par `validerCodeConsultation`.
- **Test HTTP réel — 11/11** (compte de test `ADHERENT_TITULAIRE` avec `adherent_id`
  — recréé le 2026-09-10 sous `armelk01+adherent@gmail.com` —, 2 établissements ACTIF,
  compte `CENTRE_MEDICAL_ACCUEIL` provisionné, police réelle `POL-2026-000004` ACTIVE) :
  - L'adhérent génère un code → 201, `code` = 8 car. alphanum, statut EMIS, expiration +48 h.
  - `GET /codes-consultation` côté établissement → **liste vide** (aucun accès aux codes).
  - Validation avec le **MAUVAIS** établissement → **403** « Ce code n'a pas été émis pour
    cet établissement ».
  - Validation avec le **BON** établissement → 201, **dossier ouvert automatiquement**
    (`TRT-2026-09-000003`), code passé UTILISE_ETABLISSEMENT ; **la valeur du code n'est
    pas renvoyée**.
  - Réutilisation du même code → **409** « déjà été utilisé ».
  - Code expiré (`date_expiration` reculée en base) → **410** rejeté.
  - `POST /api/v1/care-episode/dossiers` en direct → **404** (route supprimée — aucune
    autre voie d'ouverture).
  - `audit_log` : GENERATION_CODE_CONSULTATION, VALIDATION_CODE_CONSULTATION,
    OUVERTURE_DOSSIER_SOINS.
- **Vérifs** : build API ✅ ; `jest` **81/81** ✅. Données de test du parcours e2e
  supprimées (codes, dossier, établissements, profil + compte Supabase du staff,
  invitations) ; serveur arrêté. Aucun changement frontend ce prompt.
- (Le compte de test `ADHERENT_TITULAIRE` a été recréé le 2026-09-10 sous
  `armelk01+adherent@gmail.com` — voir l'entrée « Nettoyage des comptes de test ».)

## 2026-09-10 — Nettoyage des comptes de test à domaine fictif (taux de rebond Supabase)
- **Problème** : les comptes de test créés aux prompts précédents utilisaient des adresses
  à domaine fictif (`@exemple.ci`). L'API Admin Supabase (`inviteUserByEmail`) tentait de
  leur envoyer un e-mail → rebonds → alerte « bounce rate » de Supabase.
- **Supprimés** (API Admin Supabase, la ligne `profils` part en cascade via
  `profils_id_fkey` ON DELETE CASCADE) :
  - `medecin.conseil.test@exemple.ci` (ASSUREUR_MEDECIN_CONSEIL)
  - `superadmin.test@exemple.ci` (SUPERADMIN_PRINCIPAL)
  - `pharmacien.conseil.test@exemple.ci` (ASSUREUR_PHARMACIEN_CONSEIL)
  - `adherent.test@exemple.ci` (ADHERENT_TITULAIRE)
  - `caissiere.mtupueum@exemple.ci` (orphelin — vestige du test PROMPT 14, invitation
    jamais acceptée, aucun profil)
  Vérifié au préalable : aucune FK vers ces `profils` (`questionnaires_medicaux.valide_par`,
  `referentiel_actes`/`medicaments.homologue_par`, `avenants.cree_par`,
  `consultations_dossier.medecin_id`, `dossiers_soins.cloture_par`, `invitations.invite_par`,
  `membres_comite_gestion.user_id` → tous à 0). Ligne `audit_log` orpheline (org de test
  déjà supprimée) purgée également.
- **Recréé** : **`armelk01+adherent@gmail.com`** (mot de passe `Adherent-2026`,
  `email_confirm`) — profil `ADHERENT_TITULAIRE`, organisation `aaaaaaaa-…-0001`,
  `adherent_id = 1aff894a-3cc8-426e-9365-c5a23446193e`. Adresse Gmail plus-address :
  délivrable, aucun rebond. Police active pour les tests : `POL-2026-000004`
  (`d1d1d1d1-1111-4111-8111-111111111111`, souscripteur ACME BTP).
- **Non recréés** : les rôles MEDECIN_CONSEIL / PHARMACIEN_CONSEIL / SUPERADMIN seront
  recréés **au coup par coup** quand un prompt e2e en aura réellement besoin, avec des
  adresses `armelk01+<role>@gmail.com`. Ne plus créer de compte de test par anticipation.
- **Règle** : tout compte de test créé désormais utilise `armelk01+<qqch>@gmail.com`
  (jamais de domaine fictif).
- État de `auth.users` : `armelk01@yahoo.fr` (ASSUREUR_INFORMATIQUE, réel) +
  `armelk01+adherent@gmail.com` (ADHERENT_TITULAIRE).
- Fixture unitaire `preauthorization.service.spec.ts` : e-mail mock =
  `armelk01+testunitaire@gmail.com` (aucun envoi réel — simple fixture, alignée sur la
  convention `armelk01+<qqch>@gmail.com` pour éviter toute exception qui prêterait à
  confusion).
- Cette entrée **remplace** les anciens marqueurs « ⚠️ Donnée de test conservée » des
  PROMPTs 6, 10, 16 et 17 : ces comptes n'existent plus (sauf l'adhérent, recréé).

## 2026-09-10 — PROMPT 19 — Code Référence d'Ordonnance (module preauthorization étendu)
- **Supabase** (`prisma/sql/013_prompt19_code_ordonnance.sql`) :
  - Table **`ordonnances`** (minimale, v8 §3) : `organisation_id`, `dossier_soins_id` FK,
    `consultation_id` FK, `medecin_id` FK profils, `lignes jsonb` (liste
    médicament/dosage/posologie/durée/quantité — le référentiel `medicaments` viendra
    l'affiner), `statut` ACTIVE / PARTIELLEMENT_DELIVREE / COMPLETEMENT_DELIVREE / EXPIREE /
    ANNULEE, `date_prescription`, `date_validite` défaut `now()+7 jours`.
  - Table **`codes_ordonnance`** (v8 §3) : `code` unique (même format que
    `codes_consultation`, `^[A-Z0-9]{6,8}$`), `date_expiration` défaut `now()+7 jours`
    (aligné sur la validité de l'ordonnance), `statut` EMIS / PRESENTE_PHARMACIE /
    UTILISE_PARTIEL / UTILISE_COMPLET / EXPIRE / ANNULE, `pharmacie_utilisatrice_id` FK
    (rempli à la 1ʳᵉ validation), `adherent_id` / `beneficiaire_id` (dénormalisés du
    dossier, pour la RLS).
  - **RLS — même principe que `codes_consultation`** : **aucune policy de lecture pour la
    pharmacie**, ni sur `ordonnances` ni sur `codes_ordonnance` ; `ordonnances` lisible
    par le médecin prescripteur / l'adhérent concerné / le personnel assureur ;
    `codes_ordonnance` lisible seulement par l'adhérent concerné
    (`adherent_id = profils.adherent_id`).
- **Prisma** : modèles `Ordonnance` + `CodeOrdonnance` (25 → 27 modèles), `prisma generate`.
- **apps/api** — `preauthorization/` étendu :
  - `creerOrdonnance(user, { consultationId, medecinId, lignes })` : vérifie que le médecin
    de l'ordonnance = médecin de la consultation (v10 §1) ; le prescripteur est le médecin
    lui-même ou l'administratif de son établissement ; crée l'ordonnance **ET** le
    `code_ordonnance` **dans la même transaction** ; **ne renvoie JAMAIS le code** (au
    médecin) — réponse = `{ ordonnanceId, nombreLignes, dateValidite }`.
  - `listerMesCodesOrdonnance(user)` : côté adhérent — ses codes **avec** la valeur du code
    (c'est ainsi que l'adhérent « reçoit » le code, en attendant le module notification).
  - `validerCodeOrdonnance(user, { code, pharmacieId })` : côté pharmacie — 404 code
    inconnu / autre org ; 409 UTILISE_COMPLET ; 410 ANNULE / EXPIRE (+ passe EXPIRE) ;
    **403 si déjà pris en charge par une autre pharmacie** ; sinon **RÉVÈLE le contenu
    complet de l'ordonnance** (`lignes`) — seul moment où la pharmacie y accède — et passe
    le code PRESENTE_PHARMACIE + `pharmacie_utilisatrice_id`. Re-lecture par la même
    pharmacie autorisée tant que non dispensée. La valeur du code n'est jamais renvoyée.
  - `marquerDispensation(user, codeId, { type: PARTIELLE|COMPLETE, lignesDelivrees?,
    commentaire? })` : réservé à la pharmacie qui a validé ; PARTIELLE → code
    UTILISE_PARTIEL + ordonnance PARTIELLEMENT_DELIVREE ; COMPLETE → UTILISE_COMPLET +
    COMPLETEMENT_DELIVREE.
  - `PreauthorizationController` : `POST /preauthorization/ordonnances` (médecin),
    `GET /preauthorization/codes-ordonnance` (adhérent),
    `POST /preauthorization/codes-ordonnance/valider` (pharmacie),
    `POST /preauthorization/codes-ordonnance/:id/dispensation` (pharmacie).
  - `preauthorization-ordonnance.service.spec.ts` : **8 cas** (médecin ≠ consultation →
    400 ; création OK sans code en réponse ; adhérent récupère le code ; code inconnu →
    404 ; validation OK révèle les lignes + PRESENTE_PHARMACIE ; UTILISE_COMPLET → 409 ;
    autre pharmacie → 403 ; dispensation COMPLETE). → **jest 89/89**.
- **Test HTTP réel — 13/13** (comptes créés à la nouvelle convention
  `armelk01+<role>.<stamp>@gmail.com` : médecin `CENTRE_MEDICAL_MEDECIN`, 2 pharmaciens
  `PHARMACIE_PHARMACIEN` sur 2 pharmacies distinctes ; dossier ouvert via un vrai code de
  consultation ; adhérent `armelk01+adherent@gmail.com`) :
  - `POST /ordonnances` (médecin) → 201, `{ ordonnanceId, nombreLignes: 2 }`, **code
    absent de la réponse** ; `GET /codes-ordonnance` côté médecin → **liste vide**.
  - Pharmacie avec un code bidon → **404** (aucun accès au contenu).
  - `GET /codes-ordonnance` côté adhérent → le code (`P4496JU4`, 8 car., EMIS).
  - Validation par la bonne pharmacie → **contenu complet révélé** (2 lignes), code
    PRESENTE_PHARMACIE, valeur du code non renvoyée ; re-lecture même pharmacie → OK.
  - Validation par une **autre** pharmacie → **403**.
  - Dispensation COMPLETE → code UTILISE_COMPLET + ordonnance COMPLETEMENT_DELIVREE ;
    2ᵉ lecture après dispensation totale → **409**.
  - `audit_log` : GENERATION_CODE_ORDONNANCE, VALIDATION_CODE_ORDONNANCE,
    DISPENSATION_ORDONNANCE.
- **Vérifs** : build API ✅ ; `jest` **89/89** ✅. Données de test du parcours e2e
  supprimées (ordonnance, codes, dossier, établissement, 2 pharmacies, 3 profils + comptes
  Supabase, invitations) ; serveur arrêté. Aucun changement frontend ce prompt.

## 2026-09-10 — PROMPT 20 — Ticket de Soins (module preauthorization / care-episode)
- **État constaté** : `actes_dossier` **n'existait pas** — le PROMPT 17 n'avait créé que
  `dossiers_soins` + `consultations_dossier`. Ce prompt crée donc **`actes_dossier`**
  (version minimale) en plus de `tickets_soins`.
- **Supabase** (`prisma/sql/014_prompt20_ticket_soins.sql`) :
  - Table **`tickets_soins`** (v8 §4) : `dossier_soins_id` FK **unique** (un seul ticket
    par dossier), `code` unique même format que les autres codes (`^[A-Z0-9]{6,8}$`),
    `date_cloture` nullable, `statut` OUVERT / CLOTURE / ANNULE — CHECK :
    `(statut = 'OUVERT') = (date_cloture is null)`.
  - Table **`actes_dossier`** (minimale, v1 §15) : `dossier_soins_id`, **`ticket_soins_id`**
    FK, `consultation_id` FK, `medecin_prescripteur_id` FK profils (v10 §1.2),
    `categorie_acte`, `libelle`, `code_acte`, `quantite`, `montant_prescrit`, `statut`
    PRESCRIT / REALISE / ANNULE / LIQUIDE.
  - **Trigger `verifier_ticket_ouvert()`** — BEFORE INSERT sur `actes_dossier` : refuse
    tout acte si le ticket n'est pas OUVERT, **même pour un INSERT SQL direct** (rôle
    `postgres` du pooler inclus), sur le modèle de `verifier_medecin_traitant()` (PROMPT 17).
  - RLS : lecture ouverte à l'organisation ; INSERT `actes_dossier` réservé au personnel du
    centre / assureur.
- **Prisma** : modèles `TicketSoins` + `ActeDossier` (27 → 29 modèles), `prisma generate`.
- **apps/api** :
  - **`CareEpisodeService.ouvrirDossier`** crée le `ticket_soins` (OUVERT, code
    `crypto.randomInt`) **dans la MÊME transaction** que l'ouverture du dossier — jamais
    une étape séparée oubliable. `chargerDossier` renvoie désormais `ticket` + `actes`.
  - **`CareEpisodeService.appliquerCloture`** clôture le ticket (→ CLOTURE + `date_cloture`)
    **dans la MÊME transaction** que la clôture du dossier (normale **et** forcée) —
    verrouille l'ajout d'actes.
  - `preauthorization/` étendu : `ajouterActe(user, ticketSoinsId, dto)` — garde centrale
    **ticket OUVERT sinon 409** (+ autorisation par rôle et établissement) ;
    `obtenirTicket(user, ticketSoinsId)` (avec ses actes). Routes
    `POST /api/v1/preauthorization/tickets-soins/:id/actes` et `GET …/tickets-soins/:id`.
    Aucune route pour créer/clôturer un ticket manuellement.
  - `care-episode.service.spec.ts` : +2 assertions (ticket créé à l'ouverture, clôturé à la
    clôture normale et forcée) ; `preauthorization-ticket.service.spec.ts` : **6 cas**
    (ajout sur OUVERT OK ; sur CLOTURE → 409 message clair ; sur ANNULE → 409 ; ticket
    introuvable → 404 ; autre établissement → 403 ; rôle non autorisé → 403). → **jest 96/96**.
- **Test HTTP réel — 8/8** (établissement + médecin `armelk01+medecin.<stamp>@gmail.com`,
  adhérent `armelk01+adherent@gmail.com`, dossier ouvert via un vrai code de consultation) :
  - Ouverture du dossier → **Ticket de Soins créé automatiquement** (statut OUVERT, code
    `N8D9NTQ3`) — visible dans la réponse de `validerCodeConsultation`.
  - Ajout d'un acte au ticket OUVERT → 201 ; `GET /tickets-soins/:id` → statut OUVERT +
    l'acte listé.
  - Clôture du dossier → le **Ticket de Soins passe CLOTURE automatiquement** (avec
    `date_cloture`).
  - Ajout d'un acte après clôture **via l'API** → **409** « Le ticket de soins est CLOTURE
    — impossible d'y ajouter un acte (ticket verrouillé) ».
  - Ajout d'un acte après clôture **en INSERT SQL direct** → **rejeté par le trigger**
    `verifier_ticket_ouvert()` (même message).
  - `audit_log` : OUVERTURE_TICKET_SOINS, AJOUT_ACTE_DOSSIER, CLOTURE_DOSSIER_SOINS
    (avec `ticketCloture`).
- **Vérifs** : build API ✅ ; `jest` **96/96** ✅. Données de test du parcours e2e
  supprimées (acte, ticket, dossier, consultation, code, établissement, profil + compte
  Supabase du médecin, invitation) ; serveur arrêté. Aucun changement frontend ce prompt.

## 2026-09-10 — PROMPT 21 — Code de Facturation → 🎯 FIN DE LA PHASE 6 (4 codes anti-fraude)
- **Supabase** (`prisma/sql/015_prompt21_code_facturation.sql`) :
  - Table **`factures_dossier`** (v8 §5) : `dossier_soins_id` FK, `ticket_soins_id` FK
    **unique** (une facture par épisode), `etablissement_id` FK, `adherent_id` /
    `beneficiaire_id` (dénormalisés, RLS), `montant_total` / `montant_assurance` /
    `montant_patient` `numeric(14,2)`, `statut` EMISE / EN_VALIDATION / VALIDEE / REGLEE /
    CONTESTEE, **`code_facturation` unique nullable** (généré seulement quand la facture est
    prête), **`code_valide_par_patient` bool défaut false**, `date_validation_patient`,
    `date_reglement` + `regle_par` (traçabilité du règlement). CHECK : validation patient ⟺
    horodatage.
  - **Trigger `verifier_facture_reglable()`** — BEFORE UPDATE : interdit **tout** passage à
    `REGLEE` si `code_valide_par_patient` ≠ true, **même en UPDATE SQL direct**
    (défense en profondeur, comme `verifier_medecin_traitant` / `verifier_ticket_ouvert`).
  - RLS : lecture pour l'établissement (sa facture) + l'adhérent concerné + le personnel
    assureur ; écriture réservée aux rôles ASSUREUR habilités (`profil_a_role`) ; l'adhérent
    peut mettre à jour SA facture (validation du code).
- **Prisma** : modèle `FactureDossier` (29 → 30 modèles), `prisma generate`.
- **apps/api** — `preauthorization/` étendu (choix retenu : les 4 codes anti-fraude dans un
  seul domaine) :
  - `genererFacture(user, ticketSoinsId)` : **refuse si le ticket est encore OUVERT** (409) ;
    calcule `montant_total` = Σ(`acte.montant_prescrit × quantité`) et la répartition
    assurance / patient depuis les `garanties` du produit (taux de couverture par catégorie
    d'acte, plafond par acte ; taux 80 % par défaut — *l'adjudication fine viendra Phase 7*) ;
    émet le `code_facturation` ; **ne renvoie jamais le code** (réponse = les montants).
    Réservé à `ASSUREUR_EXPLOITATION` / `ASSUREUR_COMPTABLE` / `ASSUREUR_INFORMATIQUE`.
  - `listerMesFactures(user)` : côté adhérent — ses factures **avec** le code + la synthèse
    (total, part assurance, reste à charge).
  - `validerCodeFacturation(user, { code })` : **réservé à l'adhérent concerné** (403 pour
    l'établissement ou tout autre rôle) — marque `code_valide_par_patient = true`,
    `date_validation_patient`, statut → VALIDEE.
  - `confirmerPaiement(user, factureId)` : **réservé à `ASSUREUR_COMPTABLE`** (403 sinon) ;
    **GARDE BLOQUANTE EXPLICITE dans le service** — `ForbiddenException` si
    `code_valide_par_patient` est false (s'applique même en contournant le contrôleur) ;
    statut → REGLEE + `date_reglement` + `regle_par`.
  - `obtenirFacture` (le code n'est renvoyé qu'à l'adhérent). Routes
    `POST /api/v1/preauthorization/tickets-soins/:id/facture`,
    `GET/POST …/codes-facturation[/valider]`, `GET …/factures/:id`,
    `POST …/factures/:id/confirmer-paiement`.
  - `preauthorization-facture.service.spec.ts` : **9 cas**, dont **LE test exigé** —
    `confirmerPaiement` **appelé directement sur le service, AVANT validation du code**, →
    `ForbiddenException` (message explicite), `factureDossier.update` jamais appelé.
    Autres : ticket OUVERT → 409 ; montants calculés (25000 → 20000 assurance / 5000
    patient) ; code non renvoyé ; validation par l'adhérent → true ; validation par
    l'établissement → 403 ; confirmerPaiement hors ASSUREUR_COMPTABLE → 403 ;
    confirmerPaiement après validation → REGLEE ; facture déjà REGLEE → 409. → **jest 104/104**.
- **Test HTTP réel — 13/13** (établissement + médecin + **comptable
  `armelk01+comptable.<stamp>@gmail.com` (ASSUREUR_COMPTABLE)**, adhérent
  `armelk01+adherent@gmail.com`, épisode complet ouvert via un vrai code de consultation,
  acte CONSULTATION 25 000 XOF, ticket clôturé) :
  - `genererFacture` sur le ticket **OUVERT** → **409** « le ticket de soins est encore OUVERT ».
  - Clôture du dossier, puis `genererFacture` → **201** : `montant_total 25000.00`,
    `montant_assurance 20000.00` (garantie CONSULTATION 80 %), `montant_patient 5000.00`,
    statut EMISE, **code absent de la réponse** ; 2ᵉ génération → 409.
  - **`UPDATE factures_dossier SET statut='REGLEE'` en SQL direct (code non validé) →
    rejeté par le trigger** `verifier_facture_reglable()`.
  - `confirmerPaiement` par `ASSUREUR_INFORMATIQUE` → **403** (mauvais rôle) ;
    `confirmerPaiement` par `ASSUREUR_COMPTABLE` **avant** validation du code → **403**
    « le code de facturation n'a pas été validé par l'adhérent … (anti-fraude, v8 §5) ».
  - L'adhérent voit sa facture + code (`DVPQP79H`) + reste à charge 5000.00 ;
    validation du code par le **médecin** → **403** ; par l'**adhérent** → **VALIDEE**,
    `code_valide_par_patient = true`.
  - `confirmerPaiement` par `ASSUREUR_COMPTABLE` **après** validation → **REGLEE**
    (part assurance 20000.00) ; 2ᵉ appel → **409** (déjà réglée).
  - `audit_log` : GENERATION_CODE_FACTURATION, VALIDATION_CODE_FACTURATION,
    CONFIRMATION_PAIEMENT_FACTURE.
- **Vérifs** : build API ✅ ; `jest` **104/104** ✅. Données de test e2e supprimées
  (facture, acte, ticket, dossier, consultation, code, établissement, 2 profils + comptes
  Supabase, invitations) ; serveur arrêté. Aucun changement frontend ce prompt.

---

## 🎯 JALON — PHASE 6 TERMINÉE : les 4 codes anti-fraude sont implémentés et testés en conditions réelles

| Code | Prompt | Table | Voie unique verrouillée | Défense en profondeur |
|---|---|---|---|---|
| **1. Code de Consultation** | 18 | `codes_consultation` | ouverture d'un dossier de soins uniquement via `validerCodeConsultation` (route `POST /care-episode/dossiers` **supprimée**) | garde applicative |
| **2. Code Référence d'Ordonnance** | 19 | `ordonnances` + `codes_ordonnance` | contenu de l'ordonnance révélé à la pharmacie uniquement via `validerCodeOrdonnance` | RLS (aucune lecture pharmacie) |
| **3. Ticket de Soins** | 20 | `tickets_soins` + `actes_dossier` | ticket créé/clôturé **automatiquement** avec le dossier (même transaction) ; acte refusé sur ticket non-OUVERT | trigger `verifier_ticket_ouvert()` |
| **4. Code de Facturation** | 21 | `factures_dossier` | règlement impossible sans `code_valide_par_patient = true` (validé **par l'adhérent lui-même**) | garde applicative **+** trigger `verifier_facture_reglable()` |

- Chaque étape du parcours est testée **en tentant de la contourner via l'API directe**
  (livrable de fin de Phase 6, v9) — et, pour les tickets/factures, **aussi en SQL direct**.
- Modèles Prisma : **30**. Tests : **`jest` 104/104**. Migrations SQL : `001` → `015`.
- Comptes de test permanents : `armelk01@yahoo.fr` (ASSUREUR_INFORMATIQUE) +
  `armelk01+adherent@gmail.com` (ADHERENT_TITULAIRE). Tous les autres rôles sont
  provisionnés à la demande dans chaque parcours e2e puis supprimés.
- **Prochaine phase — Phase 7** : adjudication (microservice Java, verrouillage optimiste
  des plafonds) + module `claims/` NestJS.

---

## 2026-09-10 — PROMPT 22 — Administration SaaS : licences + confirmation à deux temps des actions superadmin
- **Dépendance** : `resend` ajoutée à `apps/api` (client HTTP pur, aucun binaire natif).
  `apps/api/.env` : `RESEND_API_KEY` + `SUPERADMIN_EMAIL` (déjà ajoutés hors commit — `.env`
  est gitignoré).
- **apps/api — module `email/`** (`@Global`) : `EmailService.envoyerEmail(destinataire,
  sujet, contenu)` — enveloppe **unique et générique** de l'envoi via Resend (expéditeur
  provisoire `onboarding@resend.dev`), réutilisable par tous les besoins futurs. Si
  `RESEND_API_KEY` est absent : journalisation sans envoi, `{ envoye: false }`, pas de crash.
- **Supabase** (`prisma/sql/016_prompt22_licences_superadmin.sql`) :
  - Table **`licences_organisation`** (v14 §5) : `organisation_id` PK FK, `plan`
    STARTER/BUSINESS/ENTERPRISE, `limite_adherents`, `limite_appels_api_mois`, `date_debut`,
    `date_fin`, `statut` ACTIVE/SUSPENDUE/EXPIREE.
  - Table **`codes_validation_superadmin`** : `action`
    CREATION_ORGANISATION/SUSPENSION_ORGANISATION/PROLONGATION_ORGANISATION, `payload jsonb`
    (données de l'action en attente), `code` unique (8 car.), `date_expiration` défaut
    `now()+15min`, `statut` EMIS/CONFIRME/EXPIRE/ANNULE.
  - RLS : les deux tables sont **superadmin uniquement** en écriture ; `licences_organisation`
    lisible aussi par les membres de l'organisation concernée.
- **Prisma** : modèles `LicenceOrganisation` + `CodeValidationSuperadmin` (30 → 32 modèles).
- **apps/api — module `superadmin/`** (`SuperadminActionsService`) — toutes les actions
  sensibles du superadmin sont désormais **en deux temps** :
  - `initierCreationOrganisation` / `initierSuspensionOrganisation` /
    `initierProlongationOrganisation` : réservées à `SUPERADMIN_PRINCIPAL` ; **ne réalisent
    RIEN** — stockent le payload dans `codes_validation_superadmin`, génèrent un code
    (`crypto.randomInt`, 8 car., 15 min, usage unique) et l'envoient par e-mail à
    **`process.env.SUPERADMIN_EMAIL`** (jamais en dur) via `EmailService`, avec un résumé
    lisible de l'action. La réponse ne contient PAS le code.
  - `confirmerAction(code)` : vérifie validité / non-expiration (→ 410, passe EXPIRE) /
    non-réutilisation (→ 409 « déjà été confirmée ») / code inconnu (→ 404) ; puis
    **exécute RÉELLEMENT** l'action stockée :
    - CREATION → crée l'organisation + `licences_organisation` (limites par plan) + invite
      le premier compte via `InvitationsService.creerInvitation` (comme avant) ; marque le
      code CONFIRME dans la même transaction que la création.
    - SUSPENSION → `organisations.statut = SUSPENDUE` + `licences_organisation.statut =
      SUSPENDUE`.
    - PROLONGATION → `licences_organisation.date_fin` (+ réactive si la licence était
      EXPIREE).
  - `listerActionsEnAttente` / `annulerAction`.
  - **Route de création directe supprimée** : `POST /api/v1/identity/organisations` et
    `OrganisationsService.creer` retirés — la seule voie de création est désormais
    `initier` + `confirmer`. `GET /identity/organisations` renvoie chaque org avec sa
    `licence`.
  - `superadmin-actions.service.spec.ts` : **7 cas** (initier refusée hors superadmin ;
    initier stocke payload + code + e-mail sans créer l'org ; confirmer code inconnu → 404 ;
    code expiré → 410 + EXPIRE ; code déjà CONFIRME → 409 ; confirmer CREATION → crée
    réellement org + licence + invitation + CONFIRME ; confirmer SUSPENSION → org + licence
    SUSPENDUE). → **jest 111/111**.
- **apps/web** : `/superadmin/societes` — le formulaire direct est remplacé par le **flux en
  deux étapes** (`CreerSocieteFlow` : formulaire → panneau « Vérifiez votre e-mail, saisissez
  le code » → confirmation). Chaque organisation affiche des badges plan / statut de licence /
  échéance et des boutons **Suspendre** / **Prolonger** (eux aussi en deux temps).
  `next build --webpack` ✅ (24 routes).
- **Test HTTP réel** (compte `armelk01+superadmin@gmail.com` créé — SUPERADMIN_PRINCIPAL) :
  - `initier` création → **201, `emailEnvoye: true`** — **e-mail réellement reçu dans la boîte
    `armelk01@gmail.com`** (objet « [Assurance Santé] Code de confirmation — Création d'une
    organisation », code à 8 caractères) ; **aucune organisation créée** à ce stade.
  - `confirmer` avec un **faux code** (≠ celui reçu) → **404** « Code de confirmation
    invalide », échec propre : l'action reste EMIS, aucune organisation créée.
  - `confirmer` avec un **code expiré** (`date_expiration` reculée) → **410**.
  - `confirmer` avec le **bon code** → **organisation RÉELLEMENT créée** + `licences_organisation`
    (plan BUSINESS, limites, `date_fin` +1 an, statut ACTIVE) + **invitation du premier
    compte envoyée** ; le code passe **CONFIRME**.
  - **Réutilisation** : reconfirmer avec ce **même code déjà utilisé** → **409** « Cette
    action a déjà été confirmée » ; **aucun doublon** d'organisation.
  - Suspension en deux temps → `organisations.statut` **et** `licences_organisation.statut`
    passent **SUSPENDUE**.
  - `initier` par un `ASSUREUR_INFORMATIQUE` (non-superadmin) → **403**.
  - `audit_log` : INITIATION_ACTION_SUPERADMIN, CONFIRMATION_ACTION_SUPERADMIN,
    CREATION_ORGANISATION, SUSPENSION_ORGANISATION.
- **Vérifs** : build API ✅ ; `jest` **111/111** ✅ ; `next build --webpack` ✅ (24 routes).
  Données de test e2e supprimées (organisations, licences, codes de validation, invitations
  + comptes Supabase des premiers comptes) ; serveur arrêté.
- ⚠️ **Comptes de test permanents** désormais : `armelk01@yahoo.fr` (ASSUREUR_INFORMATIQUE),
  `armelk01+adherent@gmail.com` (ADHERENT_TITULAIRE), **`armelk01+superadmin@gmail.com`
  (SUPERADMIN_PRINCIPAL, mdp `Sante-Test-2026`)** — à retirer avant prod.

## 2026-09-10 — Frontend : patterns réutilisables + écran Souscripteurs
- **`apps/web/components/dashboard/patterns/`** — jeu de composants **formalisés une fois**,
  à réutiliser sur tous les écrans de gestion (produits, polices, cotisations,
  établissements, utilisateurs…), basés sur les primitives shadcn en place. Doc +
  exemples : `patterns/README.md`.
  - **`DataTable`** — tableau générique : colonnes configurables (`rendu`, `valeur`,
    `triable`, `aligneDroite`), **recherche plein texte** multi-champs (chemins `a.b`
    supportés), **filtres `select`**, **tri** par colonne, **pagination** (`parPage`,
    défaut 10), **état de chargement** (skeleton), **état vide** (« Aucune donnée » /
    « Aucun résultat pour ces filtres »), emplacement `actions` (barre d'outils) et
    `actionLigne` (cellule de fin de ligne).
  - **`StatutBadge`** — badge coloré ; **tonalité déduite du jeton** (ACTIF/PUBLIE/HOMOLOGUE
    → vert, BROUILLON/EN_ATTENTE/SUSPENDUE → ambre, RESILIE/EXPIRE… → rouge, CLOTURE/ARCHIVE
    → gris) ; **surchargeable** par `map` (statut → tonalité), `ton` (force) ou `libelles`.
    3 nouvelles variantes ajoutées à `ui/badge.tsx` : `warning`, `danger`, `info`.
  - **`FormulaireModal`** — wrapper de formulaire création/édition en **drawer**
    (mobile-first : plein écran mobile, panneau droit desktop) ou **modale** (`mode="center"`).
    `onSoumettre(formData)` → `{ ok }` : succès ferme + réinitialise + `onSucces()` ;
    **échec affiche `error` ET la liste `erreurs`** (messages class-validator de NestJS).
    Pilotable (`ouvert` / `onOuvertChange`). Primitive `ui/dialog.tsx` ajoutée (radix Dialog,
    option `side="right"` pour le drawer). Helper `lib/api.ts` : `detailErreur(res)` →
    `{ error, erreurs[] }`.
  - **`Champ*`** — champs libellés (`ChampTexte`, `ChampNombre`, `ChampZone`, `ChampSelect`,
    `ChampCheckbox`) + enveloppe `Champ`, alignés sur le style du codebase.
  - **`CarteResume` / `GrilleCartes`** — carte de chiffre-clé (libellé, valeur, indice
    coloré, icône, lien optionnel) pour les vues d'ensemble.
- **Écran Souscripteurs** — premier consommateur de ces patterns :
  - `/dashboard-assureur/informatique/souscripteurs` : `GrilleCartes` (total + par type) +
    `DataTable` (nom, type via `StatutBadge`, détail synthétique, date de création triable),
    **filtre par type** ENTREPRISE/COLLECTIVITE/INDIVIDUEL, recherche, bouton
    **« Nouveau souscripteur »** ouvrant un `FormulaireModal` dont **les champs s'adaptent
    dynamiquement au type** (secteur/effectif pour ENTREPRISE ; type de collectivité /
    organe de gouvernance / subvention + bailleur pour COLLECTIVITE ; pièce d'identité pour
    INDIVIDUEL). Appelle le module `tenant/` (`POST /api/v1/tenant/souscripteurs`).
  - `/dashboard-assureur/informatique/souscripteurs/[id]` : vue détail (fiche
    d'informations selon le type) et, **pour une COLLECTIVITE**, la **gestion du comité de
    gestion** (`ComiteGestion` : `DataTable` des membres + `FormulaireModal` d'ajout — le
    membre est choisi parmi les comptes réels de l'organisation via
    `GET /identity/comptes` — + retrait). Endpoints `tenant/souscripteurs/:id/membres-comite`.
  - Server actions : `creerSouscripteur`, `ajouterMembreComite`, `retirerMembreComite`
    (`apiFetch` + `revalidatePath`, renvoient `{ ok:false, error, erreurs }` pour le modal).
- **Test navigateur réel — 12/12** (serveurs prod, session `armelk01@yahoo.fr`) :
  - `/souscripteurs` → 200 : DataTable avec les vraies données (ACME BTP, Mutuelle
    communautaire de Bouaké), cartes de résumé, badges de type, bouton « Nouveau souscripteur ».
  - Création **ENTREPRISE** (`SODECI Test`, secteur + effectif) → 201, apparaît dans la liste.
  - `POST` sans `type` → **400 avec la liste des messages de validation** (rendue par le modal).
  - Création **COLLECTIVITE** (type de collectivité, organe, subvention + bailleur) → 201.
  - Ajout d'un **membre de comité** (compte réel de l'org, fonction « Président ») → 201 ;
    vue détail affiche infos + comité + membre ; retrait → 204.
  - **Filtre par type** : `?type=ENTREPRISE` / `?type=COLLECTIVITE` renvoient bien le sous-ensemble.
- **Vérifs** : `next build --webpack` ✅ (25 routes) ; `jest` API inchangé **111/111**.
  Données de test e2e supprimées (2 souscripteurs + membres) ; serveurs arrêtés.

## 2026-09-10 — Frontend : écran Produits (cycle de vie versionné, lecture seule après publication)

- **`/dashboard-assureur/informatique/produits`** — deuxième consommateur des patterns `patterns/` :
  - `GrilleCartes` (total, brouillons, publiés, archivés) + `DataTable` (nom triable, version,
    `StatutBadge` BROUILLON/PUBLIE/ARCHIVE, **nombre de garanties**, date de publication triable),
    **filtre par statut**, recherche par nom, bouton **« Nouveau produit »** (`FormulaireModal`,
    champ `nom` — produit créé en **BROUILLON**).
  - API : `PlanService.listerProduits` expose désormais `_count.garanties` (count filtré
    `deleted_at IS NULL`) pour alimenter la colonne « Garanties » de la liste.
- **`/dashboard-assureur/informatique/produits/[id]`** — vue détail (`ProduitDetail`, client) :
  - carte d'informations (statut, version, nb garanties, dates) ; bouton **« Renommer »**
    (`FormulaireModal`) visible **uniquement en BROUILLON** ;
  - `DataTable` des **garanties** (catégorie, taux, plafond/acte, plafond/an, franchise,
    ticket modérateur, carence, réseau, compteur d'exclusions) — montants formatés `fr-FR` ;
  - **« Ajouter une garantie »** (`FormulaireModal` avec tous les champs : catégorie d'acte,
    taux %, plafonds, franchise, ticket modérateur, délai de carence, réseau de soins,
    exclusions une par ligne) — visible **uniquement en BROUILLON** ;
  - **« Publier le produit »** : visible en BROUILLON, **désactivé** si 0 garantie avec le
    message explicite « Ajoutez au moins une garantie pour pouvoir publier. » ;
  - **« Créer une nouvelle version »** : visible si PUBLIE ou ARCHIVE → nouveau BROUILLON
    v+1 (produit + garanties clonés), redirige vers la nouvelle version ;
  - **après publication → tout passe en lecture seule dans l'UI** : bandeau « lecture seule »,
    disparition des boutons « Ajouter une garantie » / « Retirer » / « Publier » / « Renommer »
    (cohérent avec le `409` déjà renvoyé par l'API `PlanService.assertBrouillon` si l'on
    forçait la requête). Les garanties restent affichées en consultation.
- Server actions (`produits/actions.ts`) : `creerProduit`, `renommerProduit`, `ajouterGarantie`,
  `supprimerGarantie`, `publierProduit`, `creerNouvelleVersion` (`apiFetch` + `revalidatePath`,
  `detailErreur` pour la liste d'erreurs du modal).
- **Test navigateur réel — 33/33** (serveurs prod, session `armelk01@yahoo.fr`) :
  création produit BROUILLON, rendu liste (badge, colonne garanties, bouton) ; détail sans
  garantie → bouton « Publier » **rendu `disabled`** + message ; ajout de 2 garanties → « Publier »
  actif, garanties + valeurs formatées rendues ; publication → HTTP 201, `datePublication` ;
  détail PUBLIE → bandeau lecture seule, **boutons d'écriture absents du HTML**, garanties
  toujours visibles ; l'API confirme le verrou (`POST garantie` / `PATCH nom` → **409**) ;
  `nouvelle-version` → BROUILLON v2 avec 2 garanties clonées, de nouveau éditable.
- **Vérifs** : `next build --webpack` ✅ (26 routes) ; `jest` API **111/111**.
  Données de test e2e supprimées (produit + versions + garanties) ; serveurs arrêtés.

## 2026-09-10 — Frontend : écran Polices (machine à états pilotée par l'API) + avenants proratisés

- **API — nouvel endpoint « source de vérité » des transitions** (au lieu de dupliquer
  `TRANSITIONS_POLICE` en JavaScript) :
  - `GET /policy/polices/:id/actions` → `{ statut, transitions[], actions[] }`.
    `actions[]` est calculé côté `PolicyService.actionsDisponibles` depuis
    `TRANSITIONS_POLICE[statut]` : chaque entrée porte `cle`, `libelle` (dans
    `LIBELLE_TRANSITION`), `endpoint` (`'statut'` | `'souscrire'`), `statutCible`,
    `avecDates`, `danger`. DEVIS/EN_SOUSCRIPTION → une seule action `souscrire` ;
    ACTIVE → Suspendre/Renouveler/Résilier/Ne pas renouveler ; SUSPENDUE → Réactiver ;
    états terminaux → `[]`. Le frontend rend `actions[]` **tel quel**, sans re-décrire
    la machine à états.
  - `POST /policy/polices/:id/avenants/simulation` → aperçu de proratisation
    (`joursTotal`, `joursRestants`, `impactCotisation`, `proratisationAppliquee`) **sans
    rien persister** — même calcul (`calculerImpact`) que `creerAvenant`, extrait en
    helper partagé. + `assertDateEffetDansPeriode` factorisé.
  - `PolicyService.listerPolices` inclut désormais `produit {nom,version,statut}`,
    `souscripteur {nom,type}` et `_count.avenants`.
  - Tests unitaires ajoutés (`policy.service.spec.ts`) : actions par statut (DEVIS,
    ACTIVE avec les 2 `danger`, RESILIEE terminal, SUSPENDUE→Réactiver) + simulation
    identique à `creerAvenant` sans persistance → **jest 116/116**.
- **`/dashboard-assureur/informatique/polices`** — `GrilleCartes` + `DataTable`
  (n° police, souscripteur, produit·version, `StatutBadge` des 7 statuts via `map` +
  `libelles` explicites, date de début), **filtre par statut**, recherche multi-champs,
  bouton **« Nouveau devis »** (`FormulaireModal`) : liste déroulante souscripteurs +
  **produits filtrés sur `?statut=PUBLIE`** (un produit non publié n'apparaît jamais),
  dates optionnelles.
- **`/dashboard-assureur/informatique/polices/[id]`** — `PoliceDetail` (client) :
  - carte d'informations (souscripteur, produit, période, nb avenants) ;
  - carte **« Cycle de vie »** : légende « Transitions valides depuis X » + les boutons
    rendus **1:1 depuis `GET …/actions`** — jamais un bouton vers une transition que
    l'API refuserait. `souscrire` ouvre un `FormulaireModal` de dates → `POST /souscrire` ;
    les autres → `POST /statut` (variante `destructive` pour Résilier / Ne pas renouveler) ;
  - carte **« Avenants »** : `DataTable` (type, date d'effet, proratisation, impact
    cotisation, statut) + **« Nouvel avenant »** (`FormulaireModal`) avec bouton
    **« Calculer la proratisation »** → appelle `/avenants/simulation` et **affiche
    l'impact proratisé (jours restants / jours total) avant confirmation** ; création via
    `POST /avenants` (l'API recalcule). Actions ligne Appliquer / Annuler. Bloc masqué si
    la police n'est pas ACTIVE.
- Server actions (`polices/actions.ts`) : `creerDevis`, `souscrirePolice`, `changerStatut`,
  `simulerAvenant`, `creerAvenant`, `appliquerAvenant`, `annulerAvenant`. Type `Simulation`
  isolé dans `polices/types.ts` (un fichier `'use server'` ne peut exporter que des fonctions).
- **Test navigateur réel — 37/37** (serveurs prod, session `armelk01@yahoo.fr`) :
  liste déroulante = produits PUBLIE only (BROUILLON absent) ; création devis → 201 ;
  devis sur produit BROUILLON → **400** ; `/actions` DEVIS = `souscrire` seul et la page
  n'affiche que ce bouton ; `POST /statut {ACTIVE}` depuis DEVIS → **409** ;
  `/souscrire` → ACTIVE ; `/actions` ACTIVE = 4 transitions, page affiche exactement ces
  4 boutons + « Nouvel avenant », plus aucun bouton de souscription ; simulation
  proratisation `10000 × 183/364 = 5027,47 F` (non persistée) puis avenant créé avec le
  **même** impact, rendu dans le tableau ; `SUSPENDUE` → `/actions` = « Réactiver » seul,
  page idem ; réactivation → ACTIVE.
- **Vérifs** : `next build --webpack` ✅ (27 routes) ; `jest` API **116/116**.
  Données de test e2e supprimées (1 police + 1 avenant) ; serveurs arrêtés.

## 2026-09-10 — Frontend : écran Cotisations → 🎯 FIN DU BLOC DE RATTRAPAGE FRONTEND PHASE 2

- **API — `billing/`, includes de lecture** (aucun nouvel endpoint, la logique était en place) :
  - `BillingService.listerCotisations` inclut `police { numeroPolice, souscripteur {nom,type}, produit {nom} }` ;
  - `BillingService.listerGrilles` inclut `produit {nom,version}` et `souscripteur {nom,type}`.
  - `jest` API inchangé **116/116**.
- **`/dashboard-assureur/informatique/cotisations`** — `CotisationsEcran` (client) :
  - `GrilleCartes` (total, à payer, en retard, **reste à encaisser** = Σ dû − payé) ;
  - `DataTable` des cotisations (police + souscripteur, période `MM/YYYY`, montant dû,
    montant payé, `StatutBadge` A_PAYER/PAYEE/EN_RETARD/ANNULEE, échéance), **filtre par
    statut ET par période** (périodes distinctes calculées depuis les données) ;
  - bouton **« Calculer une cotisation »** (`FormulaireModal`) : police ACTIVE + période +
    âge + id adhérent, bouton **« Calculer le tarif »** → appelle
    `POST /billing/cotisations/calculer` et **affiche le détail avant génération**
    (badge source **NÉGOCIÉ / STANDARD**, tarif de base, **part membre %** si collectivité
    subventionnée, montant dû) ; la soumission génère réellement la ligne via
    `POST /billing/polices/:id/cotisations` ;
  - action de ligne **« Enregistrer un paiement »** sur les cotisations `A_PAYER` /
    `EN_RETARD` uniquement (`FormulaireModal` montant, pré-rempli au reste dû) →
    `POST /billing/cotisations/:id/paiement` ; le statut se met à jour via `router.refresh()` ;
  - section **« Grilles tarifaires »** : `DataTable` (produit·version, type
    **Standard / Négocié**, souscripteur, tranche d'âge, montant mensuel) + filtre type +
    **« Nouvelle grille négociée »** (`FormulaireModal` : produit, souscripteur *requis*,
    tranche d'âge, montant) → `POST /billing/grilles-tarifaires`.
- Server actions (`cotisations/actions.ts`) : `calculerCotisation`, `genererCotisation`,
  `enregistrerPaiement`, `creerGrille` (`2026-05` du champ `month` → `2026-05-01` pour l'API).
  Type `Calcul` isolé dans `cotisations/types.ts`.
- **Test navigateur réel — 22/22** (serveurs prod, session `armelk01@yahoo.fr`) :
  calcul sur Mutuelle de Bouaké → **STANDARD** 12 000 F, part membre 60 % → dû 7 200 F ;
  création d'une **grille négociée** 8 000 F pour ce souscripteur ; **recalcul → NÉGOCIÉ**
  8 000 F → dû 4 800 F (le négocié prime) ; génération réelle → ligne `A_PAYER` 4 800 F ;
  **paiement partiel 2 000 F → reste `A_PAYER`** ; **complément 2 800 F → `PAYEE`**
  (statut ne bascule qu'au règlement complet) ; page : cotisation + souscripteur rendus,
  montants formatés, section grilles Standard + Négocié, plus d'action de paiement sur une
  cotisation `PAYEE`.
- **Vérifs** : `next build --webpack` ✅ (27 routes) ; `jest` API **116/116**.
  Données de test e2e supprimées (1 cotisation + 1 grille négociée) ; serveurs arrêtés.

### 🎯 Jalon — rattrapage frontend Phase 2 terminé

Les 4 écrans de gestion de la Phase 2 sont livrés et testés en navigateur réel, tous
bâtis sur les mêmes patterns réutilisables (`components/dashboard/patterns/`) :

| Écran | Module API | Points clés |
|---|---|---|
| **Souscripteurs** | `tenant/` | champs dynamiques par type ; comité de gestion des COLLECTIVITE |
| **Produits** | `plan/` | cycle de vie versionné ; lecture seule après publication |
| **Polices** | `policy/` | boutons de transition **calculés par l'API** (`/actions`) ; avenants proratisés |
| **Cotisations** | `billing/` | tarif NÉGOCIÉ > STANDARD ; part membre ; paiement partiel/complet ; grilles |

Prochaine étape : reprendre la séquence des prompts backend (Phase 7+) — les écrans des
autres rôles (médecin-conseil, pharmacien-conseil, établissements, pharmacies) et
dashboards restants seront traités au fil des besoins.

## 2026-09-10 — PROMPT 23 — Panneau de configuration Super Admin (paramètres, santé système, catalogue national)

*(Entrée distincte du jalon Phase 2 ci-dessus — nouvelle étape après le bloc de rattrapage frontend.)*

### 1. `parametres_plateforme` (v1 §10.4)
- Table `parametres_plateforme (id, cle unique, valeur jsonb, description, created_at, updated_at)` —
  `prisma/sql/017_prompt23_superadmin_config.sql`. Modèle Prisma `ParametrePlateforme`.
- **RLS `parametres_plateforme_superadmin_only` — `for all`, lecture ET écriture
  EXCLUSIVEMENT `SUPERADMIN_PRINCIPAL`.**
- Seed : `devises_supportees`, `pays_villes`, `taux_taxe_par_pays`, `langues`.
- Endpoints (`SuperadminConfigController`, `@Controller('superadmin')`) : `GET config/parametres`,
  `GET config/parametres/:cle`, `PUT config/parametres/:cle` (`{ valeur, description? }`, upsert).
  `SuperadminConfigService.assertSuperadmin` double la RLS (défense en profondeur).

### 2. Tableau de bord santé du système
- `GET /superadmin/sante-systeme` → `{ genereLe, resume, organisations[] }`.
  - `resume` : `totalOrganisations`, `totalAdherentsRattaches`, `organisationsQuotaDepasse`,
    `parStatutOrganisation` (depuis `organisations.statut`),
    `parStatutLicence` (depuis `licences_organisation.statut`, + `SANS_LICENCE`).
  - par organisation : `adherentsRattaches` (`profils` avec `adherent_id` non nul —
    aucune table `adherents` n'existe encore, c'est la métrique disponible),
    `limiteAdherents` (licence), `tauxUtilisationAdherents`, `quotaDepasse`,
    `derniereActivite` (`max(audit_log.created_at)` par org).
- Page `/superadmin/sante-systeme` : `GrilleCartes` + 2 cartes de répartition (`StatutBadge`) +
  `DataTable` (organisation, statut, licence, **adhérents / limite** en rouge si dépassé, échéance,
  dernière activité).

### 3. Catalogue national partagé (v1 §10.4)
- Tables `referentiel_national_actes` / `referentiel_national_medicaments` — **mêmes colonnes que
  `referentiel_actes` / `medicaments` SANS `organisation_id`** ; modèles `ReferentielNationalActe`,
  `ReferentielNationalMedicament`.
- **RLS** : lecture `to authenticated using (true)` (catalogue consulté avant import) ;
  écriture `for all` EXCLUSIVEMENT `SUPERADMIN_PRINCIPAL`.
- Maintenance (superadmin) : `GET/POST/DELETE /superadmin/catalogue-national/{actes,medicaments}`
  (`SuperadminConfigService`). Seed : 8 actes + 6 médicaments (statut HOMOLOGUE = validés nationalement).
- **Import (`reference/`, réservé à `ASSUREUR_INFORMATIQUE`)** :
  - `GET /reference/catalogue-national/{actes,medicaments}` — lecture par tout membre d'une org ;
  - `POST /reference/catalogue-national/actes/:itemId/importer` (+ `.../medicaments/...`) →
    `ReferenceService.importerActeDepuisCatalogueNational` : copie vers `referentiel_actes` de
    **l'organisation de l'appelant AU STATUT `PROPOSE`**, audit `IMPORT_ACTE_CATALOGUE_NATIONAL`.
    409 si déjà présent dans l'org. **La règle d'homologation est INCHANGÉE** : seuls
    `ASSUREUR_MEDECIN_CONSEIL` / `ASSUREUR_PHARMACIEN_CONSEIL` de cette organisation peuvent
    ensuite homologuer (le rôle `SUPERADMIN_PRINCIPAL` n'est dans aucune liste d'homologation).
- Page `/superadmin/catalogue-national` : `GrilleCartes` + 2 `DataTable` (actes / médicaments),
  `FormulaireModal` d'ajout, action « Retirer ». Nav `SuperadminShell` étendue :
  Sociétés · **Santé système** · **Paramètres** · **Catalogue national**.

### Tests
- **`jest` API 124/124** (+8) : `superadmin-config.service.spec.ts` (403 non-superadmin sur
  paramètres / catalogue, agrégation santé-système + quota dépassé, statut national par défaut
  HOMOLOGUE) ; `reference.service.spec.ts` (import → statut `PROPOSE`, 403 hors
  `ASSUREUR_INFORMATIQUE`, 409 si déjà importé).
- **Test HTTP réel — 21/21** (serveurs prod ; comptes `armelk01+superadmin@gmail.com`
  `SUPERADMIN_PRINCIPAL` + `armelk01@yahoo.fr` `ASSUREUR_INFORMATIQUE`) :
  - un `ASSUREUR_INFORMATIQUE` sur `parametres_plateforme` → **403** en lecture ET écriture ;
  - le superadmin modifie `langues` (valeur restaurée ensuite) ;
  - `GET /superadmin/sante-systeme` → résumé + lignes (adhérents rattachés, dernière activité) ;
    `ASSUREUR_INFORMATIQUE` sur cette route → **403** ;
  - `ASSUREUR_INFORMATIQUE` importe un acte national (`CI-GLYC`) → **statut `PROPOSE`, pas
    `HOMOLOGUE`**, copié dans son org ; réimport → **409** ;
  - **[faille] le superadmin tente `POST /reference/actes/:id/homologuer` sur l'item de
    l'organisation → 403** (« Ce compte n'est rattaché à aucune organisation » ; et le rôle
    `SUPERADMIN_PRINCIPAL` n'ouvre aucune homologation) — la faille n'existe pas ;
  - les 3 pages `/superadmin/{parametres,sante-systeme,catalogue-national}` rendent en 200.
- **Vérifs** : `next build --webpack` ✅ (30 routes) ; `jest` API **124/124**.
  Données de test e2e supprimées (1 acte importé) ; `langues` restauré ; serveurs arrêtés.

## 2026-09-10 — Skill local `health-insurance-core-ui`

- Nouveau skill `.claude/skills/health-insurance-core-ui/SKILL.md` — frontmatter
  (`name`, `description` calibrée pour se déclencher sur toute tâche « créer / modifier
  un écran de dashboard ») + instructions d'usage des briques
  `components/dashboard/patterns/` (`DataTable`, `StatutBadge`, `FormulaireModal`,
  `Champ*`, `CarteResume`, `GrilleCartes`) avec un exemple minimal par composant.
- Reprend et formalise `apps/web/components/dashboard/patterns/README.md` en ajoutant les
  conventions dégagées des 5 écrans déjà construits : découpage
  `page.tsx` (server) / `*-ecran.tsx` (client) / `actions.ts` (`'use server'`) ;
  `ResultatSoumission` + `detailErreur` ; types partagés dans un `types.ts` voisin (un
  fichier `'use server'` n'exporte que des fonctions) ; champs dynamiques ; aperçu avant
  confirmation via endpoint de simulation ; boutons de transition pilotés par l'API ;
  patron d'e2e navigateur réel.
- `CLAUDE.md` : ligne ajoutée pointant vers ce skill pour toute construction d'écran `apps/web`.
- Objectif : les prompts d'écran chargent ces conventions automatiquement, sans rappel explicite.

## 2026-09-10 — PROMPT 24 (partie 1 / 2) — Réclamations + rôle technique `svc_adjudication`

*(Réception uniquement. Le microservice Java d'adjudication n'est PAS branché — découpé volontairement, suite au prompt suivant.)*

### Tables (`prisma/sql/018_prompt24_reclamations_svc_adjudication.sql`)
- **`reclamations`** (`id`, `organisation_id`, `dossier_soins_id` FK, `acte_dossier_id` FK,
  `adherent_id?`, `beneficiaire_id?`, `police_id` FK, `garantie_id` FK, `montant` num(14,2),
  `type_reclamation` ∈ {SOIN, PHARMACIE, HOSPITALISATION, OPTIQUE, DENTAIRE, ANALYSES,
  IMAGERIE, AUTRE}, `statut` ∈ {SOUMISE, EN_ADJUDICATION, AUTO_ADJUDIQUE, REVUE_MANUELLE,
  REJETE, PAYEE}, `codes_rejet text[]?`, timestamps + `deleted_at`).
  **Index unique partiel `reclamations_acte_dossier_unique (acte_dossier_id) WHERE deleted_at IS NULL`**
  → une seule réclamation vivante par acte (base de l'idempotence).
- **`remboursements`** (`id`, `reclamation_id` FK **unique**, `montant_rembourse`,
  `plafond_restant_apres?`, `decision`, `duree_traitement_ms?`, `created_at`).
- Modèles Prisma `Reclamation` (+ `remboursement Remboursement?`) / `Remboursement`.
- **RLS** : lecture pour le personnel ASSUREUR de l'organisation ; **aucune policy d'écriture
  `authenticated`** → seuls `postgres` (NestJS, propriétaire) et `svc_adjudication` (BYPASSRLS) écrivent.

### `log_audit` → SECURITY DEFINER
`alter function public.log_audit(text,text,uuid,uuid,jsonb) security definer` (+ `set search_path = public`).
La fonction appartient à `postgres` → son corps garde les droits de `postgres` (aucun changement
pour NestJS), et `svc_adjudication` n'a besoin que d'`EXECUTE` (pas d'`INSERT` sur `audit_log`
ni de `SELECT` sur `profils`).

### Rôle Postgres `svc_adjudication` — `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`
**Grants exacts (vérifiés via `has_table_privilege` / `has_column_privilege` / `has_function_privilege`)** :

| Objet | Privilège accordé | Vérifié |
|---|---|---|
| `schema public` | `USAGE` | ✅ |
| `public.garanties` | `SELECT` | ✅ *(= « plan de couverture » ; pas de table `plans_couverture` distincte)* |
| `public.grilles_tarifaires` | `SELECT` | ✅ |
| `public.referentiel_actes` | `SELECT` | ✅ |
| `public.medicaments` | `SELECT` | ✅ |
| `public.polices` | `SELECT` | ✅ |
| `public.reclamations` | `SELECT` sur **12 colonnes** : `id, organisation_id, dossier_soins_id, acte_dossier_id, adherent_id, beneficiaire_id, police_id, garantie_id, montant, type_reclamation, statut, created_at` | ✅ (`codes_rejet`, `updated_at`, `deleted_at` **non** accordés) |
| `public.reclamations` | `UPDATE` sur **`statut` uniquement** | ✅ (`UPDATE` sur toute autre colonne refusé) |
| `public.remboursements` | `INSERT` | ✅ (`SELECT`/`UPDATE`/`DELETE` **non** accordés) |
| `public.log_audit(text,text,uuid,uuid,jsonb)` | `EXECUTE` | ✅ |

Contrôles négatifs : `has_table_privilege('svc_adjudication','reclamations','SELECT')` = **false**
(pas de SELECT niveau table), `profils` SELECT = **false**, `audit_log` INSERT = **false**.
`revoke all … from svc_adjudication` en tête du script pour repartir d'une ardoise vierge.

### Module `apps/api/src/claims/`
- `ClaimsService.soumettre(user, { acteDossierId, typeReclamation?, garantieId?, montant? })` :
  1. `assertGestion` — réservé à `ASSUREUR_DIRECTION` / `ASSUREUR_EXPLOITATION` / `ASSUREUR_INFORMATIQUE` ;
  2. dérive `organisation_id`, `police_id`, `garantie_id` (= `dossier.plan_couverture_id`, sinon
     `dto.garantieId`), `montant` (= `acte.montant_prescrit × quantité`), `type_reclamation`
     (mappé depuis `acte.categorie_acte`) depuis l'acte + le dossier ;
  3. crée la réclamation à `SOUMISE` si elle n'existe pas (une création concurrente perdante
     tombe sur l'index unique `P2002` → on relit la ligne gagnante) ;
  4. **verrouille** via un compare-and-swap atomique :
     `updateMany({ where: { id, statut: 'SOUMISE' }, data: { statut: 'EN_ADJUDICATION' } })` —
     `count === 0` ⇒ `409` ; réclamation déjà `≠ SOUMISE` ⇒ `409` (« déjà EN_ADJUDICATION… »).
  - Aucune séquence `SELECT … FOR UPDATE` ni verrou applicatif : la base est l'arbitre.
- `listerReclamations` / `obtenirReclamation` (scopés org, `include: { remboursement }`).
- `ClaimsController` : `POST /claims/reclamations/soumettre`, `GET /claims/reclamations?statut=`,
  `GET /claims/reclamations/:id`. `ClaimsModule` enregistré dans `app.module.ts`.

### Tests
- **`jest` API 129/129** (+5) : `claims.service.spec.ts` — création `SOUMISE` + verrouillage
  `EN_ADJUDICATION` ; 2e soumission d'une réclamation déjà `EN_ADJUDICATION` → `Conflict`
  (pas de 2e `updateMany`) ; CAS concurrent `count = 0` → `Conflict` ; verrouillage d'une
  réclamation préexistante encore `SOUMISE` ; rôle non habilité → `Forbidden`.
- **Test HTTP réel — 12/12** (serveur prod ; `armelk01@yahoo.fr` `ASSUREUR_INFORMATIQUE` +
  `armelk01+adherent@gmail.com`) sur une chaîne semée (étab. + dossier + ticket + 2 actes) :
  - soumission acte 1 → `201`, `EN_ADJUDICATION`, `montant 15000`, `type SOIN`, org + garantie
    dérivées du dossier ;
  - **re-soumission séquentielle du même acte → `409`** (« déjà EN_ADJUDICATION — idempotence ») ;
  - **double soumission SIMULTANÉE** (`Promise.all`) sur l'acte 2 → codes `[201, 409]`
    exactement, une seule réclamation créée, message perdant propre
    (« déjà verrouillée par une soumission concurrente ») ;
  - `GET` : 2 réclamations `EN_ADJUDICATION`, `remboursement: null` (microservice non branché) ;
  - un `ADHERENT_TITULAIRE` qui soumet → `403`.
- Données e2e supprimées (réclamations + chaîne de soins) ; serveur arrêté.
- **⚠️ Point d'arrêt volontaire** : le microservice Java d'adjudication n'est PAS appelé —
  la connexion (via le rôle `svc_adjudication`) est l'objet du prompt suivant.

### 2026-09-10 — PROMPT 24 (correctif b) — grants `svc_adjudication` : `SELECT` sur `remboursements` + test SQL direct

`prisma/sql/019_prompt24b_grant_remboursements_select.sql`.

- **Ajout `GRANT SELECT (id, reclamation_id, montant_rembourse, created_at) ON public.remboursements`** :
  - `reclamation_id, montant_rembourse, created_at` → sommer les remboursements de l'année
    d'un adhérent (jointure `remboursements` × `reclamations.adherent_id`) pour le plafond restant ;
  - **`id`** → nécessaire pour que `INSERT INTO remboursements (...) VALUES (...) RETURNING id`
    fonctionne : la clause `RETURNING` est évaluée comme un `SELECT` sur les colonnes renvoyées.
    **Test SQL direct confirmé** : sans `SELECT` sur `id`, l'INSERT échoue avec
    `permission denied for table remboursements` ; avec, il passe.
  - `decision`, `plafond_restant_apres`, `duree_traitement_ms` **non** accordés (le microservice
    les écrit, il n'a pas à les relire).
- **Test SQL exécuté EN TANT QUE `svc_adjudication`** (`set local role` après un `grant … to postgres`
  temporaire — révoqué ensuite ; NB : Supabase auto-attache à `postgres` une adhésion
  `admin_option` **sans `SET`/`INHERIT`** sur tout rôle qu'il crée, inoffensive et non retirable) :

  | Requête | Résultat |
  |---|---|
  | `INSERT INTO remboursements (reclamation_id, montant_rembourse, plafond_restant_apres, decision, duree_traitement_ms) VALUES (…) RETURNING id` | ✅ **OK** (id renvoyé) |
  | `SELECT sum(montant_rembourse) … JOIN reclamations ON adherent_id …` (somme année) | ✅ OK |
  | `UPDATE reclamations SET statut = …` | ✅ OK |
  | `SELECT decision FROM remboursements` | ⛔ refusé (`insufficient_privilege`) — attendu |
  | `UPDATE reclamations SET montant = …` | ⛔ refusé — attendu |

#### Grants exacts APRÈS correctif (re-vérifiés `has_column_privilege`)

| Objet | Privilège | Colonnes |
|---|---|---|
| `schema public` | `USAGE` | — |
| `public.garanties` | `SELECT` | table *(= « plan de couverture » ; pas de table `plans_couverture` distincte)* |
| `public.grilles_tarifaires` | `SELECT` | table |
| `public.referentiel_actes` | `SELECT` | table |
| `public.medicaments` | `SELECT` | table |
| `public.polices` | `SELECT` | table |
| `public.reclamations` | `SELECT` | `id, organisation_id, dossier_soins_id, acte_dossier_id, adherent_id, beneficiaire_id, police_id, garantie_id, montant, type_reclamation, statut, created_at` *(12 — pas `codes_rejet`/`updated_at`/`deleted_at`)* |
| `public.reclamations` | `UPDATE` | `statut` **uniquement** |
| `public.remboursements` | `SELECT` | `id, reclamation_id, montant_rembourse, created_at` *(4 — pas `decision`/`plafond_restant_apres`/`duree_traitement_ms`)* |
| `public.remboursements` | `INSERT` | table *(spec : « INSERT sur remboursements »)* |
| `public.log_audit(text,text,uuid,uuid,jsonb)` | `EXECUTE` | — |

Contrôles négatifs re-vérifiés : `has_table_privilege('svc_adjudication','reclamations','SELECT')` = **false** ;
`has_table_privilege('svc_adjudication','remboursements','SELECT'/'UPDATE'/'DELETE')` = **false** ;
`profils` SELECT = **false** ; `audit_log` INSERT = **false** ; `factures_dossier` SELECT = **false**.
Tous les autres grants du PROMPT 24 sont inchangés.
## 2026-09-10 — PROMPT 24 (partie 2 / 2) — microservice `adjudication-service/` (Spring Boot, autonome)

*(Projet Java distinct à la racine, à côté de `apps/`. **PAS encore branché à `apps/api`** —
l'Edge Function de déclenchement viendra ensuite. Commit séparé du module `claims/`.)*

### Structure — `adjudication-service/` (Spring Boot 3.3.5, Java 21, Maven)
- `pom.xml` : `spring-boot-starter-web`, `-jdbc`, `-security`, `postgresql` (runtime),
  `spring-boot-starter-test` (JUnit 5 + Mockito + AssertJ, transitif). Aucune dépendance JWT
  tierce — la vérification HMAC-SHA256 est faite avec le JDK (`javax.crypto.Mac`) + Jackson.
- `Dockerfile` **multi-stage** : `maven:3.9-eclipse-temurin-21` (build, `dependency:go-offline`
  puis `package -DskipTests`) → `eclipse-temurin:21-jre-alpine` (run, user non-root,
  `HEALTHCHECK` sur `/healthz`).
- `README.md` : variables d'env (`JDBC_URL`, `JDBC_USER=svc_adjudication`, `JDBC_PASSWORD`,
  `SERVICE_JWT_SECRET`, `PORT`), contrat d'API, pipeline, table des codes, build/tests, `curl`.

### Configuration
- `application.yml` : `spring.datasource.{url,username,password}` ← `${JDBC_URL}` /
  `${JDBC_USER:svc_adjudication}` / `${JDBC_PASSWORD}` (jamais en dur), pool Hikari (5),
  `server.port ${PORT:8081}`, `service.jwt.secret ${SERVICE_JWT_SECRET}`.
- **Sécurité** — `SecurityConfig` (stateless, no-CSRF) + `ServiceJwtAuthFilter`
  (`OncePerRequestFilter`, n'agit que sur `/api/v1/adjudication/**`) + `ServiceJwtVerifier` :
  - `alg` **doit** être `HS256` (rejet de `none` / RS256 — anti *algorithm confusion*) ;
  - HMAC-SHA256 sur `header.payload`, comparaison **à temps constant** (`MessageDigest.isEqual`) ;
  - `exp` présent et futur ;
  - **le service refuse de démarrer sans `SERVICE_JWT_SECRET`**.
  - `/api/v1/adjudication/**` → **401** sans JWT valide ; `/healthz` ouvert.

### Pipeline — `AdjudicationController` (`POST /api/v1/adjudication/{reclamationId}/evaluer`) → `AdjudicationService.evaluer` (`@Transactional`, UNE transaction JDBC)
1. `SELECT` réclamation (12 colonnes autorisées) + garantie applicable + police, une requête.
2. Idempotence : statut **doit** être `EN_ADJUDICATION` → **409** sinon ; remboursement déjà
   présent → **409** (+ filet `DuplicateKeyException` sur l'index unique DB).
3. `SELECT id FROM polices WHERE id = ? FOR UPDATE` (**verrou pessimiste sur la ligne**), puis
   `SUM(montant_rembourse)` des remboursements de l'année civile pour l'adhérent (jointure
   `remboursements × reclamations.adherent_id`).
4. Calcul `Adjudicateur` — **`BigDecimal` partout, `RoundingMode.HALF_UP`, échelle 2** ；
   franchise → taux de couverture → plafond par acte → plafond annuel restant.
5. `INSERT INTO remboursements (...) RETURNING id` + `UPDATE reclamations SET statut = ?
   WHERE id = ? AND statut = 'EN_ADJUDICATION'` (CAS — 0 ligne ⇒ 409, rollback).
6. `SELECT log_audit('ADJUDICATION_<decision>', 'reclamations', <id>, <uuid svc>, <details jsonb>)`.
- Toute exception ⇒ **ROLLBACK complet**. `AdjudicationRepository` (interface) isole le JDBC
  pour un test unitaire sans base.

### Décision structurée renvoyée (v12 §3, JSON `snake_case`)
`{ decision: AUTO_ADJUDIQUE|REVUE_MANUELLE|REJETE, montant_rembourse, codes_rejet[],
plafond_restant_apres, duree_traitement_ms }`. Codes : `E001` police inactive (→ REJETE),
`E006` plafond atteint (→ REJETE si épuisé, REVUE_MANUELLE si réduit), `E010` montant > 150 000 (→ REVUE_MANUELLE).

### Tests JUnit — jeu de données de référence (`JeuDeDonneesReference` : taux 80 %, franchise 2 000, plafond/acte 50 000, plafond annuel 100 000, police ACTIVE 2026)
- **`AdjudicateurTest`** (calcul pur, `assertEquals(new BigDecimal("…"), …)` — valeur **et** échelle) :
  | Cas | Attendu (exact) |
  |---|---|
  | normal (réclamé 25 000, rien consommé) | `AUTO_ADJUDIQUE`, `18400.00`, `[]`, plafond après `81600.00` |
  | plafond dépassé partiel (réclamé 30 000, déjà 95 000) | `REVUE_MANUELLE`, `5000.00`, `[E006]`, `0.00` |
  | plafond épuisé (déjà 100 000) | `REJETE`, `0.00`, `[E006]`, `0.00` |
  | police inactive (SUSPENDUE) | `REJETE`, `0.00`, `[E001]`, `100000.00` |
  | police hors période (soin en 2027) | `REJETE`, `0.00`, `[E001]` |
  | montant élevé (300 000, taux 100 %, sans plafond/acte) | `REVUE_MANUELLE`, `300000.00`, `[E010]`, `4700000.00` |
- **`AdjudicationServiceTest`** (Mockito, repo mocké — orchestration) : introuvable → 404 ;
  mauvais statut → 409 ; **doublon → 409** (aucune écriture) ; cas normal complet (INSERT
  `18400.00`, `majStatut("AUTO_ADJUDIQUE")`, `journaliser`) ; police inactive → REJETE ;
  `majStatut` renvoie 0 (course) → 409.
- **`ServiceJwtVerifierTest`** : signé OK / falsifié / mauvais secret / expiré / `alg=none` /
  malformé / secret absent.

### Exécution — JDK 21 + Maven installés, tests + appel HTTP réel exécutés

*(L'utilisateur a installé `EclipseAdoptium.Temurin.21.JDK` ; Maven 3.9.9 récupéré dans
`~/tools`. Les remarques du commit `b1742cf` sur l'absence de toolchain sont caduques.)*

- **`mvn test` → 19 tests, 0 échec** (`AdjudicateurTest` 6, `AdjudicationServiceTest` 6,
  `ServiceJwtVerifierTest` 7). `mvn package` → `target/adjudication-service-0.1.0.jar` (fat jar, ~26 Mo).
- **Appel HTTP réel** — service démarré contre la **vraie base Supabase**, connexion en
  tant que **`svc_adjudication`** (pooler session `:5432`), sur une chaîne semée
  (étab. + dossier + ticket + acte + réclamation `EN_ADJUDICATION`, garantie taux 80 %
  sans franchise, plafond annuel 500 000, montant réclamé 20 000) :
  | Appel | Résultat |
  |---|---|
  | `GET /healthz` | `200` `{"status":"UP"}` |
  | `POST …/evaluer` **sans jeton** | **`401`** |
  | `POST …/evaluer` **jeton HS256 falsifié** | **`401`** |
  | `POST …/evaluer` **jeton valide** | **`200`** `{"decision":"AUTO_ADJUDIQUE","montant_rembourse":16000.00,"codes_rejet":[],"plafond_restant_apres":484000.00,"duree_traitement_ms":73}` |
  | `POST …/evaluer` **2ᵉ appel** | **`409`** « … statut « AUTO_ADJUDIQUE » … » |
  | police `RESILIEE` | `{"decision":"REJETE","montant_rembourse":0.00,"codes_rejet":["E001"],"plafond_restant_apres":500000.00,…}` |
  | réclamation inexistante | **`404`** |
  - En base après le 1ᵉʳ appel : `reclamations.statut = AUTO_ADJUDIQUE`, ligne `remboursements`
    (`16000.00` / `484000.00` / `AUTO_ADJUDIQUE` / `duree_traitement_ms=73`), ligne
    `audit_log` `ADJUDICATION_AUTO_ADJUDIQUE` (`user_id` = constante svc, `organisation_id` NULL).
  - **Toute la transaction exécutée par `svc_adjudication`** (BYPASSRLS + grants stricts en colonnes).
  - Données de test supprimées ; service arrêté.

### ⚠️ Correctif c — `prisma/sql/020_prompt24c_svc_adjudication_login.sql`
Découvert pendant l'appel HTTP réel :
1. **`svc_adjudication` était `NOLOGIN`** (PROMPT 24 partie 1) → le microservice ne pouvait
   pas ouvrir de connexion JDBC. → `ALTER ROLE svc_adjudication LOGIN` (+ mot de passe posé
   **hors versionnement** : `ALTER ROLE svc_adjudication PASSWORD '…'`). C'est une session
   **de service**, jamais une session utilisateur — cohérent avec la spec v12 (`create role
   svc_adjudication login password '…' bypassrls`).
2. **`SELECT … WHERE r.deleted_at IS NULL`** échouait (`permission denied for column
   reclamations.deleted_at`) → `GRANT SELECT (deleted_at) ON reclamations` (→ **13 colonnes**),
   nécessaire pour ne jamais adjuger une réclamation soft-deleted.
3. **`SELECT … FROM polices … FOR UPDATE`** échouait (`FOR UPDATE` exige le privilège
   `UPDATE` sur la table, que `svc_adjudication` ne doit pas avoir). → remplacé par un
   **verrou pessimiste transactionnel `pg_advisory_xact_lock(hashtextextended(<adherent>,0))`**
   (fonction `pg_catalog`, exécutable par PUBLIC — aucun grant) : deux adjudications du même
   adhérent ne calculent jamais le plafond en même temps, verrou relâché au commit/rollback.
   `AdjudicationRepository.verrouillerPourPlafond`.
4. `application.yml` : exclusion de `UserDetailsServiceAutoConfiguration` (plus de mot de
   passe Spring Security généré — l'auth est 100 % JWT de service).

#### Grants `svc_adjudication` après correctif c (13 colonnes sur `reclamations`)
`SELECT` reclamations : `id, organisation_id, dossier_soins_id, acte_dossier_id, adherent_id,
beneficiaire_id, police_id, garantie_id, montant, type_reclamation, statut, created_at,
**deleted_at**` · `UPDATE(statut)` · `SELECT(id, reclamation_id, montant_rembourse,
created_at)` + `INSERT` sur remboursements · `SELECT` sur garanties / grilles_tarifaires /
referentiel_actes / medicaments / polices · `EXECUTE` sur `log_audit`. `LOGIN` activé.

### Point d'arrêt volontaire
Le service n'appelle rien dans `apps/api` et `apps/api` ne l'appelle pas. Prochaine étape :
Edge Function `declencher-adjudication` (verrou `SOUMISE → EN_ADJUDICATION` déjà fait par
`ClaimsService.soumettre` au PROMPT 24 partie 1) + client HTTP côté `claims/`.

## 2026-09-10 — Incident sécurité : mot de passe DB fuité en historique git → remédiation

- **Cause** : un test `node -e` a écrit un fichier à un chemin dont le shell a mangé les
  backslashes → atterri dans `apps/api/` (`Usersarmel…dbpw.txt`), **commité + poussé**
  (commits `d4a82ba` / `2dda954`). Contenu = **le mot de passe Postgres de `DATABASE_URL`
  / `DIRECT_URL`**.
- **Remédiation effectuée** :
  1. **`git filter-repo --invert-paths --path <fichier>`** puis **`git push --force origin main`**
     → le blob et le mot de passe **ne sont plus dans l'historique de `origin/main`**
     (vérifié : `git rev-list --all --objects | grep dbpw` → vide ; `git log -S 'Aliance10'` → vide).
     Les commits `d4a82ba`→`79b0e51`, `71a3738`→`58f8ab7` réécrits ; `2dda954` (ne faisait
     que supprimer le fichier) élagué. `b1742cf` et antérieurs inchangés.
     Sauvegarde `git bundle` avant réécriture conservée localement (scratch).
  2. **Rotation du mot de passe Postgres** (`postgres` / projet) — **action dashboard
     Supabase à faire par l'utilisateur** (Settings → Database → Reset database password),
     puis mise à jour de `DATABASE_URL` / `DIRECT_URL` dans `apps/api/.env`. ⚠️ Tant que ce
     n'est pas fait, le mot de passe fuité reste valide (il a transité par GitHub).
  3. **Rotation du mot de passe `svc_adjudication`** — `ALTER ROLE svc_adjudication PASSWORD
     '<32 car. aléatoires>'` (généré, jamais affiché). Nouveau mot de passe placé dans
     **`adjudication-service/.env`** (gitignoré) comme `JDBC_PASSWORD`. Vérifié end-to-end :
     `POST /evaluer` → `{"decision":"AUTO_ADJUDIQUE","montant_rembourse":16000.00,…}` avec la
     connexion `svc_adjudication` sur le nouveau mot de passe. (Un décalage passager de
     ~1 min a été observé — cache de credentials du pooler Supavisor après un `ALTER ROLE`.)
- **`adjudication-service/`** : `.env` ajouté au `.gitignore` (avec `.env.local`,
  `run-local.sh`) ; **`.env.example`** committé (variables `JDBC_*` / `SERVICE_JWT_SECRET`
  documentées, sans valeurs).
- **Outils** : `winget` n'a pas de paquet Apache Maven → copie portable dans
  `~/tools/apache-maven-3.9.9` ; `Python.Python.3.12` + `git-filter-repo` installés pour la
  réécriture d'historique.

## 2026-09-10 — PROMPT 24 (partie 3 / 3) — `claims/` ↔ microservice Java branchés → 🎯 FIN COMPLÈTE DE LA PHASE 7

Le module `claims/` (NestJS) appelle désormais `adjudication-service` (Java) après le
verrouillage. Boucle d'adjudication complète, testée les deux services tournant ensemble.

### `apps/api/src/claims/`
- **`AdjudicationClientService`** (nouveau) : client HTTP vers le microservice.
  - Signe chaque requête d'un **JWT de service HS256** (`SERVICE_JWT_SECRET`, partagé via
    variables d'env, aligné sur `adjudication-service/.env` — jamais en dur), `exp` 120 s,
    `crypto` du runtime (aucune lib JWT).
  - `POST ${ADJUDICATION_SERVICE_URL}/api/v1/adjudication/{reclamationId}/evaluer`, **timeout
    dur** (`AbortController`, `ADJUDICATION_TIMEOUT_MS`, défaut 12 s).
  - Erreurs typées : `AdjudicationInjoignableError` (réseau / timeout / secret absent) vs
    `AdjudicationRefusError` (réponse HTTP 4xx/5xx, corps tronqué).
- **`ClaimsService.soumettre`** — après le CAS `SOUMISE → EN_ADJUDICATION` :
  - **succès** : le microservice a déjà posé `reclamations.statut` (grant `UPDATE(statut)`),
    NestJS complète `codes_rejet`, journalise `ADJUDICATION_<decision>`, et **retourne la
    décision complète** `{ reclamation, adjudication: { decision, montant_rembourse,
    codes_rejet, plafond_restant_apres, duree_traitement_ms } }` à l'appelant NestJS ;
  - **échec explicite** (`traiterEchecAdjudication`) : la réclamation **ne reste jamais
    bloquée à `EN_ADJUDICATION`** — CAS `EN_ADJUDICATION → SOUMISE` + `codes_rejet =
    ['ADJ_ECHEC']` (marqueur de reprise), audit `ECHEC_ADJUDICATION` (détail de l'erreur),
    et l'appelant reçoit **`503`** (injoignable) ou **`502`** (erreur microservice) — jamais
    un `500` opaque ;
  - **cas limite** : si le microservice a abouti mais la réponse HTTP s'est perdue
    (`statut` déjà avancé côté DB) → PAS de retour à `SOUMISE`, audit
    `ADJUDICATION_REPONSE_PERDUE` + `503` invitant à vérifier le remboursement.
- `claims.module.ts` : `AdjudicationClientService` ajouté aux providers.
- `apps/api/.env` : `ADJUDICATION_SERVICE_URL` + `SERVICE_JWT_SECRET` (aligné) ;
  `apps/api/.env.example` documenté.

### Tests
- **`jest` API 131/131** (+2) — `claims.service.spec.ts` étendu (`AdjudicationClientService`
  mocké) : succès applique la décision + retour complet ; `REJETE` persiste `codes_rejet` ;
  **microservice injoignable → retour `SOUMISE` + `503`** ; erreur HTTP → `SOUMISE` + `502` ;
  réponse perdue mais réclamation avancée → pas de retour `SOUMISE` ; idempotence (409, pas
  d'appel microservice) ; rôle non habilité (403, pas d'appel).
- **Test HTTP réel bout-en-bout — 18/18** (les DEUX services lancés : NestJS `:3001` +
  `adjudication-service` `:8899`, session `armelk01@yahoo.fr` `ASSUREUR_INFORMATIQUE`,
  garantie taux 80 % / plafond annuel 500 000) :
  - **A) nominal** : `POST /claims/reclamations/soumettre {acteDossierId}` → **201**,
    `reclamation.statut = AUTO_ADJUDIQUE`, `adjudication = { decision: AUTO_ADJUDIQUE,
    montant_rembourse: 20000 (25000 × 80 %), plafond_restant_apres: 480000,
    duree_traitement_ms: 74 }` ; en base : `remboursements` (20000.00), audit
    `SOUMISSION_RECLAMATION` + `ADJUDICATION_AUTO_ADJUDIQUE` (côté NestJS **et** côté Java) ;
    `GET /claims/reclamations/:id` confirme la persistance ;
  - **B) microservice Java tué pendant l'appel** → `POST /soumettre` renvoie **`503`**
    (« Service d'adjudication indisponible : … fetch failed. Réclamation remise à SOUMISE … »),
    **pas de `500`** ; en base : réclamation `SOUMISE`, `codes_rejet = ['ADJ_ECHEC']`, aucun
    remboursement, audit `ECHEC_ADJUDICATION` ;
  - **C) microservice redémarré** → re-soumission du même acte → **201**, `AUTO_ADJUDIQUE`,
    `montant_rembourse: 14400` (18000 × 80 %), `plafond_restant_apres: 465600`
    (**= 480000 − 14400** : le cumul annuel par adhérent est bien pris en compte via le
    verrou pessimiste + `SUM` de l'année côté Java).
  - Données e2e supprimées ; les deux services arrêtés.

### 🎯 Jalon — Phase 7 (adjudication) terminée
- `reclamations` + `remboursements` + rôle `svc_adjudication` (grants stricts) — PROMPT 24 §1.
- `adjudication-service/` (Spring Boot, JWT de service, pipeline `BigDecimal`, une transaction
  JDBC, `pg_advisory_xact_lock`) — PROMPT 24 §2.
- **`claims/` ↔ `adjudication-service` branchés, avec gestion d'échec sans blocage** — PROMPT 24 §3.

Backend Phases 1 → 7 complètes. Prochaine étape : Phase 8 (paiements / reversements) ou
reprise de la séquence des prompts selon `07-sequence-prompts-EXECUTION-v19.md`.

## 2026-09-10 — Revue de consolidation puis 3 corrections (avant reprise du dev)

Revue complète depuis le PROMPT 0 (état réel vérifié contre le code + la base, pas
seulement PROGRESSION.md). 3 écarts prioritaires corrigés, chacun vérifié en HTTP/SQL
réel avant commit — le reste (module member/adhérents PROMPT 12, cartes PROMPT 13,
géocodage PROMPT 15, écrans Phase 6/7) reste à planifier.

### 1. `ARCHITECTURE-DECISIONS.md` (nouveau) — 3 déviations tracées
- **ADR-001** : `pg_advisory_xact_lock(hashtextextended(adherent_id, 0))` au lieu de
  `SELECT … FOR UPDATE` pour le verrou de plafond (raison : ne pas accorder `UPDATE`
  table-level sur `polices` à `svc_adjudication`). Équivalence vérifiée en Phase 7.
- **ADR-002** : RLS *deny-by-default* en lecture sur `profils` / `organisations`
  (aucune policy `SELECT`) — intentionnel : NestJS contourne la RLS via `postgres`,
  un refus total protège contre tout accès direct hors NestJS (anti-énumération de
  l'annuaire d'identité).
- **ADR-003** : **référence unique** des grants `svc_adjudication` (relevés en base
  le 2026-09-10 : attributs de rôle, `USAGE`, SELECT tables, SELECT/UPDATE colonnes
  `reclamations`, SELECT/INSERT `remboursements`, `EXECUTE log_audit`) — remplace le
  recoupement de `sql/018` + `019` + `020`. Pointeur ajouté dans `SECURITY.md`.

### 2. `tickets_soins.organisation_id` + RLS directe — `prisma/sql/021`
- Constat : `tickets_soins` (sql/014) n'avait **pas** `organisation_id` ; son
  isolation multi-tenant ne reposait que sur une **jointure implicite** vers
  `dossiers_soins`. Seule table du parcours de soins dans ce cas.
- Ajouté : colonne `organisation_id NOT NULL` (backfill depuis le dossier) + index ;
  trigger `BEFORE INSERT tickets_soins_set_organisation_id()` qui **refige** toujours
  la valeur depuis `dossiers_soins` (défense en profondeur : un INSERT SQL direct ne
  peut pas la faire diverger) ; policy `tickets_soins_lecture` **réécrite** pour
  porter directement sur `tickets_soins.organisation_id` (plus de sous-`EXISTS` sur
  `dossiers_soins`).
- Côté applicatif : `CareEpisodeService.ouvrirDossier` passe `organisationId` à la
  création du ticket, dans la même transaction que le dossier.
- `schema.prisma` : `TicketSoins.organisationId` + relation `Organisation` + index.

### 3. `apps/api` refuse de démarrer sans `SERVICE_JWT_SECRET`
- `main.ts` → `verifierSecretsObligatoires(app)` (après `NestFactory.create`, donc
  après chargement de `.env` par `ConfigModule`) : si `SERVICE_JWT_SECRET` est absent
  ou vide → log `ERROR` explicite (pointant vers `apps/api/.env`) + `app.close()` +
  `process.exit(1)`. Évite un démarrage « réussi » suivi d'un `401` silencieux au
  premier appel d'adjudication.
- `.env.example` : mention « OBLIGATOIRE — le serveur refuse de démarrer sans ».

### Tests réels
- **jest API 131/131**, `tsc --noEmit` OK, `nest build` OK.
- **Démarrage** : `SERVICE_JWT_SECRET="" node dist/main.js` → refus, `exit 1`, message
  clair ; démarrage normal (secret présent) → `Nest application successfully started`,
  `GET /api/v1/identity/me` → 401 (guard actif).
- **`tickets_soins` bout-en-bout HTTP** (serveur lancé, compte `ASSUREUR_EXPLOITATION`
  éphémère, `POST /api/v1/preauthorization/codes-consultation/valider` → 201) :
  ticket créé avec `organisation_id = organisation_id du dossier` (cohérent) ;
  prédicat de la policy vérifié : `visible_org_A = true`, `visible_org_B = false` ;
  trigger vérifié : INSERT SQL avec `organisation_id` volontairement faux → valeur
  stockée forcée à celle du dossier (transaction rollback, rien persisté).
- Migration `021` appliquée en base (`prisma db execute`). Données e2e supprimées,
  compte éphémère supprimé, serveurs arrêtés.

## 2026-09-10 — PROMPT 12 : module `member` (adhérents + bénéficiaires) — dette FK comblée

Le module le plus structurant du MVP restant (v9 phase 3). Matérialise le fichier des
membres et transforme la dette de l'audit (`adherent_id` / `beneficiaire_id` en UUID
bruts) en vraies clés étrangères.

### Base — `prisma/sql/022`
- **`adherents`** (id, organisation_id FK, souscripteur_id FK, police_id FK?, `numero_adherent`
  unique généré `ADH-YYYY-NNNNNN` via séquence, nom, prenom, date_naissance, sexe M/F,
  statut ACTIF/SUSPENDU/RADIE, `numero_carte` unique généré `CM-NNNNNNNNNN`, iban_ou_rib?,
  banque_nom?, mode_paiement_prefere MOBILE_MONEY/VIREMENT_BANCAIRE?, timestamps+deleted_at).
- **`beneficiaires`** (id, adherent_id FK `on delete cascade`, lien_parente CONJOINT/ENFANT/
  PERE/MERE/AUTRE, nom, prenom, date_naissance, sexe, `numero_carte` unique généré (séquence
  partagée avec adherents), statut ACTIF/SUSPENDU/RADIE, timestamps+deleted_at).
- **RLS** : lecture = personnel de l'organisation OU l'adhérent lui-même (`profils.adherent_id`) ;
  écriture = `profil_a_role(org, [ASSUREUR_DIRECTION, _EXPLOITATION, _INFORMATIQUE])` OU
  `SOCIETE_ADMINISTRATION` pour SES propres adhérents (`souscripteur_id = profils.societe_id`).
  Bénéficiaires : org/rôle résolus via l'adhérent parent.
- **Clés étrangères ajoutées** (dette de l'audit → soldée) : `profils`, `cotisations`,
  `invitations`, `dossiers_soins` (adherent + beneficiaire), `codes_consultation` (×2),
  `codes_ordonnance` (×2), `factures_dossier` (×2), `reclamations` (×2) → 13 colonnes,
  noms `<table>_<col>_fkey`. `svc_adjudication` inchangé (il ne lit pas `adherents`).
- **Réconciliation des données de test** (bloc `DO` gardé — no-op sur env neuf) : 3 lignes
  référençaient des UUID d'adhérents fictifs (profil `armelk01+adherent`, 2 cotisations
  ACME) → 3 adhérents réels matérialisés (org A / souscripteur ACME / POL-2026-000004),
  ids conservés. `ADH-2026-000001..3`.

### `apps/api/src/member/`
- **`AdherentService`** : CRUD adhérents + bénéficiaires, changement de statut (audité),
  suppression logique (cascade bénéficiaires). Génération `numero_*` **déléguée aux
  séquences DB** (atomique, sans collision) — le service les expose, ne les calcule pas.
  Autorisation `assertGestion(ctx, souscripteurId)` = rôle ASSUREUR habilité OU
  `SOCIETE_ADMINISTRATION` du bon souscripteur. Audit via `log_audit()` dans la transaction.
- **`MemberController`** (`/api/v1/member/adherents…`) : POST/GET/PATCH/DELETE adhérents,
  `PATCH …/statut`, sous-ressource `…/:id/beneficiaires…`.
- `member.module.ts` ajouté à `app.module.ts` (avant `PlanModule`).
- `schema.prisma` : modèles `Adherent` / `Beneficiaire` + relations sur les 8 modèles
  référençants (Organisation, Souscripteur, Police, Profil, Cotisation, Invitation,
  DossierSoins, CodeConsultation, CodeOrdonnance, FactureDossier, Reclamation).

### Dette `care-episode.service.ts:290` corrigée
- Le raccourci « adhérent éligible = carte valide » (TODO PROMPT 12) est remplacé par
  `evaluerEligibiliteMembre()` : le **statut réel** est vérifié — `ACTIF` requis ; pour un
  bénéficiaire, l'adhérent titulaire doit aussi être `ACTIF`. Blocage précis sinon
  (`« Adhérent non éligible : statut … »`). Le dossier stocke désormais l'évaluation réelle
  (`evaluation.carteValide` etc.) au lieu de littéraux `true`.

### Tests
- **jest API 141/141** (+10 : 7 `adherent.service.spec` — création, bénéficiaire, refus
  rôle comptable, SOCIETE_ADMINISTRATION ok/refusé, statut RADIE, sans-org ; 3
  `care-episode.service.spec` — adhérent RADIE / SUSPENDU / bénéficiaire dont le titulaire
  est RADIE → blocage, pas de `create`). `tsc --noEmit` OK, `nest build` OK.
  **Les 13 FK n'ont cassé aucun module existant** (18 suites préexistantes toujours vertes).
- **HTTP réel bout-en-bout** (serveur lancé, compte `ASSUREUR_EXPLOITATION` éphémère) :
  - `POST /member/adherents` → 201, `numeroAdherent = ADH-2026-000004`, `numeroCarte =
    CM-0000000004`, statut `ACTIF` ;
  - `POST …/:id/beneficiaires` ×2 → cartes `CM-0000000005` / `CM-0000000006` ; `GET` →
    2 bénéficiaires ;
  - `PATCH …/:id/statut {RADIE}` → 200 ;
  - **ouverture de dossier pour l'adhérent RADIE** → **409**
    `blocages: ["Adhérent non éligible : statut « RADIE » (ACTIF requis)."]` — nouveau
    comportement ;
  - réactivation `ACTIF` → ré-tentative → **201**, dossier ouvert, `adherentEligible: true`
    (valeur réelle de l'évaluation).
  - Données e2e supprimées, compte éphémère supprimé, serveurs arrêtés. Base : 3 adhérents
    de réconciliation conservés (ils portent des données de test réelles désormais).

### Jalon partiel — module `member` livré (adhérents/bénéficiaires)

## 2026-09-10 — PROMPT 13 : cartes de membre (PDF + QR + Storage) — FIN DE LA PHASE 3

### Choix d'architecture : endpoint NestJS, pas d'Edge Function
La génération réutilise le RBAC du module `member/` (`ROLES_GESTION_MEMBRE` +
`SOCIETE_ADMINISTRATION`), `IdentityService`, la chaîne de rôles et `log_audit()` — tout
côté NestJS. Une Edge Function Deno dupliquerait ce socle. Documenté dans le service.

### Base — `prisma/sql/023`
- Bucket Storage **privé** `cartes` (`storage.buckets`, `public=false`, mime `application/pdf`,
  limite 25 Mio). Aucune policy sur `storage.objects` pour ce bucket → inaccessible en
  anon/authenticated ; seul `service_role` (côté NestJS) y écrit et signe des URL.

### `apps/api/src/member/carte.service.ts` — `MemberCarteService`
- `pdf-lib` (pur JS, pas de binaire natif → compatible SAC) + `qrcode` pour le QR PNG.
- Une page/carte : bandeau organisation, nom complet, qualité (titulaire / ayant droit +
  lien + titulaire), **n° de carte**, **formule** (`produit nom + version` de la police),
  **date de validité** (`police.dateFin`), **QR encodant le `numero_carte`**, n° d'adhérent.
- Téléversement via l'API Storage REST (`fetch`, clé `service_role`, `x-upsert`), puis
  **URL signée** (`/object/sign/cartes/…`, TTL `CARTE_URL_TTL_SECONDS`, défaut 3600 s).
- Endpoints (`MemberController`) :
  `POST /member/adherents/:id/carte`,
  `POST /member/adherents/:id/beneficiaires/:beneficiaireId/carte`,
  `POST /member/souscripteurs/:souscripteurId/cartes` (**lot** : 1 PDF multi-pages, tous
  les adhérents `ACTIF` du souscripteur ; `SUSPENDU`/`RADIE` exclus).
- Réponses : `{ url, expiresIn, chemin, numeroCarte, qrCode(data-url) }` (unitaire) /
  `{ url, expiresIn, chemin, nombreCartes }` (lot). Audit `GENERATION_CARTE_*` /
  `GENERATION_CARTES_LOT`.
- `.env.example` : `CARTE_URL_TTL_SECONDS` documenté.

### Frontend — `apps/web`
- `components/dashboard/cartes-souscripteur.tsx` (`'use client'`) : carte « Cartes de
  membre » + bouton **« Générer les cartes »** ; au clic → server action → ouverture du
  PDF (URL signée) dans un nouvel onglet, message avec le nombre de cartes et la validité.
- `souscripteurs/actions.ts` : `genererCartesSouscripteur(souscripteurId)`.
- `souscripteurs/[id]/page.tsx` : `<CartesSouscripteur>` ajouté à la vue détail.

### Tests
- **jest API 147/147** (+6 : `carte.service.spec` — round-trip QR décodable [`qrEnPng` →
  `pngjs` + `jsqr`], carte adhérent [PDF `%PDF-`, 2 appels Storage, URL signée, QR =
  `numero_carte`], lot [PDF multi-pages, `nombreCartes`], lot vide → 404, rôle non habilité
  → 403 sans appel réseau, carte bénéficiaire [QR = sa propre carte]). `tsc` API + web OK,
  `nest build` OK.
- **HTTP réel bout-en-bout** (serveur lancé, compte `ASSUREUR_EXPLOITATION` éphémère,
  souscripteur ACME = 5 adhérents `ACTIF` + 1 `SUSPENDU`) :
  - `POST /member/adherents/:id/carte` → URL signée, `content-type: application/pdf`,
    PDF téléchargé (4,5 Kio) — **QR extrait du PDF et décodé = `CM-0000000007`** (le
    `numero_carte` de l'adhérent), 1 page ;
  - carte bénéficiaire → QR extrait du PDF = `CM-0000000010` (sa propre carte) ;
  - `POST /member/souscripteurs/:id/cartes` → `nombreCartes = 5`, PDF de **5 pages**
    (l'adhérent `SUSPENDU` bien exclu — 6 adhérents ACME au total), QR de la 1ʳᵉ page
    décodable.
  - Objets Storage de test supprimés (via l'API Storage `service_role`), adhérents/
    bénéficiaire/comptes éphémères supprimés, serveur arrêté. Base : 3 adhérents de
    réconciliation conservés.

### 🎯 Jalon — PHASE 3 (adhérents et cartes) TERMINÉE
- PROMPT 12 : module `member` (adhérents + bénéficiaires) + 13 FK (dette de l'audit) +
  contrôle d'éligibilité au parcours de soins sur le statut réel.
- PROMPT 13 : cartes de membre PDF + QR, stockage privé + URL signée, génération unitaire
  et en lot, écran de déclenchement.
- Restent hors Palier 1 / autres phases : PROMPT 15 (géocodage automatique), écrans dédiés
  par sous-rôle (Phase 12), portail adhérent (Phase 13).

## 2026-09-10 — Écrans du parcours de soins côté établissement (`/dashboard-centre-medical`)

Frontend `apps/web` (skill `health-insurance-core-ui`, patterns réutilisés) + 1 extension
backend d'autorisation.

### Décisions (tranchées avec l'utilisateur avant codage)
- **Code d'ordonnance** : conservé anti-fraude (v8 §3) — le médecin/établissement ne voit
  JAMAIS le code, il part à l'adhérent (APP/SMS). L'écran affiche seulement « Ordonnance
  établie — code envoyé à l'adhérent ». Aucune modif backend.
- **Génération de facture** : `ROLES_GENERATION_FACTURE` étendu à `CENTRE_MEDICAL_COMPTABLE`
  + `CENTRE_MEDICAL_ADMINISTRATIF` (contrôle d'établissement ajouté dans `genererFacture`,
  comme `ajouterActe` ; `CENTRE_MEDICAL_COMPTABLE` ajouté à `ROLES_CENTRE_MEDICAL`). Garde-
  fous intacts : montants calculés serveur, code de facturation → adhérent uniquement,
  confirmation de paiement toujours réservée à `ASSUREUR_COMPTABLE`.

### Backend
- `preauthorization.types.ts` : `ROLES_GENERATION_FACTURE` (+2) et `ROLES_CENTRE_MEDICAL` (+1).
- `preauthorization.service.ts` `genererFacture` : contrôle d'établissement pour le
  personnel centre médical (403 si autre établissement).
- `care-episode.service.ts` `chargerDossier` : `ticket.facture` inclus **en `select`
  explicite SANS `code_facturation`** (le code reste visible du seul adhérent, anti-fraude
  v8 §5) — permet la vue comptable sans nouvel endpoint.
- Tests : +3 `preauthorization-facture.service.spec` (comptable centre du bon
  établissement → OK ; autre établissement → 403 ; médecin → 403). **jest API 150/150**,
  `tsc` OK, `nest build` OK.

### Frontend — `apps/web/app/dashboard-centre-medical/`
- `layout.tsx` : garde `entite === CENTRE_MEDICAL` + rattachement établissement ; nav
  commune aux 4 sous-rôles (`lib/dashboard-nav.ts` → clé `/dashboard-centre-medical`).
- `lib/centre-medical.ts` : ensembles de rôles **miroir du backend** (pour le retrait
  visuel des actions non autorisées — l'API reste seule juge).
- **1. `/accueil`** (`accueil-ecran.tsx`) : champ code + motif + « Valider le code » →
  succès (n° de traitement + lien dossier) ou refus avec la **liste précise des blocages**.
  Formulaire masqué si le rôle n'est pas dans `ROLES_GESTION_DOSSIER`.
- **2. `/medecin`** + `/[id]` (`dossiers-ecran.tsx`, `dossier-detail.tsx`) : DataTable des
  dossiers OUVERT de l'établissement ; détail = consultations + actes + boutons pilotés par
  l'état réel (`dossier.statut` / `ticket.statut`) et le rôle : « Ajouter une consultation »
  (médecin uniquement), « + Acte » / « + Ordonnance » par consultation, « Clôturer le
  dossier ». L'ordonnance n'affiche jamais de code.
- **3. `/comptable`** + `/[id]` (`facturation-ecran.tsx`, `ticket-detail.tsx`) : DataTable
  des dossiers CLÔTURÉS ; détail = actes + total + carte Facture (montant total / part
  assurance / part patient / statut / **état de validation par le patient**). Bouton
  « Générer la facture » affiché seulement si le rôle est habilité **et** le ticket
  clôturé **et** aucune facture existante ; sinon note explicite.
- `/` et `/administratif` → redirigent vers `/accueil`.

### Test — navigateur réel (`_e2e_parcours_soins.mjs`, session `@supabase/ssr`)
Serveurs API `:3001` + Next `next start` `:3000`. 4 comptes éphémères
(`CENTRE_MEDICAL_ACCUEIL` / `_MEDECIN` / `_COMPTABLE` + adhérent existant), 1 clinique de
test. **Parcours complet vérifié bout-en-bout :**
1. adhérent génère + confirme un code de consultation ;
2. **accueil** valide → dossier `TRT-2026-09-…` ouvert ;
3. **médecin** ajoute une consultation, un acte (15 000 F), émet une ordonnance
   (aucun code renvoyé au médecin), puis **clôture** → dossier + ticket `CLOTURE` ;
4. **comptable centre médical** génère la facture → `EMISE`, total 15 000 / assurance
   12 000 / patient 3 000, code de facturation **non renvoyé** à l'établissement ;
   l'accueil qui tente la facturation → **403** ;
5. l'adhérent voit puis valide le code de facturation → facture `VALIDEE`.
Rendu des 5 écrans avec la session réelle de chaque rôle (HTTP 200, contenu attendu) ;
le bouton « Générer la facture » est **absent** de l'écran comptable pour un compte accueil.
Données e2e + comptes éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — parcours de soins côté établissement disponible en UI
Phase 6 (anti-fraude) : le backend était complet et testé ; il a désormais ses écrans.

## 2026-09-10 — Écrans de réclamations côté assureur + endpoint de revue manuelle

### Backend — `claims/` : `validerManuellement` (nouveau)
Aucun endpoint de validation manuelle n'existait → ajouté.
- `POST /claims/reclamations/:id/valider-manuellement` `{ decision: APPROUVE|REJETE,
  montantAjuste?, motif }` — réclamation `REVUE_MANUELLE` uniquement.
- **Autorisation selon le type** : types médicaux (SOIN, HOSPITALISATION, PHARMACIE,
  OPTIQUE, DENTAIRE, ANALYSES, IMAGERIE) → `ASSUREUR_MEDECIN_CONSEIL` ; autres (AUTRE) →
  `ASSUREUR_EXPLOITATION` ; `ASSUREUR_DIRECTION` traite les deux. 403 sinon.
- `APPROUVE` → statut `AUTO_ADJUDIQUE` (+ `remboursements.montant_rembourse` = `montantAjuste`
  si fourni, `decision` = `REVUE_MANUELLE_APPROUVE`) ; `REJETE` → statut `REJETE`,
  remboursement à 0, code `REJET_MANUEL` ajouté. Audit `VALIDATION_MANUELLE_RECLAMATION`.
- `claims.types.ts` : `TYPES_RECLAMATION_MEDICAUX`, rôles de revue, `LIBELLE_CODE_REJET`
  (E001 / E006 / E010 / ADJ_ECHEC / REJET_MANUEL).
- Tests : +6 `claims.service.spec` (approuve médical par médecin-conseil, montant ajusté,
  rejet + code, exploitation refusée sur SOIN → 403, exploitation OK sur AUTRE, mauvais
  statut → 409). **jest API 156/156**, `tsc` + `nest build` OK.

### Frontend — `apps/web`
- `lib/reclamations.ts` : statuts + tons + `LIBELLE_CODE_REJET` + `roleRevuePour()` /
  `peutTraiterRevue()` — **miroir du backend**, pour le retrait visuel.
- `app/dashboard-assureur/reclamations-actions.ts` : `validerReclamationManuellement`.
- **1. `/dashboard-assureur/informatique/reclamations`** (`reclamations-liste.tsx`) :
  DataTable — n°, patient, type, montant réclamé, remboursé, `StatutBadge` (6 statuts),
  codes de rejet, date. Filtre par statut. `GrilleCartes` + bouton d'accès rapide vers la
  file « En revue manuelle ».
- **2. `/reclamations/[id]`** (`reclamation-detail.tsx`) : montant réclamé ; **décision de
  l'adjudication** (décision microservice, montant remboursé, plafond restant après, durée
  de traitement en ms, codes de rejet **avec leur libellé**) ; **dossier de soins d'origine**
  (n° de traitement, statut, ticket, actes) via un 2ᵉ appel `care-episode`.
- **3. `/reclamations/revue-manuelle`** + `medecin-conseil/reclamations-revue`
  (`revue-manuelle-file.tsx`, partagé) : file dédiée ; action **« Traiter »** (modale :
  décision APPROUVE/REJETE, montant ajusté optionnel, motif) affichée **seulement si le
  rôle connecté correspond au type de réclamation** — sinon mention « revue médecin-conseil
  / exploitation ».
- Nav : « Réclamations » (INFORMATIQUE), « Réclamations en revue » (MEDECIN_CONSEIL).

### Test — navigateur réel (`@supabase/ssr`, 3 serveurs : API + adjudication-service + Next)
Comptes éphémères `ASSUREUR_INFORMATIQUE` + `ASSUREUR_MEDECIN_CONSEIL` ; dossier clôturé
seedé avec 2 actes (25 000 F / 200 000 F).
1. soumission de la réclamation standard → **AUTO_ADJUDIQUE**, montant remboursé **20 000 F**,
   durée 80 ms — visible immédiatement dans la liste ;
2. soumission de la réclamation à montant élevé → **REVUE_MANUELLE**, `codes_rejet = ['E010']`,
   montant calculé **160 000 F** — présente dans la file dédiée ;
3. `ASSUREUR_INFORMATIQUE` tente de traiter la réclamation SOIN → **403** ;
4. **médecin-conseil** traite : APPROUVE + montant ajusté 150 000 → statut **AUTO_ADJUDIQUE**,
   `remboursements.montant_rembourse` = 150 000, `decision` = `REVUE_MANUELLE_APPROUVE` ;
5. répercussion : détail = AUTO_ADJUDIQUE, sortie de la file de revue.
Écrans rendus (session réelle) : liste, détail (décision d'adjudication visible), file de
revue (informatique + médecin-conseil) ; bouton « Traiter » **absent** pour l'informatique
sur une réclamation SOIN. Données e2e + comptes supprimés, serveurs arrêtés.

### 🎯 Jalon — Phase 7 (réclamations et adjudication) : UI livrée
Backend + microservice + écrans de réclamations complets (liste, détail, revue manuelle).

### État du Palier 1 (MVP, phases 0–7)
- Phases 0, 1, 2, 3, 5, 6, 7 : **complètes** (backend + écrans).
- Phase 4 : PROMPT 14 (réseau de soins) complet ; **reste PROMPT 15 — géocodage automatique
  des établissements + vérification périodique** (fonctionnalité backend, pas un écran).
- Écrans de gestion des adhérents/bénéficiaires (CRUD) : non construits (jamais demandés ;
  le module `member` et l'écran « générer les cartes » existent).
Le parcours structurant assuré ↔ établissement ↔ adjudication ↔ réclamations est bouclé
côté écrans.

## 2026-09-10 — Écran de gestion des adhérents et bénéficiaires

### Backend — `member/` (compléments)
- `MemberCarteService.genererCarteAdherent` / `genererCarteBeneficiaire` : **refusent
  (409)** si le membre (ou le titulaire) n'est pas `ACTIF` — « Carte indisponible : … ».
  Cohérent avec `genererCartesSouscripteur` qui filtrait déjà sur `ACTIF`.
- `AdherentService.listerAdherents` / `chargerAdherent` : includes enrichis
  (`souscripteur {nom, type}`, `police {numeroPolice, statut, produit}`) pour la
  DataTable et la vue détail.
- Tests : +1 `carte.service.spec` (adhérent SUSPENDU → 409, aucun téléversement).
  **jest API 157/157**, `tsc` + `nest build` OK.

### Frontend — `apps/web`
- `lib/member.ts` : statuts + tons + libellés + `LIENS_PARENTE` / `MODES_PAIEMENT` /
  `SEXES` + `peutGererMembres()` (miroir de `member.types.ts`).
- `app/dashboard-assureur/adherents-actions.ts` (partagé assureur + société) :
  `creerAdherent`, `changerStatutAdherent`, `ajouterBeneficiaire`,
  `changerStatutBeneficiaire`, `genererCarteAdherent` / `genererCarteBeneficiaire`.
- **`/dashboard-assureur/informatique/adherents`** (`adherents-liste.tsx`) : DataTable
  (n° adhérent, nom/prénom, souscripteur/police, `StatutBadge` ACTIF/SUSPENDU/RADIE,
  n° carte, nb bénéficiaires) ; filtre par statut ; `FormulaireModal` « Nouvel adhérent »
  (souscripteur → filtre les polices, nom, prénom, naissance, sexe, mode de paiement).
- **`/adherents/[id]`** (`adherent-detail.tsx`) : informations ; **carte de membre**
  (`carte-bouton.tsx` — génère + ouvre le PDF + aperçu QR ; **signalée indisponible** si
  l'adhérent n'est pas ACTIF, bouton retiré) ; **changement de statut** ACTIF/SUSPENDU/
  RADIE avec motif ; DataTable des bénéficiaires + « Ajouter un bénéficiaire » (lien de
  parenté, nom, prénom, naissance, sexe) + carte par bénéficiaire + suspendre/réactiver.
- **`/dashboard-societe/` (nouveau dashboard)** : `layout.tsx` (garde
  `entite === SOCIETE_AFFILIEE`), `administration/adherents` (+ `/[id]`) réutilisant les
  mêmes composants, souscripteur **verrouillé** sur celui de la société
  (`SOCIETE_ADMINISTRATION` ne gère que ses propres adhérents — cohérent avec la RLS
  `adherents_ecriture`). Nav `NAV_PAR_DASHBOARD['/dashboard-societe']`.
- Nav : « Adhérents » ajouté à INFORMATIQUE.
- Actions d'écriture retirées visuellement si le rôle connecté n'est pas habilité
  (`peutGererMembres`) ; boutons de carte / statut pilotés par le statut réel.

### Test — navigateur réel (`@supabase/ssr`, compte `ASSUREUR_INFORMATIQUE` éphémère)
1. création d'un adhérent → `ADH-2026-…` / `CM-…` générés ;
2. ajout de 2 bénéficiaires → cartes générées ;
3. génération de la carte de l'adhérent (ACTIF) → URL signée + aperçu QR ;
4. passage du statut à **SUSPENDU** (avec motif) ;
5. nouvelle génération de carte → **409** « Carte indisponible : l'adhérent est
   « SUSPENDU » » ;
6. écrans rendus (session réelle) : liste (n° carte visible) + détail — la carte est
   **signalée indisponible** et le bouton « Générer la carte » est retiré.
Données e2e + objets Storage + compte éphémère supprimés, serveurs arrêtés.

### 🎯 PALIER 1 (MVP) — fonctionnellement complet
Phases 0–7 : backend **et** écrans en place.
- 0–2 : fondations, provisioning, produit/souscription/cotisations.
- 3 : module `member` + adhérents/bénéficiaires + cartes (PDF/QR) + **écran de gestion**.
- 4 : réseau de soins (établissements/pharmacies). *Reste PROMPT 15 — géocodage
  automatique + vérification périodique : enrichissement backend, pas un écran.*
- 5 : référentiels actes/médicaments + homologation.
- 6 : parcours de soins anti-fraude (4 codes) + **écrans côté établissement**.
- 7 : réclamations + adjudication (microservice Java) + **écrans côté assureur** (liste,
  détail, revue manuelle).
Chaîne complète testable de bout en bout : provisioning → souscription → adhérent/carte →
code de consultation → dossier de soins → actes/ordonnance → facturation → réclamation →
adjudication (auto / revue manuelle) → décision finale.

## 2026-09-10 — PROMPT 15 : automatisation du réseau de soins (v8 §9) — Phase 4 close

### Backend — `provider/`
- **`prisma/sql/024`** : table `verifications_etablissement` (historique : établissement
  XOR pharmacie, `methode` APPEL_TELEPHONIQUE/VISITE_TERRAIN/AUTO_DECLARATIF,
  `statut_confirme` ACTIF/FERME/DEMENAGE/A_REVERIFIER, `verifie_par` FK profils) + RLS
  (lecture org, écriture ASSUREUR_INFORMATIQUE). Colonnes `verification_statut` +
  `date_derniere_verification` ajoutées sur `etablissements_sante` et `pharmacies`.
- **`GeocodageService`** (nouveau) : résolution adresse → coordonnées via **Nominatim /
  OpenStreetMap**. Politique d'usage respectée — **un seul appel** par création, jamais de
  lot ; `User-Agent` obligatoire (`NOMINATIM_USER_AGENT`) ; timeout court ; **échec
  silencieux** (best-effort, ne bloque jamais). Config `NOMINATIM_*` dans `.env.example`.
- **`ProviderService`** :
  - `creerEtablissement` / `creerPharmacie` → si latitude/longitude absentes mais
    adresse présente : **géocodage automatique** avant l'insert. La réponse porte un
    tableau `avertissements` (`GEOCODAGE_AUTO` / `GEOCODAGE_ECHOUE`).
  - **détection de doublons** à la création : nom similaire (jetons significatifs,
    Jaccard ≥ 0,5) dans un **rayon de 200 m** (Haversine) → avertissement
    `DOUBLON_POSSIBLE` avec les candidats — **jamais un blocage**.
  - `enregistrerVerification` (`POST /provider/{etablissements|pharmacies}/:id/verifications`)
    → écrit la ligne d'historique + met à jour `verification_statut` /
    `date_derniere_verification` de la cible + audit. `GET …/verifications` (historique).
  - **`reverifierObsoletes`** (`POST /provider/verifications/reverifier-obsoletes`,
    déclenchable à la main — le cron viendra au déploiement) : marque `A_REVERIFIER`
    tout établissement / toute pharmacie **jamais vérifié ou non vérifié depuis > 12
    mois** (paramétrable). **Aucune désactivation** — alerte seule. Idempotent.
- Tests : **jest API 164/164** (+7 provider : géocodage auto réussi / échoué, doublon
  détecté / pas de faux positif, `reverifierObsoletes`, `enregistrerVerification`, garde
  de rôle). `tsc` + `nest build` OK.

### Frontend — `apps/web`
- `reseau-panneau.tsx` (écrans `/etablissements` et `/pharmacies`) :
  - champ **« Adresse complète »** ajouté au formulaire (latitude/longitude laissées
    vides → géocodage automatique, message de confirmation avec les coordonnées) ;
  - colonne **« Vérif. »** : `StatutBadge` **warning « À revérifier »** pour les entrées
    `A_REVERIFIER`, badge coloré pour le dernier état connu, « jamais vérifié » sinon ;
  - bandeau d'alerte en tête quand ≥ 1 entrée est à revérifier ;
  - bouton **« Marquer les entrées obsolètes »** (déclenche `reverifier-obsoletes`).
- `reseau-actions.ts` : `creerEtablissement`/`creerPharmacie` surfacent les
  `avertissements` (géocodage, doublon) ; `reverifierObsoletes` (nouveau).

### Test — HTTP réel (compte `ASSUREUR_INFORMATIQUE` éphémère, Nominatim en vrai)
1. création d'un établissement **sans coordonnées** (ville + commune + adresse) →
   **géocodage automatique réussi** (`5.362581, -3.9973451`), avertissement `GEOCODAGE_AUTO` ;
2. création d'un établissement **au nom très proche à ~44 m** → **avertissement
   `DOUBLON_POSSIBLE`** pointant vers le premier, création **non bloquée** ;
3. nom sans rapport dans la même zone → **aucun faux positif** ;
4. `reverifier-obsoletes` → **3 établissements marqués `A_REVERIFIER`** ;
5. vérification terrain (`APPEL_TELEPHONIQUE` → `ACTIF`) → `verification_statut` mis à
   jour, historique enregistré ;
6. écran `/etablissements` → **badge « À revérifier » visible**.
Données e2e + compte supprimés, serveurs arrêtés.

### 🎯 PHASE 4 (réseau de soins) — COMPLÈTEMENT CLOSE
4.1 établissements/pharmacies + géolocalisation · 4.2 grilles tarifaires · 4.3
**automatisation (géocodage, vérification périodique, doublons)** — fait.

### 🎯 PALIER 1 (MVP) — COMPLET
Toutes les phases 0–7 livrées (backend + écrans + automatisations prévues). Le dernier
écart identifié par l'audit de consolidation (PROMPT 15) est comblé. Prochaine étape :
« Fin du Palier 1 » de `07-sequence-prompts-EXECUTION-v19.md` → déploiement (AWS Amplify /
ECS Fargate), puis Palier 2.

---

## 2026-09-10 — Suites de l'audit de couverture frontend : Annuler une action SA + dashboard Direction

Deux écarts prioritaires de l'audit de couverture frontend traités.

### 1. Bouton « Annuler une action » — `/superadmin/societes`
- `societes/actions.ts` : `listerActionsEnAttente()` (GET `/superadmin/actions`) et
  `annulerActionSuperadmin(id)` (POST `/superadmin/actions/:id/annuler`, déjà exposé côté
  API depuis le PROMPT 22) + type `ActionEnAttente`.
- Nouveau composant client `components/superadmin/file-actions.tsx` : `FileActionsEnAttente`
  — carte « Actions en attente de confirmation (n) », une ligne par action initiée non
  confirmée (statut EMIS, non expirée — l'API ne renvoie qu'elles), bouton **« Annuler »**
  par ligne, `router.refresh()` au succès, message d'erreur si l'API refuse (409).
- `societes/page.tsx` : fetch parallèle des organisations + de la file, section rendue
  au-dessus de la liste des organisations (masquée si file vide).

### 2. Dashboard `ASSUREUR_DIRECTION` — `/dashboard-assureur/direction`
- Nouvelle route `app/dashboard-assureur/direction/{layout,page}.tsx`. Le premier admin
  créé par le Super Admin (rôle `ASSUREUR_DIRECTION`) y atterrit après connexion.
- `page.tsx` (server) — `GrilleCartes` : **Comptes provisionnés** (`identity/comptes`),
  **Polices actives** (`policy/polices?statut=ACTIVE`), **Réclamations en attente de revue**
  (`claims/reclamations` filtré `REVUE_MANUELLE`), **Sinistralité globale**
  (Σ remboursé / Σ cotisations encaissées — « — » si aucune cotisation). Section
  « Accès rapides » vers les écrans que l'API autorise déjà pour ce rôle :
  souscripteurs, produits, polices, adhérents, réclamations, utilisateurs
  (`ROLES_GESTION_{PLAN,POLICE,MEMBRE,SOUSCRIPTEUR,CLAIMS}` + provisioning incluent
  `ASSUREUR_DIRECTION`). **Pas** de cotisations ni de réseau de soins (réservés
  `ASSUREUR_INFORMATIQUE`).
- `informatique/layout.tsx` : garde élargie — accepte `dashboardRoute` ∈
  {informatique, direction} pour que la Direction atteigne réellement les écrans partagés.
- `lib/dashboard-nav.ts` : entrée `NAV_PAR_DASHBOARD['/dashboard-assureur/direction']`
  (vue d'ensemble + 6 écrans partagés, Utilisateurs en `minNiveau ADMIN`).

### Test — navigateur réel (compte SUPERADMIN + `ASSUREUR_DIRECTION` éphémère)
1. SA `initier` création d'organisation → action visible dans `GET /superadmin/actions` ;
   `POST …/annuler` → 201, l'action **disparaît de la file** ; ré-annuler → **409**.
2. Page `/superadmin/societes` : « Actions en attente de confirmation », le résumé de
   l'action et le bouton « Annuler » sont bien rendus.
3. SA `initier` + `confirmer` (code lu en base) avec `premierCompteRole ASSUREUR_DIRECTION`
   → **organisation créée + invitation `EN_ATTENTE` `ASSUREUR_DIRECTION`**, e-mail envoyé.
4. Compte `ASSUREUR_DIRECTION` : login OK → `/dashboard` **307 → /dashboard-assureur/direction**
   → page **200** avec les 4 cartes de métriques + « Accès rapides » ; ne montre pas
   Cotisations/Établissements.
5. Droits API confirmés pour ce rôle : `identity/comptes`, `policy/polices`,
   `claims/reclamations`, `billing/cotisations` (lecture), `tenant/souscripteurs`,
   `plan/produits` → tous 200 ; écrans `/informatique/{produits,polices,reclamations,utilisateurs}`
   → **200** (garde élargie OK, plus de redirection).
Organisation + invitation + comptes éphémères + codes de test supprimés, base au
référentiel (adherents 3, profils 3, organisations 2), serveurs arrêtés.

---

## 2026-09-10 — Compléments écrans ASSUREUR_INFORMATIQUE : rejet d'invitation + espace adjoint

### 1. Bouton « Rejeter » — `/dashboard-assureur/informatique/utilisateurs`
- `utilisateurs/actions.ts` : `rejeterInvitation(id, motif?)` → `POST /invitations/:id/rejeter`.
  ⚠️ L'API n'accepte le rejet **que** pour le statut `EN_ATTENTE_VALIDATION_INFORMATIQUE`
  (une invitation déjà envoyée se « Révoque »). Le bouton est donc placé à côté de
  « Valider », sur les propositions en attente de validation.
- `utilisateurs-panneau.tsx` : bouton **« Rejeter »** ouvrant une `FormulaireModal`
  centrée avec un champ **motif** (facultatif, tracé dans l'audit). Nouvelle section
  **« Invitations traitées »** (historique : ACCEPTEE / REJETEE / REVOQUEE / EXPIREE)
  — comble l'absence de visibilité sur les invitations closes relevée par l'audit.

### 2. `/dashboard-assureur/informatique-adjoint`
- Route `app/dashboard-assureur/informatique-adjoint/{layout,page}.tsx` : le rôle
  `ASSUREUR_INFORMATIQUE_ADJOINT` y atterrit. Vue d'ensemble = composant partagé
  `components/dashboard/informatique-vue-ensemble.tsx` (extrait de `informatique/page.tsx`,
  réutilisé par les deux routes, `adjoint` en prop pour la mention explicative).
- `informatique/layout.tsx` : garde élargie à `…/informatique-adjoint`.
- `lib/dashboard-nav.ts` : `navInformatique(racine)` factorise la nav ; l'adjoint a les
  **mêmes écrans**, seule la « Vue d'ensemble » pointe vers sa route.
- **Boutons de validation finale retirés pour l'adjoint** via
  `peutValiderFinal(role)` (`lib/identity.ts`, `Set` `ROLES_SANS_VALIDATION_FINALE`) :
  - `utilisateurs` : « Valider » / « Rejeter » masqués (prop `peutValider`) ;
  - `produits/[id]` : « Publier le produit » masqué (prop `peutPublier`), remplacé par
    une note « réservé au titulaire ».
  ⚠️ **Discordance constatée** : l'API renvoie `peutValider = true` pour l'adjoint
  (héritage `chaine.some(r => r.peutValider)` dans `identity.service`, cf. test
  `identity.service.spec.ts:111`), alors que le rôle propre porte `peut_valider = false`.
  Le masquage UI est donc fait sur le **code du rôle**, pas sur `permissions.peutValider`.
  À arbitrer côté API si l'on veut que l'adjoint reçoive réellement des 403.

### Test — navigateur réel (comptes `ASSUREUR_INFORMATIQUE` + `…_ADJOINT` éphémères)
1. Titulaire : `/utilisateurs` affiche 2 propositions avec « Valider » **et** « Rejeter ».
2. `POST /invitations/:id/rejeter {motif}` → **201**, `GET /invitations` : statut **REJETEE**.
3. `/utilisateurs` après rejet : la proposition **quitte « en cours »** (1 restante) et
   **apparaît en « Invitations traitées » avec le badge « Rejetée »**.
4. Adjoint : login → `/dashboard` **307 → /dashboard-assureur/informatique-adjoint** → 200
   (mêmes cartes de navigation + mention « réservées au titulaire »).
5. Adjoint `/utilisateurs` : la proposition restante est listée (**écran identique**),
   « Valider » / « Rejeter » **absents**, « Révoquer » + formulaire « Inviter » présents.
6. Adjoint `produits/[id]` (brouillon) : **« Publier le produit » absent**, note
   « réservée au titulaire » ; titulaire (contrôle) : bouton **présent**.
7. Adjoint : `souscripteurs` / `polices` / `cotisations` → **200** (écrans partagés OK).
Invitations + comptes éphémères supprimés, base au référentiel (profils 3, invitations 0),
serveurs arrêtés.

---

## 2026-09-10 — Correction cohérence : `permissions.peutValider` = valeur propre au rôle

### Audit préalable (demandé) — quel endpoint NestJS décide sur `peutValider` ?
**Aucun.** Revue exhaustive de `apps/api/src` : `permissions.peutValider` n'est lu par
aucun guard, décorateur ni service pour une décision d'autorisation. `SupabaseAuthGuard`
ne valide que le JWT. **Toutes** les décisions d'autorisation métier lisent
`permissions.roleChain` et le comparent à des listes de codes explicites
(`ROLES_GESTION_PLAN/POLICE/MEMBRE/CLAIMS/BILLING…`, `ROLE_SUPERADMIN`,
`ROLE_REVUE_SUPERVISION = 'ASSUREUR_DIRECTION'`, etc.). `permissions.peutValider` et
`permissions.niveauAcces` ne sont consommés que par le frontend (badge + filtrage nav du
`DashboardShell`, gating des boutons de l'espace informatique-adjoint). Changer le calcul
de `peutValider` est donc **sans effet sur l'autorisation API**.

### Correction
- `identity.service.ts` : `peutValider = profil.sousRole.peutValider` (valeur PROPRE au
  rôle assigné au profil) au lieu de `chaine.some(r => r.peutValider)` (OR sur la chaîne
  d'héritage). `roleChain`, `niveauAcces`, `dashboardRoute` continuent de remonter
  l'héritage. → un rôle adjoint qui porte `peut_valider = false` ne « peut plus valider »,
  même si son parent le peut.
- `identity.service.spec.ts` : la ligne 111 validait le comportement bugué
  (`peutValider === true` pour l'adjoint) — corrigée en `false`. Ajout de
  `ASSUREUR_COMPTABLE` / `ASSUREUR_COMPTABLE_ADJOINT` au jeu de test et d'un cas dédié
  (`peutValider` true pour les titulaires, false pour les deux adjoints, `roleChain`
  toujours héritée).
- Front : suppression du contournement `ROLES_SANS_VALIDATION_FINALE` /
  `peutValiderFinal()` (`lib/identity.ts`). `utilisateurs/page.tsx` et
  `produits/[id]/page.tsx` lisent désormais `etat.identity.permissions.peutValider` —
  même pattern que partout ailleurs. Commentaires de `informatique/layout.tsx` et
  `dashboard-nav.ts` mis à jour.

### Tests
- **HTTP réel** : `GET /identity/me` pour un compte `ASSUREUR_INFORMATIQUE_ADJOINT` →
  `peutValider: false` (était `true`), `roleChain = [ADJOINT, INFORMATIQUE]`,
  `niveauAcces: ADMIN`, `dashboardRoute: /dashboard-assureur/informatique-adjoint`
  (héritage intact). Compte éphémère supprimé, serveur arrêté.
- **Jest complet** : `20 suites / 165 tests` — tous verts. Aucun module ne dépendait de
  l'ancien comportement.
- `tsc --noEmit` web : OK.

Impact production : nul aujourd'hui (0 compte actif sur les 2 rôles adjoints concernés).

---

## 2026-09-10 — `/dashboard-assureur/medecin-souscripteur` : correction du 404 (audit)

Corrige l'écart bloquant identifié par l'audit de couverture frontend : le rôle
`ASSUREUR_MEDECIN_SOUSCRIPTEUR` retombait sur un 404 après connexion — le backend
(module `underwriting`, PROMPT 10) fonctionnait, mais aucun écran n'existait.

### Backend — deux ajouts ciblés (le reste du module existait déjà)
- `underwriting.service.ts` : `listerQuestionnaires` et `chargerQuestionnaireBrut`
  incluent désormais `souscripteur: { id, nom, type }` (le nom du souscripteur était
  absent des réponses — indispensable pour la liste et le détail côté écran).
- **Nouveau** `GET /underwriting/tarifications` (`listerTarifications`) — lecture des
  tarifications individuelles déjà calculées, réservée aux mêmes rôles que
  `POST tarifications` (`ROLES_TARIFICATION_INDIVIDUELLE`, dont
  `ASSUREUR_MEDECIN_SOUSCRIPTEUR`) ; aucun endpoint de lecture n'existait auparavant.
- `underwriting.service.spec.ts` : 2 tests ajoutés (403 pour `ASSUREUR_MEDECIN_CONSEIL`,
  lecture scopée organisation pour le médecin souscripteur).

### Frontend — `/dashboard-assureur/medecin-souscripteur/*`
- `layout.tsx` : garde stricte sur **`permissions.roleChain.includes('ASSUREUR_MEDECIN_SOUSCRIPTEUR')`**
  (pas seulement `dashboardRoute`) — refus = redirection serveur vers le dashboard réel
  du compte connecté, jamais un simple masquage client.
- `page.tsx` + `components/dashboard/underwriting/questionnaires-ecran.tsx` : `GrilleCartes`
  (en attente d'évaluation, décisions rendues ce mois, répartition ACCEPTE /
  ACCEPTE_AVEC_EXCLUSION / ACCEPTE_SURPRIME / REFUSE) + `DataTable` (souscripteur, date de
  soumission, `StatutBadge` statut, filtre par statut).
- `[id]/page.tsx` + `questionnaire-detail.tsx` : réponses (clé/valeur), antécédents
  déclarés, formulaire de décision (champs `surprimePourcent` / `exclusionsSpecifiques`
  conditionnels au choix, cohérents avec les validations API) — remplacé par un encart
  « décision déjà rendue » une fois `decision` non nulle (décision définitive, l'API
  refuse toute réévaluation avec 409).
- `tarifications/page.tsx` + `tarifications-liste.tsx` : lecture seule, aucune action.
- `lib/underwriting.ts` (libellés/tons, miroir de `underwriting.types.ts`) ;
  `lib/dashboard-nav.ts` : entrée `MEDECIN_SOUSCRIPTEUR` (Questionnaires + Tarifications).

### Test — navigateur réel (comptes `ASSUREUR_MEDECIN_SOUSCRIPTEUR` +
`ASSUREUR_MEDECIN_CONSEIL` éphémères, `numero_ordre_medecin` distincts)
1. Médecin souscripteur : login → `/dashboard` **307 → /dashboard-assureur/medecin-souscripteur**
   (**plus de 404**) → page **200**, toutes les cartes présentes.
2. `POST /underwriting/questionnaires` (souscripteur INDIVIDUEL de test) → **201**,
   listé sur l'écran ; détail **200** (réponses, antécédents, formulaire de décision).
3. `POST …/evaluer {ACCEPTE_SURPRIME, 15 %}` → **201** ; détail après décision : encart
   « déjà rendue », formulaire retiré. `/tarifications` → **200**.
4. Médecin conseil (séparation stricte, v10 §3) : `GET /dashboard-assureur/medecin-souscripteur`
   → **307 vers son propre dashboard** (refus serveur, pas un masquage optimiste) ; idem sur
   le détail. Côté API : `GET questionnaires`, `GET questionnaires/:id`, `GET tarifications`,
   `POST …/evaluer` → **403** partout.
- **Jest complet** : `20 suites / 167 tests` — tous verts. `tsc --noEmit` web : OK.
Questionnaire + souscripteur + comptes éphémères supprimés, base au référentiel
(profils 3, souscripteurs 4, questionnaires 1), serveurs arrêtés.

---

## 2026-09-10 — Filière SOCIETE_AFFILIEE complète : assurée, comptable, réception

Les 3 rôles restants de la filière société (le dashboard `administration` existait déjà).

### Correction de sécurité préalable — fuite de lecture inter-société (module `member/`)
Avant de construire les écrans, vérification précise des droits API pour chaque rôle
(demandée par le prompt) : `AdherentService.listerAdherents` et `.chargerAdherent`
(+ l'équivalent dans `CarteService`) ne scopaient la lecture par `societe_id` que pour
le rôle **exact** `SOCIETE_ADMINISTRATION` (`roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE)`).
Les 3 autres rôles `SOCIETE_AFFILIEE` (assurée, comptable, réception) passaient donc ce
filtre et lisaient **tous les adhérents de l'organisation, toutes sociétés clientes
confondues** — une fuite de données de santé inter-entreprises au sein du même assureur.
- Corrigé : la lecture scope désormais sur `ctx.entite === 'SOCIETE_AFFILIEE'` (tout rôle de
  la filière), cohérent avec le pattern déjà utilisé ailleurs (`policy.service`,
  `billing.service` : `ctx.entite !== 'ASSUREUR'`). **L'écriture reste réservée à
  `SOCIETE_ADMINISTRATION` seule** (`assertGestion`, inchangé) — aucune régression de
  permission, uniquement un resserrement de la lecture.
- `member.types.ts` : `ContexteAppelant.entite` ajouté ; `ENTITE_SOCIETE_AFFILIEE` exporté.
- 3 tests ajoutés à `adherent.service.spec.ts` (liste scopée, 404 cross-société, lecture OK
  dans son périmètre) — suite complète : **20/20, 170 tests**.
- Frontend, bug préexistant corrigé en le découvrant : `CarteBouton` (« Générer la carte »)
  s'affichait **sans condition** dans `AdherentDetail`, y compris pour un rôle en lecture
  seule (l'API l'aurait refusé en 403, mais c'est exactement le bouton-qui-échoue-toujours
  que l'audit avait signalé comme anti-pattern) — désormais gaté par `peutGerer`, comme le
  reste des actions.

### 1. `/dashboard-societe/assuree` (contact principal, ADMIN, `peutValider=true`)
- `assuree/{layout,page}.tsx` + `components/dashboard/societe/assuree-ecran.tsx` :
  `GrilleCartes` (statut du contrat, reste à payer, cotisations en retard, raccourci
  Adhérents) ; carte par police avec ses garanties (`GET /plan/produits/:id`, taux,
  plafonds, franchise, réseau) ; tableau des cotisations. **Pas de plafond consommé** —
  aucune source fiable côté API (nécessiterait de scoper `claims/reclamations`, non fait,
  voir gap ci-dessous) : la carte présente les plafonds **contractuels** avec une mention
  explicite de la limite.
- « Gérer les adhérents » renvoie vers l'écran **déjà construit**
  `/dashboard-societe/administration/adherents` (factorisé, pas dupliqué — mêmes composants
  `AdherentsListe`/`AdherentDetail`, `peutCreer`/`peutGerer` dérivés de `peutGererMembres`
  → lecture seule pour ce rôle, cohérent avec le pattern `informatique-adjoint`).

### 2. `/dashboard-societe/comptable`
- `comptable/{layout,page}.tsx` + `components/dashboard/societe/cotisations-societe-liste.tsx` :
  lecture des cotisations de sa société (`GET /billing/cotisations`, déjà scopé
  correctement par `entite !== 'ASSUREUR'`, aucun bug ici). **Pas de bouton de paiement** —
  vérifié précisément : `POST /billing/cotisations/:id/paiement` exige
  `ROLES_GESTION_BILLING = [ASSUREUR_COMPTABLE, ASSUREUR_INFORMATIQUE]`,
  `SOCIETE_COMPTABLE` n'y figure pas → 403 confirmé en test. Mention explicite en tête
  d'écran plutôt qu'un bouton silencieusement absent.

### 3. `/dashboard-societe/reception` — LECTURE_SEULE explicite
- `reception/{layout,page,[id]/page}.tsx` : réutilisent les composants factorisés
  `AdherentsSociete` / `AdherentSocieteDetail` (extraits de l'écran administration existant)
  avec `basePath="/dashboard-societe/reception"`. `peutGererMembres` renvoie `false` pour
  ce rôle → **aucune action d'écriture nulle part** (créer, statut, carte, bénéficiaire),
  vérifié à l'écran ET par 5 appels API directs (tous 403/404).

### Factorisation (nouveaux composants partagés)
`components/dashboard/adherents/adherents-societe.tsx` et `adherent-societe-detail.tsx`
portent désormais la logique de fetch+rendu commune aux écrans `administration/adherents`
et `reception` (paramétrée par `basePath`) — `administration/adherents/{page,[id]/page}.tsx`
ont été réduits à de simples wrappers. `dashboard-societe/layout.tsx` transmet maintenant
la vraie `permissions.dashboardRoute` du rôle connecté (au lieu du littéral
`/dashboard-societe` partagé par les 4 rôles) ; `dashboard-nav.ts` a une entrée de nav par
rôle réel.

### Test — navigateur réel (5 comptes éphémères : assurée, comptable, réception ×2
sociétés différentes, administration)
1. **Assurée** : login → 307 → `/dashboard-societe/assuree` → 200 (statut police, reste à
   payer, cotisations en retard, garanties de la police active) ; clic Adhérents → écran
   administration en lecture seule (pas de « Nouvel adhérent ») ; `POST /member/adherents`
   direct → **403**.
2. **Comptable** : login → 307 → `/dashboard-societe/comptable` → 200 (cotisations de SA
   société uniquement) ; aucun bouton de paiement ; `POST …/paiement` direct → **403** ;
   tentative d'accéder à `/reception` avec ce compte → **redirigé** (pas 200).
3. **Réception** : login → 307 → `/dashboard-societe/reception` → 200 (3 adhérents de sa
   société) ; détail adhérent → 200 sans « Générer la carte »/« Changer le statut »/
   « Ajouter un bénéficiaire » ; **5 appels API directs en écriture** (statut, carte,
   bénéficiaire, création, suppression) → **tous 403 ou 404**.
4. **Isolation inter-société** (2ᵉ compte réception, société différente) : liste **ne
   contient pas** les adhérents de la première société ; lecture directe d'un adhérent de
   l'autre société → **404** (page et API) — confirme le correctif de la fuite ci-dessus.
5. **Non-régression** SOCIETE_ADMINISTRATION : écran adhérents inchangé, « Nouvel
   adhérent » toujours présent.
Comptes éphémères + profils supprimés (aucune donnée créée — tous les essais d'écriture ont
échoué comme attendu), base au référentiel, serveurs arrêtés.

### Gap identifié, non traité (hors périmètre de ce prompt)
`ClaimsService.listerReclamations` ne scope pas non plus la lecture par société (même
famille de bug que celle corrigée ici, mais dans le module réclamations/sinistres — data de
santé). N'a pas été utilisé pour construire ces écrans (d'où l'absence du « plafond
consommé » côté assurée) ; à corriger dans un prompt dédié avant d'exposer une vue
réclamations à un rôle SOCIETE_*.

---

## 2026-09-11 — Fix sécurité prioritaire : fuite de lecture `ClaimsService` (gap ci-dessus)

Suite à la revue du gap noté au prompt précédent, audit complet du module `claims/` avant
de reprendre les dashboards.

### Constat exact
- `listerReclamations`/`obtenirReclamation` ne scopaient la lecture QUE par `organisationId`
  — **aucun contrôle de rôle** sur `GET /claims/reclamations` et `/:id` (contrairement à
  `soumettre`, qui a `assertGestion`). N'importe quel compte authentifié de l'organisation
  — y compris `SOCIETE_ASSUREE`/`COMPTABLE`/`RECEPTION` — pouvait lister **toutes les
  réclamations de toutes les sociétés clientes** et lire n'importe laquelle par id. Plus
  large que le bug `AdherentService` : là il fallait être un rôle `SOCIETE_AFFILIEE` pour
  fuiter, ici *aucune* restriction de rôle n'existait.
- Vérification demandée sur la RLS comme deuxième ligne de défense potentielle :
  - `postgres` (rôle de connexion NestJS/Prisma) a bien `rolbypassrls = true`, vérifié en
    base (`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`) — **déjà
    documenté** dans ADR-002 (`ARCHITECTURE-DECISIONS.md`), pas une découverte nouvelle.
    RLS ne protège donc rien de ce qui passe par NestJS.
  - **Deuxième trou distinct, celui-là nouveau** : la policy `reclamations_lecture`
    elle-même n'avait aucune restriction de rôle (seulement `organisation_id = …`),
    contrairement au pattern déjà établi ailleurs (`polices_lecture`, `cotisations_lecture`,
    `grilles_tarifaires_lecture` : `sr.entite_code = 'ASSUREUR'` via `profil_a_role()`).
    Corrigé dans `prisma/sql/025_fix_reclamations_rls_role_scope.sql`, appliqué en base
    (`prisma db execute`) et vérifié (`pg_policy` relit `profil_a_role(...)` avec la même
    liste de rôles que côté NestJS). Détail complet en addendum d'ADR-002.

### Correction applicative (`apps/api/src/claims/`)
- `claims.types.ts` : nouvelle constante `ROLES_LECTURE_CLAIMS` = `ROLES_GESTION_CLAIMS`
  (direction, exploitation, informatique) + `ASSUREUR_MEDECIN_CONSEIL` (revue médicale,
  ne soumet jamais mais doit pouvoir consulter une réclamation `REVUE_MANUELLE`).
- `claims.service.ts` : nouvelle méthode `assertLecture()`, appelée en tête de
  `listerReclamations` et `obtenirReclamation`. `validerManuellement` inchangé (son propre
  contrôle de rôle par type de réclamation était déjà correct).
- **Aucun rôle SOCIETE_*** dans `ROLES_LECTURE_CLAIMS` : `reclamations` n'a pas de colonne
  société/souscripteur directe (`police_id`/`adherent_id` seulement) — tant que ce scoping
  n'est pas construit (jointure `police_id → polices.souscripteur_id`), la lecture reste
  fermée à ce périmètre plutôt que mal scopée. **Dette explicitement différée, pas
  oubliée** — à faire dans le même prompt dédié que le gap ci-dessus, avant d'exposer une
  vue réclamations à un rôle SOCIETE_*.
- 4 tests ajoutés à `claims.service.spec.ts` (nouveau describe dédié) : rôle non habilité
  refusé sur liste ET sur lecture par id (`ForbiddenException`, prisma jamais appelé — pas
  de fuite même partielle), rôle habilité (`ASSUREUR_EXPLOITATION`) et médecin-conseil
  toujours fonctionnels. Suite complète : **20/20 suites, 174/174 tests verts**.

### Test — HTTP réel (2 comptes éphémères : `SOCIETE_ASSUREE`, `ASSUREUR_EXPLOITATION`)
Comptes créés via l'API Admin Supabase (`auth.users` + `profils` insérés directement),
connexion réelle (`grant_type=password`) pour obtenir un jeton, appels HTTP réels contre
l'API NestJS locale (redémarrée pour charger le correctif — la précédente instance,
lancée avant l'édition, ne l'avait pas rechargé malgré `--watch` ; premier essai refait
après redémarrage) :
- `SOCIETE_ASSUREE` → `GET /claims/reclamations` : **403**. `GET /claims/reclamations/:id`
  (id arbitraire) : **403**.
- `ASSUREUR_EXPLOITATION` → `GET /claims/reclamations` : **200**. `GET
  /claims/reclamations/:id` (id inexistant) : **404** (rôle autorisé, ressource absente —
  confirme que le rôle légitime n'est pas régressé).
Comptes éphémères (auth + profils) supprimés après test.

### Commit
Correctif de sécurité isolé dans son propre commit, séparé de toute autre tâche.
