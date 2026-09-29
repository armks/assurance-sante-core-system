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

---

## 2026-09-11 — Dashboard adhérent (`/dashboard-adherent`) complet + audit de scoping

Avant de brancher le frontend, audit de chaque endpoint que le dashboard adhérent allait
consommer, avec la même rigueur que le fix `reclamations/` ci-dessus. Trois failles réelles
de la même famille trouvées et corrigées, **chacune dans son propre commit**, avant tout
code frontend.

### Faille 1 — `member/` : fuite inter-adhérent (PII complète)
`GET /member/adherents/:id`, `GET /member/adherents` et `POST /member/adherents/:id/carte`
ne scopaient que par `organisationId` (+ le cas `SOCIETE_AFFILIEE`) — **aucune branche pour
l'entité `ADHERENT`**. Un adhérent authentifié appelant ces routes avec l'ID d'un AUTRE
adhérent de l'organisation obtenait nom, prénom, date de naissance, IBAN/RIB, banque,
bénéficiaires, police — et pouvait générer la carte de n'importe qui. `listerAdherents`
sans filtre renvoyait le fichier complet des membres à un simple adhérent.
Corrigé : `ContexteAppelant` porte `adherentId` ; 404 anti-énumération (même pattern que
`SOCIETE_AFFILIEE`) si l'appelant est `ADHERENT` et que l'id n'est pas le sien ;
`listerAdherents` scope la liste au seul id propre ; `assertGestion` (cartes) accepte un
`estPropreCarte` permettant l'auto-génération sans toucher au périmètre ASSUREUR/société.
7 tests ajoutés. Commit `fix(member): fuite inter-adherent sur obtenirAdherent/...`.

### Faille 2 — `claims/` : "Mes réclamations" était impossible pour un adhérent
Le fix du 2026-09-11 précédent (`ROLES_LECTURE_CLAIMS`) avait fermé la lecture des
réclamations au seul personnel ASSUREUR — dette explicitement notée pour un rôle ADHERENT.
`reclamations.adherentId` existe : `modeLecture()` remplace `assertLecture()` — staff
habilité → scope organisation (inchangé) ; rôle ADHERENT avec `adherentId` → scope strict
sur `adherentId` (liste ET lecture par id) ; sinon 403. Flux ASSUREUR (`soumettre`,
`validerManuellement`) non touché (mode `STAFF` par défaut). 5 tests ajoutés. Commit
`fix(claims): lecture des reclamations scopee adherent`.

### Faille 3 — `preauthorization/obtenirFacture` : fuite financière
`GET /preauthorization/factures/:id` ne vérifiait que `organisationId` ; seul le code de
facturation était masqué au non-propriétaire — montants, `adherentId`, `etablissementId`,
statut étaient renvoyés à n'importe quel compte de l'organisation. Endpoint non encore
consommé côté frontend, corrigé sans rien casser : adhérent propriétaire OU personnel
`ROLES_GENERATION_FACTURE` (scopé à son établissement pour le centre médical) ; sinon 403.
5 tests ajoutés. Commit `fix(preauthorization): fuite inter-adherent sur obtenirFacture`.

Après les 3 correctifs : **20/20 suites, 188/188 tests verts**, `tsc --noEmit` propre (API).
Vérifiés endpoints déjà corrects, non touchés : `genererCodeConsultation`/`listerMesCodes`/
`confirmerPresence`/`annulerCode`, `listerMesCodesOrdonnance`, `listerMesFactures`,
`validerCodeFacturation` (tous scopés sur `ctx.adherentId` dérivé du token) ; `plan/produits`
et `provider/etablissements` (lecture ouverte **intentionnelle**, catalogue produit/réseau
de soins — pas des données personnelles).

### Test HTTP réel des 3 correctifs (avant commit)
API locale + Supabase réel. Adhérent de référence `armelk01+adherent@gmail.com`
(`ADHERENT_TITULAIRE`, adhérent « Konan Adjoua ») + 1 compte adhérent éphémère (« Traore
Awa ») créé/supprimé pour le test — **9/9** : lecture propre → 200 ; ID direct d'un autre
adhérent → 404 dans les deux sens ; liste → ne voit que soi-même ; génération de carte
propre → 200 avec URL Storage signée réelle ; carte d'un autre → 404 ; liste des
réclamations → 200 pour chacun (fini le 403 systématique) ; facture inexistante → 404 (pas
de 500). Compte éphémère + son profil supprimés après test.

### Frontend — 6 écrans (`apps/web/app/dashboard-adherent/`)
Conventions `health-insurance-core-ui` (`page.tsx` serveur / `*-ecran.tsx` client /
`actions.ts`), patterns `DataTable`/`StatutBadge`/`FormulaireModal`/`CarteResume`/
`GrilleCartes` réemployés, aucun redéveloppement :
1. **Vue d'ensemble** (`page.tsx`) : police/produit/garanties (repris du rendu
   `assuree-ecran.tsx`) + plafond restant dérivé du `remboursement.plafondRestantApres` de
   la réclamation la plus récente + compteur de réclamations en cours.
2. **Consultation** : sélection établissement (`GET provider/etablissements?statut=ACTIF`)
   → `POST codes-consultation` → code affiché en gros caractères dans une bannière
   ("à transmettre ORALEMENT à l'accueil") + liste des codes avec annulation tant que
   `EMIS`.
3. **Ordonnances** : `GET codes-ordonnance`, code visible uniquement tant que
   `EMIS`/`PRESENTE_PHARMACIE`.
4. **Factures** : `GET codes-facturation`, bouton « Valider le code » par ligne tant que
   `codeValideParPatient` est faux → `POST codes-facturation/valider`.
5. **Réclamations** : `GET claims/reclamations` (désormais scopé adhérent grâce au fix
   2), statut + décision + montant remboursé.
6. **Ma carte** : bouton « Générer ma carte » → `POST member/adherents/:id/carte` (id =
   propre `adherentId`, jamais saisi) → QR + lien PDF signé.
`lib/dashboard-nav.ts` : entrée `/dashboard-adherent` (6 items). `lib/identity.ts` inchangé
— utilise `permissions.scope.adherentId` déjà exposé (convention déjà en place, cf.
`dashboard-centre-medical/accueil/page.tsx`). Petit ajout non-sécuritaire : `produit.id`
ajouté au `select` Prisma de `chargerAdherent` (nécessaire pour enchaîner sur
`GET plan/produits/:id`, absent jusqu'ici de la réponse). `next build` : les 6 routes
compilent, `tsc --noEmit` propre.

### Test — navigateur réel (session `@supabase/ssr`, cookie jar, serveurs `next start`
`:3000` + API `:3001`)
Adhérent de référence `armelk01+adherent@gmail.com`, connexion réelle (mot de passe),
cookies de session réels :
- **Parcours "Demander une consultation" complet et réel** (1 clinique de test créée pour
  l'occasion) : établissement listé → `POST codes-consultation` → code généré (201) → le
  code apparaît dans `GET codes-consultation` (statut `EMIS`) → annulation → statut
  `ANNULE`. **7/7**.
- **Rendu réel des 6 pages** avec la session cookie (200 partout ; vue d'ensemble affiche
  bien `POL-2026-000004` ; consultation affiche le formulaire ; carte affiche le bouton de
  génération) + `/dashboard` redirige bien (307) vers `/dashboard-adherent`
  (`dashboardRoute` du rôle). **7/7**.
- Aucune route `[id]` n'existe sur ce dashboard (toutes les pages utilisent
  `permissions.scope.adherentId` du compte connecté, jamais un paramètre d'URL) — pas de
  surface de navigation permettant à un adhérent de tenter l'URL d'un autre.
- **Limite assumée** : les écrans Ordonnances/Factures/Réclamations sont vérifiés à l'état
  vide (aucune ordonnance/facture/réclamation réelle n'existait en base) — leur scoping
  précis par `adherentId` est couvert par les tests unitaires (Prisma mocké, assertions sur
  le `where`) et par le test HTTP réel de la Faille 2/3 ci-dessus, pas par une chaîne
  complète dossier→ticket→facture→réclamation reconstruite ici (aurait exigé de provisionner
  4 rôles supplémentaires — hors périmètre de ce prompt).
Établissement de test + code de consultation supprimés, serveurs arrêtés. Base revenue à
l'état de référence (0 établissement, 0 code, 0 réclamation, seul le profil adhérent de
référence persiste).

### 🎯 Jalon — dashboard adhérent disponible en UI, 3 failles de scoping fermées

---

## 2026-09-11 (suite) — Les 6 écrans du dashboard adhérent testés avec des données réelles

La vérification précédente laissait Ordonnances/Factures/Réclamations testées à l'état
vide seulement (aucune donnée réelle en base). Fermeture de ce gap : un épisode de soins
réel et complet a été fabriqué en utilisant le parcours établissement déjà construit et
testé (Phase 6), puis les 3 écrans relus avec la session réelle de l'adhérent de référence.

### Parcours réel exécuté (API locale + Supabase réel, aucune donnée simulée)
1 clinique de test + 4 comptes éphémères (`CENTRE_MEDICAL_ACCUEIL`/`_MEDECIN`
`numero_ordre_medecin` renseigné/`_COMPTABLE`, `ASSUREUR_EXPLOITATION`) + l'adhérent de
référence `armelk01+adherent@gmail.com` :
1. adhérent → `POST codes-consultation` → code généré ;
2. accueil → `POST codes-consultation/valider` → dossier ouvert + ticket créé
   automatiquement (numéro de traitement généré) ;
3. médecin → `POST care-episode/dossiers/:id/consultations` (consultation) →
   `POST tickets-soins/:id/actes` (acte CONSULTATION, 15 000 F) →
   `POST ordonnances` (1 ligne, Paracétamol — code **non renvoyé** au médecin) →
   `POST care-episode/dossiers/:id/cloturer` → dossier + ticket `CLOTURE` ;
4. comptable centre médical → `POST tickets-soins/:id/facture` → `EMISE`,
   15 000 / 12 000 assurance / 3 000 patient, code **non renvoyé** à l'établissement ;
5. adhérent → voit la facture avec son code (`GET codes-facturation`) → le valide
   (`POST codes-facturation/valider`) → `VALIDEE` ;
6. `ASSUREUR_EXPLOITATION` → `POST claims/reclamations/soumettre` (l'acte ci-dessus).

**Limite assumée et documentée** : le microservice Java d'adjudication n'est pas
démarrable dans cet environnement (aucun binaire Maven disponible, ni `mvn` ni wrapper
`mvnw` — recherché via `where.exe` et les emplacements standards, sans résultat, bien que
`~/.m2/repository` existe d'un usage antérieur sur cette machine). La soumission a donc
été faite **pour de vrai** contre l'API réelle plutôt que simulée : réponse **503** réelle
(microservice injoignable), et la réclamation reste réellement `SOUMISE` en base
(`codes_rejet: ['ADJ_ECHEC']`) — donnée réelle et vérifiable, simplement sans décision
d'adjudication complète (pas de `AUTO_ADJUDIQUE`/montant remboursé). Aucune ligne
`reclamations`/`remboursements` n'a été insérée à la main pour simuler un résultat que le
système n'a pas réellement produit.

### Vérification — HTTP réel (17/17) puis rendu réel des pages (3/3)
Avec la session de l'adhérent de référence (reconnexion réelle) :
- `GET codes-ordonnance` → l'ordonnance réelle apparaît (statut `EMIS`, code visible) ;
- `GET codes-facturation` → la facture réelle apparaît (`VALIDEE`) ;
- `GET claims/reclamations` → la réclamation réelle apparaît (`SOUMISE`), `adherentId`
  correct.
Puis rendu réel des 3 pages Next.js (`next build` + `next start`, session cookie
`@supabase/ssr`, comme pour le test du dashboard) : les 3 écrans affichent bien le contenu
réel (plus le message d'état vide) — code d'ordonnance « Émis », facture 15 000 F
« Validée », réclamation 15 000 F « Consultation » / « Soumise ».

### Nettoyage
Réclamation, facture, ordonnance + son code, acte, ticket, code de consultation,
consultation, dossier de soins, établissement de test et les 4 comptes éphémères (auth +
profils) supprimés (ordre FK respecté). Un oubli intermédiaire (une 1ʳᵉ itération du script
avait été laissée volontairement en place le temps du test de rendu, puis une 2ᵉ itération
lancée par erreur avant son nettoyage) a été repéré et corrigé : état final vérifié à 0 sur
tous les compteurs (établissements, dossiers, réclamations, factures, profils centre
médical/assureur éphémères). Seul le profil adhérent de référence (`armelk01+adherent@gmail.com`,
adhérent « Konan Adjoua ») subsiste, comme prévu.

### 🎯 Jalon — les 6 écrans du dashboard adhérent sont désormais tous vérifiés avec des
données réelles (plus seulement à l'état vide pour Ordonnances/Factures/Réclamations)

---

## 2026-09-11 (suite) — `/dashboard-centre-medical/administratif` : écran réel + fix sécurité care-episode

`CENTRE_MEDICAL_ADMINISTRATIF` atterrissait sur une simple redirection vers `/accueil`
sans contenu propre (identifié lors d'un audit). Avant de construire l'écran, audit précis
de ce que ce rôle peut réellement appeler côté API (comme demandé) — deux failles de la
même famille que celles corrigées plus tôt aujourd'hui ont été trouvées et corrigées en
premier.

### Audit des droits réels de CENTRE_MEDICAL_ADMINISTRATIF
- `ROLES_GESTION_DOSSIER` (care-episode) : valider un code de consultation (ouvre le
  dossier), ajouter une consultation, clôturer normalement — **pas** la clôture forcée
  (réservée à `ASSUREUR_EXPLOITATION`).
- `ROLES_AJOUT_ACTE` / `creerOrdonnance` (preauthorization) : ajouter un acte, établir une
  ordonnance pour le compte du médecin de la consultation.
- `ROLES_GENERATION_FACTURE` : générer la facture d'un ticket clôturé de **son propre**
  établissement ; lire une facture (code masqué, comme le personnel non-adhérent).
- `ROLES_GESTION_RESEAU` (provider) = `ASSUREUR_INFORMATIQUE` **seul** : ce rôle n'a
  **aucun** droit d'écriture sur son établissement (nom, horaires, garde weekend, statut)
  — uniquement lecture, comme tout le monde dans l'organisation. L'hypothèse de contenu du
  prompt (« gestion administrative de l'établissement ») est donc **exclue** en écriture
  de l'écran — vérifié par un vrai `PATCH` → 403 avant de conclure.
- Toutes ces actions vivent déjà dans les écrans partagés `/accueil`, `/medecin`,
  `/comptable` (nav commune aux 4 sous-rôles) — les reconstruire ici aurait dupliqué du
  code déjà correctement scopé par rôle. La page ne duplique donc rien : elle affiche ce
  que ce rôle ne trouve nulle part ailleurs (vue d'ensemble propre).

### Fix sécurité découvert en auditant ce même périmètre (`care-episode/`)
1. **Lecture** (`GET /care-episode/dossiers`, `/:id`) : ne vérifiait QUE `organisationId`
   — aucun rôle, aucun établissement. N'importe quel compte authentifié de l'organisation
   (adhérent, pharmacie, centre médical d'un AUTRE établissement…) pouvait lire n'importe
   quel dossier de soins (diagnostic, motif — données de santé).
2. **Écriture** (`ajouterConsultation`, `clotureNormale`) : vérifiait l'établissement du
   MÉDECIN référencé, jamais celui de l'APPELANT — un compte `CENTRE_MEDICAL_*` de
   n'importe quel établissement du réseau pouvait clôturer ou modifier le dossier d'un
   AUTRE établissement.

Corrigé : `ContexteAppelant` porte `etablissementId` ; `modeLectureDossiers()` (staff
ASSUREUR habilité → toute l'organisation, personnel CENTRE_MEDICAL → son établissement
seul, sinon 403) ; `assertEtablissementDossier()` ajoute le contrôle manquant sur
l'appelant. 8 tests ajoutés (+ 2 existants adaptés). Suite complète : **20/20 suites,
196/196 tests verts**, `tsc --noEmit` propre. Testé en HTTP réel (2 établissements +
3 comptes éphémères) : cross-établissement refusé partout (403 écriture, 404 lecture,
absent de la liste), staff ASSUREUR voit tout, le bon établissement fonctionne
normalement — **9/9**. Dette différée et documentée (hors périmètre) :
`validerCodeConsultation` ne vérifie pas que l'établissement APPELANT correspond à
`code.etablissementId` — trouvé en auditant le même périmètre, dans un autre module,
à traiter dans un prompt dédié. Commit séparé
(`fix(care-episode): fuite inter-etablissement sur les dossiers de soins`).

### Écran (`app/dashboard-centre-medical/administratif/`)
`page.tsx` (server) + `administratif-ecran.tsx` (client, patterns réemployés) :
- Carte établissement (nom, type, ville, statut, garde weekend) — **lecture seule**,
  mention explicite « informations gérées par l'assureur… lecture seule pour ce rôle ».
- `GrilleCartes` : dossiers ouverts / clôturés / total de l'établissement (scope désormais
  garanti côté API par le fix ci-dessus).
- `DataTable` des dossiers de l'établissement avec lien « Ouvrir » vers le détail partagé
  `/medecin/[id]` (aucune duplication de la vue détail ni des actions).

### Test — navigateur réel (établissement + compte `CENTRE_MEDICAL_ADMINISTRATIF`
éphémères, adhérent de référence)
HTTP réel (6/6) : lecture établissement OK, **écriture établissement → 403** (confirme
l'exclusion de la fonctionnalité avant de construire l'écran), dossier ouvert via ce rôle
apparaît dans sa propre liste, clôture forcée → 403. Rendu réel de la page avec session
cookie (7/7) : `/dashboard` redirige bien vers `/dashboard-centre-medical/administratif` ;
la page n'est plus une redirection vide — nom de l'établissement, badge « Garde le
week-end », le dossier réel (statut Ouvert) et la mention lecture seule s'affichent tous
réellement. Données et compte éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — les 4 sous-rôles CENTRE_MEDICAL ont chacun un espace réel ; le module
care-episode est désormais scopé par établissement comme le reste de l'application

---

## 2026-09-11 (suite) — Dette du prompt précédent traitée : `validerCodeConsultation` fermé

Le commit `fix(care-episode)` précédent notait explicitement une dette : *« validerCodeConsultation
ne vérifie pas que l'établissement APPELANT correspond à code.etablissementId »*. Demande
explicite de reproduire d'abord le test exact du PROMPT 18 pour vérifier si c'est
exploitable aujourd'hui, avant de corriger.

### Reproduction du test du PROMPT 18 — résultat HTTP exact
2 établissements ACTIF éphémères (A, B) + 1 compte `CENTRE_MEDICAL_ACCUEIL` éphémère
rattaché à **B** + l'adhérent de référence :
1. `POST /preauthorization/codes-consultation` (adhérent, `etablissementId: A`) → **201**,
   code émis pour A.
2. `POST /preauthorization/codes-consultation/valider` avec le compte de **B**,
   `dto.etablissementId: A` (le bon établissement, celui du code) → **201 — VULNÉRABLE**.
   Le dossier s'ouvre, attribué à l'établissement A (`dossier.etablissementId = A`), alors
   que c'est un compte de B qui l'a réellement validé.

Confirmé exploitable tel quel.

### Pourquoi le test du PROMPT 18 n'a pas détecté ça — régression ou angle mort ?
**Angle mort du test d'origine, pas une régression.** Vérifié en relisant le commit
`c5c2cd8` (PROMPT 18) :
- Le `ContexteAppelant` de `preauthorization.service.ts` à ce commit ne portait **pas**
  `etablissementId` du tout (`{ userId, organisationId, role, adherentId, roleChain }`) —
  il était donc **structurellement impossible** d'écrire cette vérification à ce moment-là,
  le champ n'était même pas chargé.
- Le test « mauvais établissement → 403 » du PROMPT 18 utilisait **un seul compte
  `CENTRE_MEDICAL_ACCUEIL`** testé contre **2 établissements en fixtures**, en faisant
  varier `dto.etablissementId` dans le corps de la requête — pas deux comptes réels
  affiliés chacun à un établissement différent. Il vérifiait donc bien
  `code.etablissementId !== dto.etablissementId` (cohérence interne de la requête), mais ne
  pouvait pas détecter qu'un compte d'un AUTRE établissement, indiquant le BON
  `etablissementId` dans le corps, passerait quand même — ce n'est pas ce qu'il testait.
- `etablissementId` a été ajouté au `ContexteAppelant` de ce fichier au commit `85e10bd`
  (**PROMPT 19**, un prompt plus tard), pour les besoins de `creerOrdonnance` (vérifier que
  le médecin/administratif appartient à l'établissement de la consultation). Le pattern
  « vérifier l'établissement de l'APPELANT » est né à ce moment précis — mais n'a jamais
  été reporté sur `validerCodeConsultation`, écrite au prompt précédent et non retouchée
  depuis. Chaque prompt a audité le périmètre de sa propre fonctionnalité, pas
  rétroactivement les endpoints déjà livrés.

### Correctif (`preauthorization.service.ts`)
Ajout, juste après le contrôle existant `code.etablissementId !== dto.etablissementId`,
d'un contrôle sur l'appelant — même pattern que `assertEtablissementDossier`
(care-episode) et `genererFacture`/`ajouterActe`/`obtenirFacture` (même fichier) :
personnel `CENTRE_MEDICAL_*` scopé à son établissement propre ; `ASSUREUR_EXPLOITATION`/
`ASSUREUR_INFORMATIQUE` non scopés (organisation entière, cohérent avec leur rôle de
supervision transverse ailleurs dans le même fichier).

2 tests ajoutés (+ les tests existants adaptés pour préciser l'établissement du contexte,
sans quoi le test « VALIDATION OK » aurait désormais échoué) : établissement B refusé même
avec le bon `dto.etablissementId` (403, `ouvrirDossier` jamais appelé) ; `ASSUREUR_EXPLOITATION`
sans établissement propre reste non scopé (non-régression). Suite complète : **20/20
suites, 198/198 tests verts**, `tsc --noEmit` propre.

### Nouveau test HTTP réel — mêmes établissements, même scénario, après correctif
Rejoué exactement le même script (mêmes 2 établissements re-créés, même compte
`CENTRE_MEDICAL_ACCUEIL` de B, même code généré pour A) : étape 2 → **403**
`"Vous n'appartenez pas à l'établissement pour lequel ce code a été émis."` Donnée et
comptes éphémères supprimés, serveur arrêté.

### Commit
Correctif de sécurité isolé dans son propre commit, séparé de toute autre tâche — comme
demandé.

### 🎯 Jalon — les 4 codes anti-fraude (v8) ont chacun leur scoping d'établissement vérifié
et testé en HTTP réel ; plus aucune dette de sécurité connue et non documentée sur le
parcours de soins côté établissement

---

## 2026-09-11 (suite) — Audit du même angle mort sur les 3 autres mécanismes anti-fraude

Demande explicite de vérifier si le même angle mort que `validerCodeConsultation`
(vérifier l'identité RÉELLE de l'appelant, pas seulement la cohérence interne du corps de
la requête) existe sur `validerCodeOrdonnance`, la clôture d'un ticket de soins, et
`confirmerPaiement`. Verdict pour chacun, avec la vérification empirique demandée :

### 1. `validerCodeOrdonnance` / `marquerDispensation` — DÉJÀ CORRECT
`assertPharmacie(ctx, dto.pharmacieId)` compare `ctx.pharmacieId` (chargé depuis le profil
réel de l'appelant, `contexteAppelant()`) à `dto.pharmacieId` — c'est bien une vérification
d'identité, pas seulement de cohérence de la requête. `marquerDispensation` va plus loin :
il compare directement `code.pharmacieUtilisatriceId !== ctx.pharmacieId`, sans même passer
par un champ du corps de la requête. Aucune dépendance à une valeur fournie par le client
pour établir l'identité de la pharmacie appelante.

**Vérifié en HTTP réel** (2 pharmacies + 1 établissement + accueil/médecin/2 pharmaciens
éphémères, ordonnance réelle générée via consultation → acte → ordonnance) — 9/9 :
Pharmacie B tente de valider en indiquant `pharmacieId: A` (usurpation) → **403** "Vous ne
pouvez agir que pour votre propre pharmacie" (avant même toute lecture du code) ;
Pharmacie A valide légitimement → 201, contenu révélé ; Pharmacie B retente ensuite
honnêtement (`pharmacieId: B`) → 403 "déjà prise en charge par une autre pharmacie" ;
Pharmacie B tente la dispensation du code de A → 403. **Aucun correctif nécessaire.**

### 2. Clôture d'un ticket de soins — DÉJÀ CORRIGÉ (fix care-episode de ce même jour)
Un ticket ne change JAMAIS de statut CLOTURE ailleurs que dans
`CareEpisodeService.appliquerCloture`, appelée uniquement par `clotureNormale` (rôles
CENTRE_MEDICAL_* + ASSUREUR_EXPLOITATION/INFORMATIQUE) et `clotureForcee` (réservée à
ASSUREUR_EXPLOITATION seul — aucun rôle CENTRE_MEDICAL possible, donc aucune identité
d'établissement à usurper sur cette voie). `clotureNormale` est exactement la méthode
corrigée par `assertEtablissementDossier()` dans le commit
`fix(care-episode): fuite inter-etablissement sur les dossiers de soins` de ce même jour —
9/9 en HTTP réel déjà obtenu à ce moment-là (2 établissements, cross-établissement refusé
en écriture y compris pour la clôture). **Rien à corriger de plus ici** — c'est le même
mécanisme, déjà traité.

### 3. `confirmerPaiement` (factures) — DÉJÀ CORRECT, pas d'angle mort analogue possible
Vérifie `ctx.roleChain.includes('ASSUREUR_COMPTABLE')` puis scope la facture par
`organisationId`. Contrairement à `CENTRE_MEDICAL_*` (`etablissement_id`) et `PHARMACIE_*`
(`pharmacie_id`), le schéma **n'a aucune colonne d'affiliation** pour les rôles
`ASSUREUR_*` (`profils.societe_id` est réservé aux rôles `SOCIETE_AFFILIEE`,
`profils.etablissement_id`/`pharmacie_id` n'ont pas de sens pour un comptable de
l'assureur). Il n'existe donc pas de dimension d'identité analogue à usurper — le rôle
`ASSUREUR_COMPTABLE` est, par construction du schéma, un rôle transverse à toute
l'organisation (même famille que `ASSUREUR_EXPLOITATION`/`INFORMATIQUE` ailleurs dans ce
même fichier). Un scénario « deux comptables réels, tentative croisée » n'a pas
d'équivalent ici : il n'y a qu'une seule organisation, pas de sous-périmètre à croiser.
Couverture déjà existante : test unitaire « rôle ≠ ASSUREUR_COMPTABLE → 403 » + la garde
anti-fraude bloquante `codeValideParPatient`. **Aucun correctif nécessaire.**

### Conclusion
Sur les 4 mécanismes anti-fraude (codes consultation/ordonnance/ticket/facturation),
**seul `validerCodeConsultation` présentait l'angle mort** (corrigé dans le commit
précédent) — les 3 autres avaient déjà, chacun dans son domaine, le bon réflexe de
comparer l'identité réelle de l'appelant (`ctx.pharmacieId`/`ctx.etablissementId`) plutôt
que de faire confiance à un champ du corps de la requête. Aucun nouveau commit de
correctif requis pour ce prompt — audit et vérification HTTP réelle seuls.

---

## 2026-09-11 (suite) — Dashboards pharmacie : `/pharmacien`, `/caissiere`, `/comptable`

Audit préalable (même rigueur que les modules précédents) avant toute construction.

### Constats de l'audit
- **`validerCodeOrdonnance` / `marquerDispensation`** : déjà vérifiés lors du prompt
  précédent — `ctx.pharmacieId` (identité réelle) comparé, jamais un simple champ de
  requête. Aucun correctif nécessaire.
- **`ROLES_PHARMACIE`** (préauthorisation) **ne distingue PAS** `PHARMACIE_PHARMACIEN`,
  `PHARMACIE_CAISSIERE` et `PHARMACIE_COMPTABLE` sur ces deux endpoints : les 3 rôles ont
  aujourd'hui des droits API identiques pour valider un code et marquer une dispensation.
  `peutValider` (vrai seulement pour le pharmacien dans `sous_roles`) ne gate aucun de ces
  2 endpoints côté API — c'est un indicateur d'affichage général, pas une restriction
  technique ici. Conséquence directe sur la construction : l'écran caissière **inclut**
  la dispensation (l'API ne la lui refuse pas — vérifié par un vrai `POST`
  `.../dispensation` → 201 avec un compte caissière), conformément à la consigne
  « retirée SI l'API ne l'autorise pas ».
- **Gap n°1 — pas de stock (v1 §13.4 introuvable)** : aucune table de stock/inventaire de
  pharmacie n'existe dans le schéma. `medicaments` (module `reference/`) est un
  **référentiel national partagé** (dénomination, taux/plafond de remboursement,
  homologation) — pas une gestion de quantités disponibles par pharmacie. Noté comme gap,
  aucune table improvisée. La page « Médicaments remboursables » du pharmacien affiche ce
  référentiel en lecture seule, explicitement présenté comme tel (pas un « stock »).
- **Gap n°2 — pas de facturation pharmacie** : aucune colonne `pharmacie_id` sur une
  quelconque table de facture/paiement (`FactureDossier` est scopée `etablissement_id`,
  côté centre médical uniquement). L'écran comptable est donc un **suivi en lecture seule
  des dispensations** de sa pharmacie, explicitement noté comme tel (pas de « facturation »
  puisqu'aucune brique de facturation-pharmacie n'existe).
- **Gap n°3 — aucun endpoint de lecture côté pharmacie n'existait** : `GET
  /preauthorization/codes-ordonnance` est exclusivement le point de vue ADHÉRENT
  (`ctx.adherentId`). Sans un endpoint de lecture scopé pharmacie, aucune « vue
  d'ensemble » n'était constructible. Ajout nécessaire, pas une amélioration
  optionnelle — détaillé ci-dessous.

### Backend — nouvel endpoint `GET /preauthorization/codes-ordonnance/pharmacie`
`PreauthorizationService.listerCodesOrdonnancePharmacie()` : scope strict et exclusif sur
`ctx.pharmacieId` (jamais un paramètre client), réservé à `ROLES_PHARMACIE`. Renvoie les
codes déjà pris en charge par la pharmacie de l'appelant (statut + `ordonnance.lignes`,
déjà révélés à cette pharmacie lors de la validation — aucune fuite nouvelle). 3 tests
ajoutés. Suite complète : **20/20 suites, 201/201 tests verts**, `tsc --noEmit` propre.

### Frontend (`apps/web/app/dashboard-pharmacie/`)
- `layout.tsx` : garde entité `PHARMACIE` + `permissions.scope.pharmacieId` requis. Pas
  de nav commune façon centre médical : chaque rôle garde sa propre `dashboardRoute`
  (pharmacien et caissière ont cependant le même écran de fonction, cf. audit ci-dessus).
- `/pharmacien` + `/caissiere` (`DispensationEcran` partagé) : `GrilleCartes` (en
  attente / dispensées / total), formulaire de validation de code (révèle le contenu,
  banni­ère de confirmation), action « Marquer comme dispensée » (partielle/complète) par
  ligne en attente.
- `/pharmacien/medicaments` (`MedicamentsEcran`) : référentiel national des médicaments
  homologués, lecture seule, mention explicite que ce n'est pas un stock.
- `/comptable` (`ComptableEcran`) : suivi en lecture seule des dispensations, mention
  explicite de l'absence de module de facturation.
- `lib/dashboard-nav.ts` : 3 nouvelles entrées (`/dashboard-pharmacie/pharmacien`,
  `/caissiere`, `/comptable`).

### Test — HTTP réel (2 pharmacies + établissement + 6 comptes éphémères, ordonnance
réelle) — 11/11
Pharmacien A valide un code réel (201) → apparaît dans la liste de la pharmacie A,
**absent de la liste de la pharmacie B** (isolation confirmée sur le nouvel endpoint) ;
caissière A voit la même ordonnance (même pharmacie) et **peut réellement marquer la
dispensation** (201, droit confirmé plutôt que supposé) ; comptable A voit la dispensation
en lecture ; un adhérent ne peut pas appeler ce nouvel endpoint (403).

### Test — navigateur réel (session cookie, 4 comptes : pharmacien A, caissière A,
comptable A, pharmacien B) — 9/9
Pharmacien A : vue d'ensemble affiche l'ordonnance dispensée (« Paracétamol »,
« Dispensée entièrement ») + page médicaments accessible. Caissière A : voit la même
ordonnance, bouton « Valider un code » présent. Comptable A : voit la dispensation,
mention de l'absence de facturation affichée. **Pharmacien B (autre pharmacie) : 200 mais
NE VOIT PAS l'ordonnance de la pharmacie A** — état vide affiché, isolation cross-pharmacie
confirmée côté UI en conditions réelles. Données et 6 comptes éphémères supprimés,
serveurs arrêtés.

### 🎯 Jalon — les 3 sous-rôles PHARMACIE ont chacun un espace réel, scopé par pharmacie
et vérifié en HTTP réel comme en navigateur réel ; 3 gaps documentés (stock, facturation,
lecture pharmacie) plutôt qu'improvisés

---

## 2026-09-11 (suite) — `ASSUREUR_EXPLOITATION` / `ASSUREUR_EXPLOITATION_CONJOINTE`

Aucun changement backend ce prompt — audit complet des droits API déjà existants,
uniquement du frontend (nouvelle vue d'ensemble + extension d'une allowlist déjà en place).

### Audit des droits réels d'ASSUREUR_EXPLOITATION (avant tout lien de nav)
Vérifié module par module (grep + lecture des listes de rôles) :
- **Souscripteurs** (`ROLES_GESTION_SOUSCRIPTEUR`), **Polices** (`ROLES_GESTION_POLICE`),
  **Adhérents** (`ROLES_GESTION_MEMBRE`), **Réclamations** (`ROLES_GESTION_CLAIMS` +
  `ROLES_LECTURE_CLAIMS` + `ROLE_REVUE_FINANCIERE` pour la revue manuelle non-médicale) :
  droits **identiques à `ASSUREUR_DIRECTION`** sur ces 4 modules — confirmé par lecture
  directe des constantes, pas supposé.
- **Produits** (`ROLES_GESTION_PRODUIT` = DIRECTION + INFORMATIQUE), **Cotisations**
  (`ROLES_GESTION_COTISATION` = COMPTABLE + INFORMATIQUE), **Réseau de soins**
  (`ROLES_GESTION_RESEAU` = INFORMATIQUE seul) : **exploitation exclue de l'écriture**.
  Or ces 3 écrans (`produits/page.tsx`, `cotisations/page.tsx`, `etablissements/page.tsx`,
  `pharmacies/page.tsx`) **n'ont aucun contrôle de rôle côté frontend** — ils affichent
  systématiquement les actions d'écriture, en confiance totale dans l'API. Les y exposer
  en lecture à l'exploitation afficherait des boutons qui échoueraient en 403. **Non liés
  dans sa navigation**, exactement comme `ASSUREUR_DIRECTION` les exclut déjà pour la
  même raison (le commentaire du layout `informatique/` le documentait déjà pour
  direction — étendu ici pour exploitation).
- **Dossiers de soins / tickets / clôture forcée** (care-episode, préauthorization) :
  droits API réels et complets (`ROLES_GESTION_DOSSIER`, `clotureForcee` même réservée
  À exploitation exclusivement), mais **aucun écran assureur n'existe** pour ce
  domaine — la seule UI est `/dashboard-centre-medical/*`, dont le layout redirige
  toute entité ≠ `CENTRE_MEDICAL`. Constat noté, aucun nouvel écran construit (hors
  périmètre : « écrans déjà existants »).
- **Tarification individuelle** (`ROLES_TARIFICATION_INDIVIDUELLE` inclut exploitation) :
  même constat — l'écran existant (`/dashboard-assureur/medecin-souscripteur/tarifications`)
  est strictement gardé au seul `ASSUREUR_MEDECIN_SOUSCRIPTEUR` (`redirect` si rôle
  différent), plus restrictif que l'API. Non accessible, non lié.

### `ASSUREUR_EXPLOITATION_CONJOINTE` — vérification du double contrôle (v9 §3.3 introuvable)
`roleParentCode = 'ASSUREUR_EXPLOITATION'` (addendum) : la chaîne de rôles
(`identity.service.ts`, remontée par `roleParentCode`) inclut donc littéralement les deux
codes — confirmé par lecture du calcul de `roleChain`, puis par un test HTTP réel (la
conjointe voit exactement les mêmes réclamations que le titulaire). **Recherche explicite
d'un mécanisme de double contrôle** (deuxième validateur obligatoire, colonne
« validateur 2 », etc.) dans tout le schéma et le code métier : **aucun résultat**. Aucune
table, aucune colonne, aucune logique applicative n'implémente un second regard. **Gap
documenté, rien improvisé** : ce rôle a aujourd'hui, en pratique, exactement le même
périmètre fonctionnel que le titulaire — pas un rôle de contre-validation. Mentionné
explicitement dans la description de sa vue d'ensemble et le commentaire de son layout.

### Frontend
- `lib/dashboard-nav.ts` : `navExploitation()` (nouvelle fonction, mêmes 4 écrans que
  `navInformatique` moins Produits/Cotisations/Réseau/Utilisateurs), réutilisée pour les
  2 `dashboardRoute`.
- `app/dashboard-assureur/informatique/layout.tsx` : `ROUTES_ADMIN_ASSUREUR` étendue aux
  2 nouvelles routes (mécanisme déjà en place pour direction/informatique/adjoint —
  aucun nouveau layout de gestion créé, réutilisation de l'existant).
- `app/dashboard-assureur/exploitation(-conjointe)/` : layout (garde propre à la route,
  même pattern que `direction/layout.tsx`) + page (vue d'ensemble). `ExploitationVueEnsemble`
  (composant partagé) : `GrilleCartes` (en revue manuelle / en cours / traitées / rejetées),
  file des réclamations `REVUE_MANUELLE` avec colonne « Traitable par vous » (réutilise
  `peutTraiterRevue` de `lib/reclamations.ts`, déjà utilisé par l'écran de revue existant —
  aucune logique dupliquée), lien vers la file complète + accès rapide aux 4 écrans.

### Test — HTTP réel (établissement + 4 comptes éphémères, épisode réel jusqu'à l'acte)
**12/12.** Réclamation soumise pour de vrai (503, microservice Java indisponible dans ce
sandbox — limite déjà documentée) ; **transition manuelle SOUMISE → REVUE_MANUELLE
appliquée directement en base pour tester le rendu de la file** (pas une décision
d'adjudication simulée — clairement distingué : aucune ligne `remboursements` n'a été
insérée, seul le statut a été changé, à seule fin de vérifier que l'écran affiche
correctement une file non vide). Exploitation et exploitation conjointe voient toutes
deux la réclamation (héritage de rôle confirmé) ; exploitation liste souscripteurs/
polices/adhérents avec succès ; **`POST /plan/produits` → 403 réel**, confirmant que
l'exclusion de Produits de sa navigation n'est pas arbitraire.

### Test — navigateur réel (session cookie, 2 comptes) — 12/12
`/dashboard` redirige chacun vers sa propre vue d'ensemble (jamais celle de l'autre) ;
les deux affichent la réclamation réelle en revue manuelle avec le badge « Traitable par
vous : Oui » (type non-médical) ; les deux accèdent aux 4 écrans partagés (200) ; la page
conjointe affiche explicitement l'absence de mécanisme de double contrôle. Données et
4 comptes éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — `ASSUREUR_EXPLOITATION`/`_CONJOINTE` ont une vue d'ensemble réelle et un
accès de navigation strictement aligné sur leurs droits API réels ; l'absence de double
contrôle est documentée comme gap plutôt que simulée

## 2026-09-11 (suite) — Révision majeure du flux pharmacie : verrou PAR LIGNE, pas par
ordonnance entière (clarification métier)

### Pourquoi
Le verrou posé au PROMPT 19 fermait une ordonnance ENTIÈRE à la première pharmacie qui
validait son code — une seule pharmacie pouvait servir toute la prescription. Clarification
métier reçue : la vraie règle est un verrou **par ligne de médicament**. Des lignes
différentes d'une même ordonnance peuvent être servies dans des pharmacies différentes ;
une même ligne ne peut être servie qu'une seule fois, dans une seule pharmacie. Le
mécanisme `codes_ordonnance`/`validerCodeOrdonnance` du PROMPT 19 (déverrouillage du
contenu par code secret) reste **inchangé** — il continue de protéger la confidentialité
du contenu de l'ordonnance ; c'est la dispensation qui change de granularité.

### Schéma — 4 nouvelles tables (migration `026_pharmacie_dispensation_par_ligne.sql`)
- **`lignes_ordonnance`** — remplace la colonne jsonb `ordonnances.lignes` comme source de
  vérité (migration idempotente des lignes existantes, no-op ici car aucune ordonnance
  n'existait encore). Champs clés : `statut` (`DISPONIBLE`/`SERVIE`),
  `pharmacie_servante_id` (nullable, posé seulement à `SERVIE`), `quantite_servie`.
  Contrainte : `DISPONIBLE` ⇒ `pharmacie_servante_id IS NULL`.
- **`stock_medicaments_pharmacie`** — comble le gap identifié au prompt précédent : chaque
  pharmacie fixe SON PROPRE prix par dénomination de médicament (`prix_pharmacie`,
  `disponible`). Écriture/lecture réservées à `PHARMACIE_PHARMACIEN` de la pharmacie
  propriétaire (ni caissière ni comptable — cohérent avec l'audit précédent qui réservait
  déjà la modification/substitution de médicament au seul pharmacien).
- **`dispensations_pharmacie`** — un cycle EN_PREPARATION → EN_ATTENTE_VALIDATION_PATIENT
  → VALIDEE → PAYEE (ou ANNULEE), `code_confirmation` unique, trigger
  `verifier_dispensation_payable()` bloquant tout passage à PAYEE si l'ancien statut n'est
  pas VALIDEE (même principe que `verifier_facture_reglable()` du PROMPT 21).
- **`lignes_dispensation`** — détail ligne par ligne (prix unitaire, quantité, montant) de
  chaque dispensation.

RLS sur les 4 tables ; `lignes_ordonnance` en lecture ouverte aux 3 rôles PHARMACIE (requis
pour la recherche par carte), `stock_medicaments_pharmacie` fermée au pharmacien seul.

### Nouveau module `pharmacy/` (NestJS)
`rechercherPrescriptionsParCarte` (recherche par `numeroCarte` — PAS un code secret,
c'est la caissière qui cherche, cohérent avec la description métier ; révèle les lignes en
clair, gated uniquement par le rôle pharmacie) · `listerStock`/`definirPrixStock`
(PHARMACIE_PHARMACIEN exclusivement, scopé `ctx.pharmacieId`) · `preparerDispensation`
(vérifie que CHAQUE ligne choisie est `DISPONIBLE`, rejette explicitement les lignes déjà
`SERVIE` avec leur nom, calcule le total depuis le stock de LA pharmacie appelante — jamais
un prix fourni par le client — génère le code, l'envoie au patient, jamais à la pharmacie)
· `listerMesDispensations` (côté adhérent, ne révèle le code que tant que
`EN_ATTENTE_VALIDATION_PATIENT`) · `validerCodeDispensation` (côté adhérent, vérifie que
l'appelant est bien le patient concerné, passe à VALIDEE — pas encore payée)
· `confirmerPaiementDispensation` (**garde bloquante explicite** : refuse si statut ≠
VALIDEE, comme `confirmerPaiement` sur les factures ; scope strict `pharmacieId` — une
pharmacie ne peut solder que ses propres dispensations ; verrouille chaque ligne concernée
par compare-and-swap `updateMany({statut:'DISPONIBLE'} → {statut:'SERVIE'})`, rejette si
`count===0`, c'est-à-dire si une autre pharmacie a pris la ligne entre-temps).

`preauthorization.service.ts` adapté (`creerOrdonnance`, `listerCodesOrdonnancePharmacie`,
`validerCodeOrdonnance`) pour lire/écrire `lignesOrdonnance` au lieu du jsonb, en conservant
exactement la même forme de réponse externe — le mécanisme `codes_ordonnance` du PROMPT 19
n'a subi aucune régression.

### Point resté en suspens (à clarifier, pas silencieusement abandonné)
L'item « endpoint réservé au PHARMACIEN seul pour modifier/substituer un médicament sur
l'ordonnance » (demandé avant la clarification métier) n'a pas été explicitement redemandé
dans le message de révision. Il n'a **pas** été implémenté dans cette révision — seule la
dispensation standard (partagée par les 3 rôles pharmacie) existe aujourd'hui. À traiter
dans un prompt dédié si toujours pertinent.

### Tests
- Unitaires : 13 nouveaux tests `pharmacy.service.spec.ts` (verrou par ligne refusé si déjà
  SERVIE, prix non défini rejeté, caissière autorisée à préparer, rôle non-adhérent refusé
  sur la validation de code, patient non concerné refusé, garde bloquante paiement avant
  validation, scope pharmacie strict sur la confirmation de paiement, compare-and-swap sur
  concurrence, écriture stock réservée au pharmacien). Suite complète : **21/21 suites,
  214/214 tests**, `tsc --noEmit` propre.
- HTTP réel (établissement + 2 pharmacies + 4 comptes éphémères + le compte adhérent de
  référence, ordonnance à 2 lignes réelle créée via le parcours complet
  code-consultation → dossier → consultation → ordonnance) — **12/12** :
  ordonnance à 2 lignes créée (Paracetamol / Amoxicilline) ; recherche par carte révèle la
  liste avec son contenu (pas un code secret) ; Pharmacie A sert la ligne Paracetamol
  (Amoxicilline refusée chez elle, 409, prix non défini) ; **paiement tenté AVANT
  validation du code → 403** (garde bloquante) ; patient valide le code → VALIDEE ;
  paiement confirmé → PAYEE, ligne Paracetamol verrouillée sur Pharmacie A, ligne
  Amoxicilline reste DISPONIBLE ; Pharmacie B sert la ligne Amoxicilline restante avec
  succès ; **Pharmacie B tente de reservir la ligne Paracetamol → 409 explicite** (déjà
  SERVIE ailleurs) ; circuit complet validé pour B (verrouillage sur Pharmacie B confirmé
  en base) ; **Pharmacie B tente de confirmer le paiement d'une dispensation de Pharmacie A
  → 404** (scope strict par pharmacie). Données et 4 comptes éphémères supprimés, serveur
  arrêté.

### 🎯 Jalon — le verrou de dispensation pharmacie est désormais posé par ligne de
médicament (et non plus par ordonnance entière), avec prix propres à chaque pharmacie et
la même garde bloquante de paiement que les factures d'établissement

## 2026-09-12 — Substitution de médicament (pharmacien seul) + reconstruction de
`/dashboard-pharmacie/caissiere` selon le vrai parcours

### 1. `substituerMedicament` — réservé EXCLUSIVEMENT à PHARMACIE_PHARMACIEN
Point resté en suspens à la fin du prompt précédent (la révision majeure n'avait pas
redemandé explicitement cet endpoint). Implémenté conformément à la clarification :
« concernant la modification ou la substitution d'un médicament le pharmacien doit
valider ». `PharmacyService.substituerMedicament(ligneDispensationId, nouveauMedicament,
motif)` : `assertPharmacien` (jamais la caissière ni le comptable), scope strict à SA
pharmacie, **ne s'applique que si la dispensation est encore EN_PREPARATION ou
EN_ATTENTE_VALIDATION_PATIENT** (rejet `ConflictException` sinon — une fois VALIDEE par
le patient ou PAYEE, le contenu ne peut plus changer en silence), motif obligatoire
(`@IsNotEmpty`), audit `SUBSTITUTION_MEDICAMENT` sur la table `lignes_dispensation`.

Migration `027_pharmacie_substitution_medicament.sql` : 4 colonnes ajoutées à
`lignes_dispensation` (`medicament_substitue`, `motif_substitution`, `substitue_par_id`,
`date_substitution`) ; RLS scindée en lecture (3 rôles pharmacie) / création (3 rôles,
préparation) / modification (PHARMACIE_PHARMACIEN seul — la substitution).

### 2. Reconstruction de `/dashboard-pharmacie/caissiere` — vrai parcours
L'écran précédent (livré avant la révision majeure) utilisait encore l'ancien mécanisme
`codes-ordonnance` (PROMPT 19, verrou par ordonnance entière). Reconstruit intégralement
sur le nouveau module `pharmacy/` : recherche par numéro de carte → sélection d'une
prescription → lignes DISPONIBLE/SERVIE (SERVIE grisée, non sélectionnable) → case à
cocher sur les lignes en stock chez SA pharmacie avec prix pré-rempli (éditable pour le
calcul affiché uniquement — le montant définitif reste calculé côté serveur depuis
`stock_medicaments_pharmacie`, jamais un prix fourni par le client, inchangé) → total
affiché → « Envoyer le code de confirmation au patient » → attente (sondage automatique
+ bouton « Rafraîchir le statut ») → « Confirmer le paiement », désactivé tant que le
patient n'a pas validé son code. Bouton « Demander une substitution » par ligne, visible
mais désactivé pour la caissière (« Réservé au pharmacien ») ; le composant
(`DispensationFlowEcran`) est paramétré par rôle pour être réutilisable tel quel sur
`/dashboard-pharmacie/pharmacien` dans un prompt dédié — cette page reste, pour l'instant,
sur l'ancien écran (hors périmètre de cette reconstruction, non touchée).

**Ajustement de sécurité nécessaire, découvert en construisant l'écran** : `listerStock`
(`GET /pharmacy/stock`) était réservé au pharmacien seul (choix du prompt précédent). Or
la caissière doit pouvoir vérifier, au moment de la dispensation, si un médicament est en
stock et à quel prix — sans quoi elle ne peut ni cocher ni pré-remplir une ligne. Décision :
**lecture** ouverte aux 3 rôles PHARMACIE de la pharmacie, **écriture**
(`definirPrixStock`) inchangée, réservée au pharmacien. Migration
`028_pharmacie_lecture_stock_et_detail_dispensation.sql` (nouvelle policy RLS de lecture,
en plus de l'ancienne "for all" pharmacien-only qui continue de gouverner l'écriture).
Nouvel endpoint `GET /pharmacy/dispensations/:id` (scopé à SA pharmacie, jamais le code de
confirmation) ajouté pour permettre l'affichage du statut en temps réel côté écran.

### Tests
- Unitaires : 6 nouveaux tests (`substituerMedicament` bloqué pour la caissière, bloqué si
  VALIDEE/PAYEE, scope pharmacie strict, cas nominal pharmacien ; `listerStock` lisible par
  la caissière ; `obtenirDispensation` scope strict + ne renvoie jamais le code). Suite
  complète : **21/21 suites, 222/222 tests**, `tsc --noEmit` propre (API et web).
- Navigateur réel (Playwright/Chromium headless, installé temporairement pour ce test puis
  retiré) — connexion réelle par le formulaire de login, parcours complet en tant que
  caissière : recherche par carte → patient trouvé → sélection de la prescription → ligne
  déjà servie ailleurs affichée grisée et décochable **désactivée** → ligne disponible
  cochable avec prix pré-rempli → total mis à jour → code envoyé → « Confirmer le
  paiement » désactivé avant validation → bouton de substitution visible mais désactivé
  avec le message « Réservé au pharmacien » → **tentative directe de substitution via
  l'API (contournant l'écran) → 403 confirmé** → validation du code (simulée côté API,
  aucun écran adhérent dédié à ce jour) → rafraîchissement dans le navigateur → statut mis
  à jour → paiement confirmé → ligne verrouillée en base sur la pharmacie de la caissière.
  **12/12.** Données de test et 4 comptes éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — la substitution de médicament est strictement réservée au pharmacien
(vérifié au niveau service ET par un appel API direct contournant l'écran) ; l'écran
caissière reflète enfin le vrai parcours de dispensation par ligne, avec un ajustement de
sécurité documenté (lecture du stock ouverte, écriture toujours fermée)

## 2026-09-12 (suite) — `/dashboard-assureur/comptable` + `/comptable-adjoint` : correction
du 404 identifié lors de la relecture complète de `PROGRESSION.md`

### Constat de départ
`ASSUREUR_COMPTABLE` a un `dashboardRoute` configuré en base (`/dashboard-assureur/comptable`,
confirmé via `sous_roles`), mais **aucune page frontend n'existait** pour cette route — un
compte réel avec ce rôle atterrissait sur un 404 après connexion. Repéré lors de la lecture
complète demandée de l'état du projet, jamais documenté comme gap avant ce prompt.

### Audit précis des droits API réels d'`ASSUREUR_COMPTABLE` (avant toute construction)
Vérifié module par module (lecture directe des constantes de rôle, pas supposé) :
- **Cotisations (`billing/`)** : `ROLES_GESTION_BILLING` = `ASSUREUR_COMPTABLE` +
  `ASSUREUR_INFORMATIQUE` — écriture réelle et complète (calcul de cotisation, grilles
  tarifaires, enregistrement de paiement). **Seul module où ce rôle a une écriture réelle.**
- **Facturation établissement (`preauthorization/`)** : `genererFacture`
  (`ROLES_GENERATION_FACTURE` l'inclut, non scopé établissement puisque non
  `CENTRE_MEDICAL_*`) et surtout `confirmerPaiement`, **réservé À LUI SEUL**
  (`ROLE_CONFIRMATION_PAIEMENT = 'ASSUREUR_COMPTABLE'`, ni exploitation ni informatique).
  Droits réels et même exclusifs, mais **aucun écran n'existe nulle part dans l'app pour ce
  domaine côté assureur** (confirmé : aucune référence à `genererFacture`/`confirmerPaiement`
  dans `apps/web`) — gap documenté, non construit ici (hors périmètre : accès aux écrans
  déjà existants uniquement).
- **Souscripteurs/Polices/Adhérents/Produits/Réseau de soins** : `ROLES_GESTION_
  {SOUSCRIPTEUR,POLICE,MEMBRE,PRODUIT,RESEAU}` ne l'incluent **dans aucun cas** — lecture
  ouverte (comme tout le monde dans l'entité ASSUREUR) mais aucune écriture. Non liés dans
  la navigation, même raison déjà appliquée à `ASSUREUR_EXPLOITATION` sur produits/
  cotisations/réseau : ces écrans n'ont aucun garde-fou de rôle côté frontend (boutons
  d'écriture toujours affichés), les exposer en lecture y montrerait des actions qui
  échoueraient en 403.
- **Réclamations (`claims/`)** : `ROLES_LECTURE_CLAIMS` (= `ROLES_GESTION_CLAIMS` +
  médecin-conseil) **ne l'inclut PAS** — contrairement à `ASSUREUR_EXPLOITATION`, ce rôle
  n'a **aucun accès, pas même en lecture**. Vérifié en HTTP réel : `GET
  /claims/reclamations` → 403.
- **Utilisateurs (`invitations/regles_provisioning`)** : jamais créateur ni validateur
  (`regleProvisioning` interrogée pour `ASSUREUR_COMPTABLE(_ADJOINT)` comme `roleCreateur`
  ET `roleValidateur` → aucun résultat dans les deux cas). Zéro droit, non lié.
- **Rapports financiers** : aucun module `reporting`/`rapport` n'existe dans l'API —
  gap complet documenté, rien à lier.
- **`ASSUREUR_COMPTABLE_ADJOINT`** (`roleParentCode = ASSUREUR_COMPTABLE`,
  `peut_valider = false` contre `true` pour le titulaire, `dashboardRoute =
  /dashboard-assureur/comptable-adjoint`, confirmé en base) : hérite du rôle via
  `roleChain`. **Vérifié explicitement** (contrairement à ce qui a d'abord été fait pour
  `informatique-adjoint`, corrigé plus tôt dans cette séquence) : `ROLES_GESTION_BILLING`
  teste l'appartenance à la chaîne de rôles, jamais `permissions.peutValider` — et **aucune
  action du périmètre Cotisations n'a de notion de « validation finale »** (pas de
  workflow brouillon/proposition → validation sur les cotisations ni les grilles
  tarifaires, contrairement à « Valider une proposition » ou « Publier un produit » côté
  informatique-adjoint). Le principe demandé (masquer les boutons de validation finale via
  `peutValider`) est câblé sur l'écran (`peutValider` passé en prop, note explicite
  affichée si `false`), mais **concrètement rien n'est masqué aujourd'hui** — gap constaté
  et documenté plutôt qu'un masquage fictif inventé pour une action qui n'existe pas.

### Frontend
- `lib/dashboard-nav.ts` : `navComptable()` (nouvelle fonction) — seulement « Vue
  d'ensemble » + « Cotisations », réutilisée pour les 2 `dashboardRoute`.
- `app/dashboard-assureur/informatique/layout.tsx` : `ROUTES_ADMIN_ASSUREUR` étendue aux
  2 nouvelles routes (mécanisme déjà en place pour direction/exploitation — aucun nouveau
  layout de gestion créé, réutilisation de l'écran Cotisations existant).
- `app/dashboard-assureur/comptable(-adjoint)/` : layout (garde propre à la route, même
  pattern que `exploitation/layout.tsx`) + page (vue d'ensemble). `ComptableVueEnsemble`
  (composant partagé) : `GrilleCartes` (à payer / payées / en retard / reste à encaisser,
  calculées depuis `GET billing/cotisations`), un seul « Accès rapide » (Cotisations), et
  une carte de périmètre explicite listant les exclusions vérifiées ci-dessus (réclamations
  non accessibles, confirmation de paiement sans écran, rapports financiers inexistants,
  note spécifique pour l'adjoint sur l'absence de validation finale dans ce domaine).

### Test — HTTP réel (2 comptes éphémères, sans établissement/pharmacie nécessaire)
**14/14** (7 par rôle, comptable et adjoint identiques) : `GET billing/cotisations` → 200 ;
`POST billing/cotisations/:id/paiement` (id fictif) → **404, pas 403** (le rôle passe bien
le contrôle, seule la ressource n'existe pas — preuve que l'écriture cotisations est
réellement autorisée, sans avoir à créer de donnée financière) ; `GET claims/reclamations`
→ 403 ; `POST tenant/souscripteurs` / `policy/polices` / `plan/produits` /
`provider/etablissements` → 403 chacun.

### Test — navigateur réel (Playwright/Chromium headless, installé temporairement puis
retiré, comme pour le test caissière) — 16/16
Pour chacun des 2 rôles : connexion réelle par le formulaire de login → redirection vers
sa propre route (**plus de 404**) → page 200 → vue d'ensemble avec les 4 cartes cotisations
affichées → lien « Cotisations » présent, **aucun** lien Souscripteurs/Produits/Polices/
Adhérents/Établissements/Pharmacies/Utilisateurs/Réclamations dans la nav ni les accès
rapides → clic sur Cotisations → navigation réelle vers l'écran existant, 200, contenu
affiché. Comptes éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — le 404 d'`ASSUREUR_COMPTABLE` est corrigé ; son périmètre de navigation (et
celui de son adjoint) correspond exactement aux droits API vérifiés, avec les gaps
(facturation sans écran, rapports financiers inexistants) documentés plutôt qu'improvisés

## 2026-09-12 (suite) — Audit de couverture frontend complet (état actuel, post-9-étapes)
puis correction de l'incohérence pharmacien/comptable qu'il a identifiée

### Audit (lecture seule, aucune correction à ce stade)
Refait sur les 6 mêmes sections que l'audit initial de cette séquence, sur l'état réel du
code (`HEAD` `324c149`). Constats marquants :
- **`/dashboard-pharmacie/pharmacien` et `/comptable` lisaient encore l'ancien mécanisme
  `codes_ordonnance`** (PROMPT 19) alors que la dispensation réelle passe désormais par
  `dispensations_pharmacie`/`lignes_dispensation` (module `pharmacy/`) — seule la caissière
  avait été migrée. Conséquence concrète vérifiée : ces deux écrans pouvaient afficher un
  état vide alors que des dispensations réelles avaient eu lieu, dès qu'une pharmacie
  n'utilisait que le nouvel écran caissière.
- **Le gap de facturation `ASSUREUR_COMPTABLE`** (`confirmerPaiement`/`obtenirFacture`,
  v8 §5) est confirmé inchangé — toujours zéro référence dans `apps/web`, exactement comme
  documenté au prompt précédent.
- **Un 404 réel restait** sur `SOUSCRIPTEUR_INDIVIDUEL` (`dashboardRoute =
  /dashboard-adherent/individuel`, aucune page) — sur les 25 sous-rôles, c'est le seul.
  Finding nouveau au passage : `underwriting.service.ts::soumettreQuestionnaire` autorise
  déjà ce rôle à soumettre son propre questionnaire médical en self-service
  (`estLeSouscripteur`), sans aucune UI — hors périmètre de ce prompt (dédié à
  l'incohérence pharmacie), non traité ici.
- Gaps déjà connus reconfirmés inchangés : `ClaimsService` sans scope société, clôture
  forcée sans écran assureur.

### Correction de l'incohérence pharmacien/comptable (seule correction de ce prompt)
- **Nouveau `GET /pharmacy/dispensations`** (`listerDispensationsPharmacie`, filtre
  `?statut=` optionnel) : scope strict `ctx.pharmacieId`, jamais le code de confirmation.
  Renvoie aussi le patient (nom/prénom/numéro de carte) et le nom du médicament
  **substitué** si applicable (jamais l'original dans ce cas). 4 tests ajoutés (scope,
  filtre statut, rôle non-pharmacie refusé, substitution affichée). Suite complète :
  **21/21 suites, 226/226 tests verts**, `tsc --noEmit` propre (API et web).
- `/dashboard-pharmacie/pharmacien` : bascule sur `pharmacy/` — réutilise
  `DispensationFlowEcran` (partagé avec la caissière, substitution active pour ce rôle,
  conçu paramétrable par rôle exprès pour ce cas) + nouvel historique complet (tous
  statuts) via `DispensationsListeEcran` (nouveau composant, `DataTable` réemployé).
- **`/dashboard-pharmacie/pharmacien/stock`** (nouvelle route + nav « Mon stock ») :
  `StockEcran` (nouveau), gestion réelle de `stock_medicaments_pharmacie` (les endpoints
  existaient déjà, aucune UI ne les exposait) — `definirPrixStock` reste réservé au
  pharmacien côté API, vérifié inchangé.
- `/dashboard-pharmacie/comptable` : bascule sur `pharmacy/`, lecture seule des
  dispensations `PAYEE` uniquement (`DispensationsListeEcran`, filtre serveur) — cohérent
  avec le rôle déjà en place avant cette bascule (aucune action de préparation/paiement).
- Fichiers désormais orphelins supprimés (plus aucune référence après la bascule des 2
  dernières pages) : `dispensation-ecran.tsx`, `comptable-ecran.tsx`,
  `app/dashboard-pharmacie/actions.ts`, `app/dashboard-pharmacie/types.ts` (ancien
  mécanisme `codes_ordonnance` côté frontend — le mécanisme backend, lui, reste inchangé
  et continue de protéger le contenu de l'ordonnance comme avant).

### Test — navigateur réel (Playwright/Chromium headless, installé temporairement puis
retiré) — scénario complet demandé, 12/12
Établissement + 1 pharmacie + 5 comptes éphémères (accueil, médecin, caissière,
**pharmacien et comptable de la MÊME pharmacie**), ordonnance réelle via le parcours
établissement complet : la caissière traite une dispensation de bout en bout (recherche
par carte → sélection → code envoyé → validation patient → paiement confirmé, comme au
prompt précédent) → **le pharmacien voit réellement la dispensation** (médicament,
patient, statut Payée) dans son historique, plus d'état vide trompeur → l'écran « Mon
stock » du pharmacien affiche le tarif défini plus tôt → **le comptable de la même
pharmacie voit la même dispensation, PAYEE, avec le bon montant** → contrôle négatif :
`?statut=EN_PREPARATION` renvoie bien une liste vide côté serveur (aucune dispensation
résiduelle à ce statut). Données et 5 comptes éphémères supprimés, serveurs arrêtés.

### 🎯 Jalon — l'incohérence relevée à l'audit est corrigée : les 3 rôles PHARMACIE
regardent désormais la même source de vérité (`pharmacy/`), plus aucun écran de cette
filière ne peut afficher un état vide trompeur pendant qu'une activité réelle a lieu

## 2026-09-15 — `/dashboard-adherent/individuel` : corrige le 404 SOUSCRIPTEUR_INDIVIDUEL
(dette laissée ouverte par l'audit de couverture frontend)

### Vérification préalable demandée : le provisioning pose-t-il correctement `profil.societeId` ?
Réponse : **il n'existe tout simplement aucun chemin de provisioning applicatif pour
l'entité ADHERENT**, ni pour `ADHERENT_TITULAIRE` ni pour `SOUSCRIPTEUR_INDIVIDUEL`.
`regles_provisioning` couvrait 22 des 25 sous-rôles ; ces deux-là en étaient absents.
`member/adherent.service.ts::creerAdherent` ne crée que la fiche métier (`Adherent`),
jamais de compte Supabase/`Profil` lié. Le compte de référence utilisé dans toute cette
séquence (`armelk01+adherent@gmail.com`) avait lui-même été créé à la main, hors
application — ce n'était donc pas un bug de valeur mal posée, mais l'absence totale du
chemin de création. **Décision (validée avec l'utilisateur)** : traiter un souscripteur
individuel exactement comme une société cliente — un `souscripteurs` de type `INDIVIDUEL`
avec sa propre police personnalisable, provisionné par `ASSUREUR_INFORMATIQUE` (déjà
créateur direct de tous les rôles `SOCIETE_*`).

### Correctif (priorité, avant l'écran)
- Migration `029_provisioning_souscripteur_individuel.sql` : ajoute la règle
  `ASSUREUR_INFORMATIQUE → SOUSCRIPTEUR_INDIVIDUEL` (`scope_verifie = organisation_id`,
  `CREATION_DIRECTE`, aucun validateur) — même règle exacte que les 4 rôles `SOCIETE_*`.
  Aucun code applicatif à modifier : `resoudreScope()`/`accepterInvitation()`
  (`invitations.service.ts`) traitent déjà génériquement `societeId`+`adherentId` pour
  toute règle `organisation_id`, et `peut_inviter_role()` (RLS, prisma/sql/008) lit la
  même table — une seule source de vérité, les deux couches se mettent à jour ensemble.
- **Vérifié en creusant le schéma** : la RLS de `tarification_individuelle` et de
  `questionnaires_medicaux` (prisma/sql/007, PROMPT 10) anticipait déjà un accès
  self-service (`pol.souscripteur_id = (select societe_id from profils …)`) — cette
  fonctionnalité était conçue pour l'auto-service dès l'origine, seuls le provisioning, un
  bout de service NestJS et l'écran manquaient.
- **Gap NestJS trouvé au passage** : `UnderwritingService.listerTarifications` n'avait
  *aucune* branche self-service (contrairement à `listerQuestionnaires`, qui l'a déjà) —
  un souscripteur ne pouvait pas lire sa propre prime malgré une RLS qui l'autorisait déjà.
  Corrigé : lecture ouverte à `ROLES_TARIFICATION_INDIVIDUELLE` (toute l'org) **ou** au
  souscripteur concerné (`ctx.societeId`), strictement scopée à ses propres polices. 2
  tests ajoutés. Suite complète : **21/21 suites, 227/227 tests verts**, `tsc --noEmit`
  propre (API et web).

### Écran (`app/dashboard-adherent/individuel/`)
Un seul écran combinant les 3 états demandés (`IndividuelVueEnsemble`, réutilise
`StatutBadge`/`lib/underwriting.ts` déjà utilisés côté médecin-souscripteur) :
1. **Pas encore soumis** → formulaire (mêmes champs que la structure `reponses`/
   `antecedentsDeclares` affichée côté médecin-souscripteur — `reponses` est un JSON libre
   sans schéma fixe dans ce projet, donc un jeu de questions représentatif plutôt qu'un
   formulaire figé imposé par le backend).
2. **Soumis, en attente** → statut affiché, **aucune section décision rendue** — vérifié
   que la règle v4 §3.1 tient réellement : `decision` est `null` en base tant que le
   médecin souscripteur n'a pas statué (contrainte CHECK `decision ⟺ date_decision`),
   `evaluerQuestionnaire` est le seul point d'écriture et reste réservé à
   `ASSUREUR_MEDECIN_SOUSCRIPTEUR` — rien à masquer côté UI qui ne le soit déjà côté
   donnée.
3. **Décision rendue** → décision + surprime/exclusions, et la prime
   (`tarification_individuelle`, si déjà calculée) avec le détail prime de base +
   surprime médicale + prime finale ; sinon message explicite (« tarification en cours »),
   jamais de prime inventée.
- `lib/dashboard-nav.ts` : nouvelle entrée `/dashboard-adherent/individuel` (un seul item,
  « Vue d'ensemble ») — note explicite que les 5 écrans de soins partagés avec
  `ADHERENT_TITULAIRE` (consultation/ordonnances/factures/réclamations/carte) sont
  API-accessibles à ce rôle (`ROLES_ADHERENT` les traite déjà à l'identique) mais non
  branchés ici, hors périmètre de ce prompt.

### Test — HTTP réel + navigateur réel (Playwright/Chromium headless, installé
temporairement puis retiré) — parcours complet demandé, 21/21
Provisioning réel de bout en bout (comme documenté ci-dessus, pas de raccourci) :
`ASSUREUR_INFORMATIQUE` crée le souscripteur `INDIVIDUEL` → une police (devis) →
l'adhérent → invite le compte `SOUSCRIPTEUR_INDIVIDUEL` (**la nouvelle règle fonctionne,
201**) → acceptation réelle de l'invitation → **`profil.societeId` et `profil.adherentId`
vérifiés en base, tous deux corrects**. Puis navigateur réel : connexion → **redirection
vers `/dashboard-adherent/individuel`, plus de 404** → formulaire affiché → soumission
réelle du questionnaire dans le navigateur → statut « En attente d'évaluation », **aucune
section décision visible** (vérifié aussi en base : `decision IS NULL`) → le médecin
souscripteur rend sa décision (`ACCEPTE_SURPRIME`, 15 %) par API → retour navigateur :
décision maintenant visible, tarification pas encore calculée → calcul de la prime
(12 000 F base + 15 % = 13 800 F) → retour navigateur : **prime de base, surprime et
prime finale toutes affichées avec le bon montant** → contrôle négatif : un second
souscripteur individuel éphémère interroge `GET /underwriting/tarifications` et reçoit une
liste **vide** (pas la prime d'autrui). Données et comptes éphémères supprimés (ordre FK
particulier respecté : invitation avant profils, profils avant adhérent/souscripteur),
serveurs arrêtés.

### 🎯 Jalon — le 404 `SOUSCRIPTEUR_INDIVIDUEL` est corrigé avec un vrai provisioning
(pas un contournement), la fonctionnalité self-service anticipée dès la RLS d'origine
(PROMPT 10) est enfin exposée de bout en bout, et la confidentialité de la décision avant
son rendu est vérifiée au niveau donnée, pas seulement à l'écran

## 2026-09-16 — Provisioning réel pour `ADHERENT_TITULAIRE` (même dette que
`SOUSCRIPTEUR_INDIVIDUEL`, comblée à son tour)

### Vérification demandée : `ADHERENT_TITULAIRE` a-t-il une règle dans `regles_provisioning` ?
**Non, confirmé précisément** (`regleProvisioning.findMany({ where: { roleCree:
'ADHERENT_TITULAIRE' } })` → tableau vide). Même absence que celle déjà comblée pour
`SOUSCRIPTEUR_INDIVIDUEL` au prompt précédent.

### Ce qui a rendu ce cas différent (pas une simple ligne en base)
Contrairement à `SOUSCRIPTEUR_INDIVIDUEL` (scope `organisation_id`, déjà pleinement géré),
la règle demandée pour `SOCIETE_ADMINISTRATION` utilise un scope **`societe_id`, qui
n'existait dans AUCUNE des couches du mécanisme générique** :
- `InvitationsService.resoudreScope()` ne gérait que `organisation_id`/`pharmacie_id`.
- `ContexteAppelant` ne portait même pas `societeId`.
- `peut_inviter_role()` (RLS, défense en profondeur) ne le reconnaissait pas non plus.
- La contrainte CHECK sur `regles_provisioning.scope_verifie` n'autorisait que
  `organisation_id`/`pharmacie_id`/`etablissement_id` — une tentative d'insertion brute
  avec `societe_id` a d'ailleurs été rejetée par cette contrainte, confirmant l'absence
  totale du support, avant toute correction de code.
Une insertion SQL seule aurait donc soit échoué, soit — pire — laissé un
`SOCIETE_ADMINISTRATION` inviter un adhérent en fournissant l'id de **n'importe quelle
société** dans la requête, sans aucune vérification. Corrigé en dérivant le scope
**exclusivement du profil de l'appelant** (`ctx.societeId`), jamais de la requête — même
principe que `pharmacie_id`, et même famille de contrôle que les fuites
inter-établissement/pharmacie déjà corrigées cette session.

### Correctifs
- `invitations.types.ts`/`invitations.service.ts` : `ContexteAppelant.societeId` ajouté ;
  nouvelle branche `resoudreScope()` pour `scope_verifie = 'societe_id'` — refuse si
  l'appelant n'a pas de société propre, et si un `adherentId` est fourni, **revérifie
  qu'il appartient réellement à cette société** (`Adherent.souscripteurId === ctx.societeId`)
  avant de l'accepter — sinon 404 anti-énumération, jamais un 403 qui confirmerait
  l'existence de l'adhérent chez un tiers.
- Migration `030_provisioning_adherent_titulaire.sql` : élargit la contrainte CHECK à
  `societe_id`, recrée `peut_inviter_role()` (4 paramètres, ajout `p_societe_id`) et la
  policy `invitations_insert` qui l'appelle, puis insère les 2 règles :
  `ASSUREUR_INFORMATIQUE → ADHERENT_TITULAIRE` (`organisation_id`, aucun code
  supplémentaire nécessaire — déjà générique) et
  `SOCIETE_ADMINISTRATION → ADHERENT_TITULAIRE` (`societe_id`, nouveau).
- 3 tests unitaires ajoutés (invitation réussie pour son propre adhérent ; rejet 404 sur
  l'adhérent d'une autre société ; rejet 403 sans société rattachée). Suite complète :
  **21/21 suites, 230/230 tests verts**, `tsc --noEmit` propre.

### Test — HTTP réel (2 sociétés distinctes, 1 compte informatique + 1 compte
SOCIETE_ADMINISTRATION + 2 adhérents réels éphémères) — 14/14
Informatique crée 2 sociétés réelles + un adhérent réel dans chacune, provisionne un
compte `SOCIETE_ADMINISTRATION` pour la société A (règle déjà existante, inchangée) →
**ce compte invite réellement son propre adhérent** (`POST /invitations` → 201, la
nouvelle règle fonctionne) → `invitation.societeId` confirmé dérivé du profil appelant
(pas de la requête) → acceptation réelle → **`profil.societeId`/`profil.adherentId`
vérifiés en base, tous deux corrects** → le nouveau compte adhérent peut lire sa propre
fiche (200). **Contrôle négatif** : la même société A tente d'inviter avec l'`adherentId`
de la société B → **404** (« Adhérent introuvable pour votre société »), confirmant que la
requête n'est jamais crue sur parole. Données et 3 comptes éphémères supprimés (ordre FK
respecté), serveur arrêté.

### 🎯 Jalon — les 2 créateurs légitimes d'`ADHERENT_TITULAIRE` (informatique et société
cliente) ont désormais un provisioning réel et vérifié en HTTP, avec le même niveau de
rigueur anti-fuite que le reste de l'application — le scope `societe_id` du mécanisme
générique d'invitations est réutilisable pour tout futur rôle qui en aurait besoin

## 2026-09-16 (suite) — Diagnostic du bug d'invitation signalé, puis activation du
bouton « Valider » pour l'informaticien sur ASSUREUR_EXPLOITATION

### Diagnostic (demandé explicitement avant toute correction) — le bug ne s'est PAS reproduit
Scénario signalé : un collaborateur invité en `CREATION_DIRECTE` (hors `PROPOSITION`)
accepte l'invitation, crée son mot de passe, mais ne peut ensuite pas se connecter ;
l'informaticien ne trouve aucune action « approuver ». Reproduit avec un cas réel
(`ASSUREUR_INFORMATIQUE` invite `armelk01@hotmail.fr` en `ASSUREUR_EXPLOITATION`), selon
**deux protocoles** :
1. Appel API direct (création → acceptation → connexion) : tout fonctionne, `profils`
   créé correctement, connexion réelle réussie, `/identity/me` correct.
2. **Reproduction plus poussée en navigateur réel**, ciblant l'hypothèse la plus
   plausible : quand Supabase envoie réellement son e-mail natif d'invitation
   (`/auth/v1/invite`), le lien cliqué ajoute un fragment `#access_token=...&type=invite`
   à l'URL de retour — jamais exercé par un test API pur. Découverte au passage : l'envoi
   réel d'e-mails Supabase est **rate-limité (429, `over_email_send_rate_limit`)** dans cet
   environnement (pas de SMTP personnalisé), ce qui explique le repli systématique
   (`emailEnvoye: false`) observé lors des tests précédents. Contourné avec
   `admin/generate_link` pour obtenir un vrai lien Supabase pointant vers notre vrai
   token, cliqué avec un navigateur réel : le fragment était bien présent, mais la
   connexion et la redirection vers `/dashboard-assureur/exploitation` ont malgré tout
   abouti.

**Conclusion** : aucune anomalie fonctionnelle trouvée dans le code (`resoudreScope`,
`accepterInvitation`, `AccepterInvitationForm`) après relecture complète et double
reproduction réaliste. Rien corrigé sur ce point précis — inventer un correctif sans
cause identifiée aurait été contraire à la rigueur déjà appliquée dans cette séquence.

### Clarification obtenue : le vrai besoin n'était pas un bug mais une fonctionnalité absente
L'informaticien attend un flux à **deux temps par le même rôle** — « il peut envoyer un
lien d'invitation qu'il va approuver par la suite » — distinct de la délégation déjà
utilisée pour `PHARMACIE_CAISSIERE` (validée par un rôle *différent*,
`ASSUREUR_INFORMATIQUE`). Ce flux à deux temps par la même personne est déjà le principe
retenu ailleurs dans ce projet pour les actions sensibles (confirmation à deux temps des
actions superadmin, PROMPT 22).

### Correctif — migration de données uniquement, aucun code applicatif changé
`ValiderProposition()` autorise déjà quiconque porte le rôle `roleValidateur` dans sa
chaîne — y compris le rôle créateur lui-même — et le panneau Utilisateurs affiche déjà
« Valider »/« Rejeter » pour toute invitation `EN_ATTENTE_VALIDATION_INFORMATIQUE` dès que
le rôle du visualiseur correspond au validateur. Un seul changement de donnée suffisait :
- Migration `031_exploitation_proposition_autoapprobation.sql` : bascule les règles
  `ASSUREUR_INFORMATIQUE → ASSUREUR_EXPLOITATION` et `→ _CONJOINTE` de `CREATION_DIRECTE`
  vers `PROPOSITION` avec `roleValidateur = ASSUREUR_INFORMATIQUE` (auto-approbation, pas
  une délégation). Portée volontairement limitée à ces 2 rôles — les autres rôles créés
  par l'informatique restent en `CREATION_DIRECTE`, inchangés (pas de changement de
  comportement plus large que ce qui a été demandé).

### Test — HTTP réel (12/12) + navigateur réel (5/5)
Informatique crée la proposition → **statut `EN_ATTENTE_VALIDATION_INFORMATIQUE`, aucun
compte Supabase créé à ce stade** → la proposition apparaît dans `GET /invitations` →
l'informaticien **approuve lui-même** (`POST /invitations/:id/valider`) → **c'est
SEULEMENT à ce moment que le compte Supabase est créé** → le collaborateur accepte et se
connecte réellement (200), `dashboardRoute` correct. **Contrôle négatif** : un compte
`ASSUREUR_EXPLOITATION` (pas informatique) tente de valider une proposition → **403**.
Puis en navigateur réel : connexion informatique → `/dashboard-assureur/informatique/
utilisateurs` → **le bouton « Valider » est bien visible** pour la proposition en attente
→ clic réel → statut passe à « Invitation envoyée » dans le navigateur, confirmé en base
(compte Supabase créé). Données et comptes éphémères supprimés (dont le nettoyage d'un
oubli du diagnostic précédent : le compte réel `armelk01@hotmail.fr` créé lors du premier
test, repéré et supprimé), serveurs arrêtés.

### 🎯 Jalon — l'informaticien peut désormais créer une proposition ASSUREUR_EXPLOITATION
et l'approuver lui-même en deux temps, avec un bouton « Valider » réellement visible et
fonctionnel — corrigé sans écrire une seule ligne de code applicatif, uniquement en
réutilisant le mécanisme générique déjà en place

## 2026-09-16 (suite 2) — Visibilité de l'échec d'envoi d'e-mail sur les invitations

### Constat
`emailEnvoye` (résultat de `SupabaseAdminService.inviterUtilisateur`) n'était retourné
qu'**une fois**, dans la réponse immédiate de `creerInvitation`/`validerProposition` —
jamais persisté, jamais exposé par `GET /invitations`. Un échec d'envoi (confirmé
reproductible dans cet environnement : le relais e-mail partagé Supabase renvoie `429
over_email_send_rate_limit` dès quelques invitations rapprochées) devenait donc
silencieusement indiscernable d'un envoi réussi dès que l'informaticien rechargeait
l'écran Utilisateurs — aucune action de secours (renvoi, lien manuel) n'existait.

### Correctif backend
- Migration `032_invitations_email_envoye.sql` : colonne `invitations.email_envoye`
  (nullable — `NULL` = aucun essai réel encore tenté, jamais une valeur inventée pour les
  lignes historiques antérieures à la colonne).
- `InvitationsService` : `emailEnvoye` désormais persisté à chaque tentative d'envoi
  réelle (`creerInvitation`, `validerProposition`, et la nouvelle méthode
  `renvoyerEmail`). `presenter()` centralise `emailEnvoye` (toujours renvoyé) et
  `lienAcceptation` (renvoyé avec le token à la création ET dans `listerMesInvitations`,
  pas seulement à l'instant de la création — l'émetteur a déjà vu ce token une fois, ce
  n'est pas une nouvelle exposition).
- Nouvel endpoint `POST /invitations/:id/renvoyer` (`renvoyerEmail`) : réservé à
  l'émetteur de l'invitation, uniquement pour une invitation encore `EN_ATTENTE`, un seul
  essai explicite (jamais de boucle), résultat persisté et audité
  (`RENVOI_EMAIL_INVITATION`).

### Bug réel trouvé et corrigé pendant le test en navigateur réel
Le test « Renvoyer l'email » sur une invitation déjà en échec faisait remonter une
**exception technique brute** (« Création du compte Supabase impossible (422:
email_exists…) ») au lieu du message d'échec explicite attendu. Cause racine dans
`SupabaseAdminService.inviterUtilisateur()` : sur un renvoi, le compte auth existe déjà
(créé par la tentative précédente) ; si le nouvel appel `/invite` échoue pour une raison
**autre** que « exists » (ex. rate limit encore actif), le code retombait sur
`creerUtilisateur()` (`POST admin/users`) — qui échoue *forcément* lui aussi, puisque
l'e-mail existe déjà, mais sans le repli déjà en place pour ce cas précis. Corrigé en
ajoutant le même repli (`trouverParEmail`) autour de l'appel à `creerUtilisateur()` :
si ce dernier échoue aussi et que le compte est bien retrouvable, `emailEnvoye:false` est
renvoyé proprement plutôt que de laisser remonter l'exception. 5 tests unitaires ajoutés
dans le nouveau `supabase-admin.service.spec.ts` (succès direct, réutilisation directe,
repli simple, repli en cascade — le cas du bug —, échec irrécupérable).

### Frontend (`utilisateurs-panneau.tsx`)
Sur les invitations `EN_ATTENTE` : badge d'alerte « Email non envoyé » quand
`emailEnvoye === false`, bouton « Renvoyer l'email » (retente l'envoi, affiche
explicitement un nouvel échec ou un succès — jamais silencieux), bouton « Copier le
lien » (presse-papiers, disponible dès qu'un `lienAcceptation` existe, indépendamment du
succès de l'e-mail — secours immédiat pour transmission manuelle SMS/WhatsApp).

### Test — navigateur réel (Playwright), backend 239/239
Compte `ASSUREUR_INFORMATIQUE` éphémère → invitation `CENTRE_MEDICAL_ACCUEIL` créée en
conditions réelles → limite Supabase déjà atteinte dans cet environnement,
`emailEnvoye:false` dès la 1ʳᵉ tentative → confirmé dans `GET /invitations`. En
navigateur : badge « Email non envoyé » **visible**. Clic « Renvoyer » → nouvel échec
affiché explicitement (« Nouvel échec de l'envoi… ») **après correction du bug
ci-dessus** (avant correction : exception brute affichée). Clic « Copier le lien » → lien
copié dans le presse-papiers **vérifié identique** au `lienAcceptation` de l'API. Lien
utilisé pour une acceptation réelle (mot de passe posé) puis connexion API directe avec ce
mot de passe → **200, compte réellement fonctionnel**. Données et comptes éphémères
supprimés, Playwright désinstallé, serveurs arrêtés.

### 🎯 Jalon — un échec d'envoi d'e-mail n'est plus invisible : badge, renvoi explicite et
lien de secours copiable, avec un bug réel de repli en cascade trouvé et corrigé grâce au
test en conditions réelles exigé pour cette tâche

## 2026-09-16 (suite 3) — Changement d'e-mail SUPERADMIN_PRINCIPAL : connexion réelle confirmée

Suite de la tâche laissée en attente en tout début de journée : l'e-mail du compte
`SUPERADMIN_PRINCIPAL` a été changé via l'API Admin Supabase
(`armelk01+superadmin@gmail.com` → `armelk01@gmail.com`, `email_confirm: true`), mais la
connexion réelle n'avait alors pas pu être vérifiée (mot de passe existant inconnu, pas de
réinitialisation autorisée à ce moment-là).

- Vérification de configuration : `SUPERADMIN_EMAIL=armelk01@gmail.com` dans
  `apps/api/.env` (déjà correct), **aucune** référence à l'ancienne adresse dans le code ou
  la configuration active — seules des entrées historiques datées subsistent plus haut
  dans ce fichier (jamais réécrites, conformément à la règle de ce document).
- Premier essai de connexion réelle avec le mot de passe supposé existant → **échec**
  (`400 invalid_credentials`, confirmé à la fois via un appel direct à l'API Supabase et
  via `/login` en navigateur réel) ; compte vérifié sain par ailleurs (`email_confirmed_at`
  cohérent avec l'heure du changement, pas de `banned_until`).
- Sur demande explicite de l'utilisateur : mot de passe réinitialisé via l'API Admin
  Supabase (`PUT /auth/v1/admin/users/:id`), généré aléatoirement (20 caractères), affiché
  une seule fois à l'utilisateur pour qu'il le note.
- **Connexion réelle confirmée** avec le nouveau mot de passe : navigateur réel via
  `/login` → atterrit sur `/superadmin`, titre « Super administration », e-mail
  `armelk01@gmail.com` affiché dans l'en-tête.

### 🎯 Jalon — le compte SUPERADMIN_PRINCIPAL fonctionne intégralement sous sa nouvelle
adresse `armelk01@gmail.com`, connexion réelle vérifiée de bout en bout

## 2026-09-16 (suite 4) — Champ de rattachement obligatoire dans le formulaire d'invitation

### Constat
Le formulaire « Inviter un compte » (`/dashboard-assureur/informatique/utilisateurs`) ne
demandait qu'un e-mail et un rôle. Or `CreerInvitationDto` accepte `etablissementId` /
`pharmacieId` / `societeId` en champs **tous optionnels**, et `resoudreScope()` (branche
`scope_verifie = organisation_id`) les reprenait tels quels **sans jamais vérifier qu'ils
étaient renseignés ni qu'ils appartenaient à l'organisation de l'appelant** — un
CENTRE_MEDICAL_MEDECIN, un PHARMACIE_PHARMACIEN ou un SOCIETE_ADMINISTRATION pouvait donc
être créé sans aucun rattachement (compte orphelin, permissions scopées cassées), ou pire,
rattaché à un établissement/une pharmacie/un souscripteur d'une AUTRE organisation si l'ID
était deviné ou falsifié.

### Correctif backend (défense en profondeur, même famille que le contrôle déjà en place
sur `adherentId` dans la branche `societe_id`)
`resoudreScope()` : pour tout rôle `CENTRE_MEDICAL_*` → `etablissementId` obligatoire et
revérifié (`findFirst` scopé sur `organisationId` de l'appelant) ; tout rôle `PHARMACIE_*`
→ même contrôle sur `pharmacieId` ; `SOCIETE_ADMINISTRATION` → même contrôle sur
`societeId` (le souscripteur). Absent → `400`, appartenant à une autre organisation →
`404` (jamais un `500` ni une création silencieuse avec un champ `null`). 7 nouveaux tests
unitaires (`invitations.service.spec.ts`) : requis manquant, cross-organisation refusé,
cas nominal, pour les 3 familles de rôles.

### Correctif frontend (`utilisateurs-panneau.tsx`)
Le rôle choisi est maintenant suivi en état React ; selon son préfixe
(`CENTRE_MEDICAL_*` → Établissement, `PHARMACIE_*` → Pharmacie, `SOCIETE_ADMINISTRATION`
→ Souscripteur), un champ de sélection **apparaît dynamiquement**, alimenté par les
listes déjà exposées (`GET /provider/etablissements`, `GET /provider/pharmacies`,
`GET /tenant/souscripteurs`, chargées dans `page.tsx`). Le bouton « Inviter » reste
**réellement désactivé** (`disabled`, pas seulement une popup de validation HTML) tant que
ce champ n'est pas rempli pour les rôles concernés — la validation serveur reste en place
en secours, mais n'est plus la seule ligne de défense contre l'oubli.

### Test — navigateur réel (Playwright)
Compte `ASSUREUR_INFORMATIQUE` éphémère connecté réellement. Rôle `CENTRE_MEDICAL_MEDECIN`
sélectionné → champ « Établissement » apparaît → bouton **désactivé** tant qu'aucun
établissement n'est choisi → tentative de clic **rejetée par le navigateur lui-même**
(Playwright confirme l'échec du clic) → **0 invitation créée en base** malgré la
tentative. Établissement choisi → bouton réactivé → soumission réelle → invitation
créée avec `etablissementId` correctement renseigné (vérifié en base). Changement de rôle
vers `PHARMACIE_PHARMACIEN` → le champ bascule bien sur « Pharmacie ». Backend 246/246.
Données et compte éphémères supprimés, Playwright désinstallé.

### 🎯 Jalon — impossible d'inviter un CENTRE_MEDICAL_*/PHARMACIE_*/SOCIETE_ADMINISTRATION
sans rattachement, ni depuis l'écran (bouton désactivé) ni en contournant l'écran (rejet
serveur avec vérification cross-organisation)

## 2026-09-16 (suite 5) — Validation ASSUREUR_INFORMATIQUE des établissements EN_ATTENTE_VALIDATION

### Vérification préalable (avant tout code)
Aucun endpoint ne permettait de faire passer un établissement/une pharmacie de
`EN_ATTENTE_VALIDATION` à `ACTIF` — seul un `PATCH` générique existait
(`modifierEtablissement`/`modifierPharmacie`), sans action dédiée ni audit spécifique.
Vérification supplémentaire faite AVANT de coder le pendant « pharmacie » demandé :
la contrainte `CHECK` de la table `pharmacies` (migration 009) n'autorise que
`ACTIVE | SUSPENDUE | RESILIEE` — **`EN_ATTENTE_VALIDATION` n'existe pas pour les
pharmacies** (contrairement aux établissements, qui l'ont dans leur `CHECK`). Un
`validerPharmacie(id)` pour cette transition précise aurait donc été du code mort.
Sur confirmation de l'utilisateur : seul `validerEtablissement(id)` a été construit.

### Backend
`ProviderService.validerEtablissement(user, id)` : réservé à `ASSUREUR_INFORMATIQUE`
(réutilise `assertGestion`/`ROLES_GESTION_RESEAU`, déjà strictement limité à ce rôle),
refuse `409` si l'établissement n'est pas `EN_ATTENTE_VALIDATION`, `404` s'il n'appartient
pas à l'organisation de l'appelant, puis passe `statut → ACTIF` et audite
`VALIDATION_ETABLISSEMENT`. Route dédiée `POST /provider/etablissements/:id/valider`
(même style que les actions d'état déjà en place dans `invitations/`). 4 nouveaux tests
unitaires (`provider.service.spec.ts`, 16/16).

### Frontend (`reseau-panneau.tsx`)
Nouvelle colonne d'action dans le tableau des établissements : bouton « Valider »,
visible uniquement pour une entrée `EN_ATTENTE_VALIDATION`, disparaît une fois `ACTIF`.

### Test — navigateur réel + bout en bout métier
Les 2 établissements réellement bloqués dans cet environnement (**FARAH**,
**HMA garde WE**, tous deux `EN_ATTENTE_VALIDATION`) validés en navigateur réel par un
compte `ASSUREUR_INFORMATIQUE` : statut affiché passe à `ACTIF`, bouton « Valider »
disparaît, confirmé en base (`statut = ACTIF` × 2) et dans `audit_log`
(2 entrées `VALIDATION_ETABLISSEMENT`). Vérification métier demandée explicitement :
un adhérent éphémère réel, rattaché à une police `ACTIVE` existante de cette
organisation, appelle `POST /preauthorization/codes-consultation` en ciblant FARAH —
**`201`, code de consultation émis sans aucun blocage** (le blocage « Établissement non
actif » qui empêchait jusqu'ici l'ouverture d'un dossier de soins a bien disparu).
Backend 250/250. Données de test éphémères supprimées ; FARAH et HMA restent
volontairement `ACTIF` (c'est l'objectif de la tâche, pas un résidu à nettoyer).

### 🎯 Jalon — FARAH et HMA garde WE sont ACTIF, un dossier de soins peut réellement s'y
ouvrir désormais (vérifié de bout en bout, pas seulement au niveau du statut)

## 2026-09-16 (suite 6) — 6 compléments d'audit indépendants (plan, billing, member,
care-episode, reference, provider)

### Constat général
Pour les 6 points, l'endpoint backend existait déjà (souvent depuis longtemps) —
`archiver`/`modifierGarantie` (plan), `marquer-en-retard` (billing),
`modifierBeneficiaire`/`supprimerBeneficiaire` (member), `cloture-forcee` (care-episode),
`retirerActe`/`retirerMedicament` (reference), `modifierEtablissement`/`supprimerEtablissement`/
`rechercheGeolocalisee` (provider). Le vrai manque était systématiquement **frontend** :
aucun bouton, aucun écran. Seules deux exceptions ont nécessité du code API : (1) `reference/`
n'avait AUCUNE création directe d'acte/médicament exposée nulle part (ni import catalogue
national, ni création directe) côté informatique — écran entièrement absent, pas seulement
incomplet ; (2) `care-episode/` n'avait AUCUN écran assureur du tout pour les dossiers de
soins (uniquement centre médical) — la clôture forcée n'était donc exerçable par personne
en pratique malgré son existence en base de code.

Chaque rôle réel a été vérifié dans le code AVANT d'afficher le bouton correspondant
(jamais supposé) :
- plan/ : `ROLES_GESTION_PLAN = [ASSUREUR_DIRECTION, ASSUREUR_INFORMATIQUE]` — la page
  produit utilisait `peutValider` (mauvaise habilitation : vaut `true` aussi pour
  ASSUREUR_COMPTABLE/EXPLOITATION). Corrigé en un `peutGererPlan` dérivé de `roleChain`,
  appliqué uniformément à Renommer/Publier/Nouvelle version/Archiver/Garanties — ces 2
  derniers boutons étaient d'ailleurs déjà non gatés du tout avant ce correctif.
- billing/ : `ROLES_GESTION_BILLING` (comptable + informatique) — écran déjà entièrement
  non gaté par bouton (accès uniquement via la route), cohérent avec le pattern documenté
  dans `informatique/layout.tsx`.
- member/ : `peutGererMembres()` déjà exact (ROLES_GESTION_MEMBRE + SOCIETE_ADMINISTRATION
  sur son propre souscripteur) — réutilisé tel quel.
- care-episode/ : `ROLE_CLOTURE_FORCEE = ASSUREUR_EXPLOITATION` (roleChain, donc
  EXPLOITATION_CONJOINTE aussi, héritage confirmé en base). Nouvel écran ajouté
  UNIQUEMENT à la navigation Exploitation — Direction/Informatique/Médecin-conseil ont un
  accès LECTURE via l'API mais aucun besoin métier documenté ne justifiait de leur ajouter
  cet écran.
- reference/ : `ROLE_PROPOSITION = ASSUREUR_INFORMATIQUE` (création directe),
  `ROLE_HOMOLOGATION_ACTE`/`ROLE_HOMOLOGATION_MEDICAMENT` (Retirer, déjà exactement gatés
  par route pour les écrans homologation existants).
- provider/ : `ROLES_GESTION_RESEAU = [ASSUREUR_INFORMATIQUE]` (déjà le seul rôle avec accès
  à l'écran réseau, donc pas de gating par bouton nécessaire, cohérent avec l'existant).

### 1. plan/produits — bouton Archiver + édition de garantie existante
`archiverProduit`/`modifierGarantie` (server actions) + bouton « Archiver » et « Modifier »
sur chaque ligne de garantie (`produit-detail.tsx`, formulaire factorisé `ChampsGarantie`
réutilisé pour ajout ET modification).

### 2. billing/ — déclencheur "marquer les cotisations en retard"
Bouton sur l'écran Cotisations appelant `POST cotisations/marquer-en-retard` (jusque-là
seulement invocable en tâche batch, sans aucune interface).

### 3. member/ — édition et suppression de l'identité d'un bénéficiaire
Boutons « Modifier » (identité complète : nom, prénom, naissance, sexe, lien de parenté)
et « Supprimer » sur chaque ligne de bénéficiaire (`adherent-detail.tsx`).

### 4. care-episode/ — bouton "Clôture forcée" (ASSUREUR_EXPLOITATION)
Nouvel écran de supervision `/dashboard-assureur/informatique/dossiers` (liste + détail),
ajouté à la navigation Exploitation uniquement. Motif obligatoire (`ChampZone required
minLength={5}`, miroir exact de `ClotureForceeDto`).

### 5. reference/ — création directe d'actes/médicaments + action "Retirer"
Nouvel écran `/dashboard-assureur/informatique/referentiel-medical` (création directe,
sans passer par le catalogue national) + boutons « Retirer » ajoutés sur les écrans
d'homologation existants (médecin conseil / pharmacien conseil), distincts de
« Suspendre » (RETIRE vs SUSPENDU, déjà 2 statuts séparés côté API).

### 6. provider/ — recherche géolocalisée + édition/suppression unitaire
Section « Recherche géolocalisée » (lat/lng/rayon/cible) ajoutée sur l'écran réseau,
exploitant `GET provider/recherche` (jamais appelé jusqu'ici) ; boutons « Modifier » et
« Supprimer » ajoutés sur chaque ligne établissement/pharmacie.

### Test — chacun des 6 ajouts testé séparément en navigateur réel, un seul script couvrant
les 6 scénarios distincts (comptes éphémères ASSUREUR_INFORMATIQUE/EXPLOITATION/
MEDECIN_CONSEIL/PHARMACIEN_CONSEIL/CENTRE_MEDICAL_ACCUEIL) :
1. Garantie éditée (taux 70→85, vérifié en base) puis produit archivé (statut ARCHIVE).
2. Cotisation de test (échue, A_PAYER) → clic → EN_RETARD confirmé en base.
3. Bénéficiaire édité (nom modifié, vérifié en base) puis supprimé (`deletedAt` posé).
4. Dossier de soins réellement ouvert (code de consultation généré + validé à l'accueil de
   FARAH) → bouton visible pour EXPLOITATION → clôture forcée avec motif → `FORCE_CLOS`
   confirmé en base.
5. Acte et médicament créés directement (statut initial PROPOSE confirmé) → retirés par
   médecin conseil / pharmacien conseil respectivement → `RETIRE` confirmé en base.
6. Recherche géolocalisée autour de FARAH → FARAH trouvé dans les résultats ; établissement
   jetable créé → modifié (nom persisté) → supprimé (`deletedAt` posé).
Backend 250/250. Toutes les données de test éphémères supprimées (comptes Supabase,
profils, adhérents, produit, cotisation, dossier, acte, médicament, établissement).

### 🎯 Jalon — les 6 manques identifiés par les audits sont comblés, chacun avec le bon
rôle vérifié dans le code avant l'affichage du bouton, et testé séparément de bout en bout

## 2026-09-16 (suite 7) — Tarifs conventionnés établissement/pharmacie × acte (v3 §5)

Fonctionnalité prévue au plan directeur (Phase 4.2 « Grilles tarifaires conventionnées »,
v3 §5) mais jamais implémentée — confirmée par le diagnostic précédent (`grilles_tarifaires`
ne couvre que la cotisation par tranche d'âge/souscripteur, PROMPT 11 ; le microservice
Java n'appliquait aucun plafonnement par tarif négocié, seulement le taux + plafond de la
garantie).

### 1. Table `tarifs_conventionnes` (migration 033)
`id, organisation_id, etablissement_id NULL, pharmacie_id NULL (exactement l'un des deux —
contrainte `tarifs_conventionnes_cible_unique`, même pattern que `cotisations_cible_unique`),
referentiel_acte_id (FK), tarif_convention, date_debut, date_fin NULL, created_at,
updated_at, deleted_at`. Un seul tarif ACTIF par couple cible × acte (index unique
partiel). RLS : lecture organisation, écriture ASSUREUR_INFORMATIQUE (même pattern que
`etablissements_sante`/`pharmacies`, prisma/sql/009). Modèle Prisma `TarifConventionne`
ajouté avec les relations inverses.

### 2. Endpoints NestJS (`ProviderService`, réutilise `ROLES_GESTION_RESEAU`)
`POST/GET /provider/{etablissements|pharmacies}/:id/tarifs`,
`PATCH/DELETE .../tarifs/:tarifId` — vérifie que l'acte existe dans l'organisation, refuse
un doublon actif (409), audite `CREATION_TARIF_CONVENTIONNE`/`MODIFICATION_...`/
`SUPPRESSION_...`. 7 nouveaux tests unitaires.

### 3. Jointure côté microservice Java (`JdbcAdjudicationRepository.SQL_CONTEXTE`)
`reclamations → dossiers_soins (etablissement_id) → actes_dossier (code_acte) →
referentiel_actes (code) → tarifs_conventionnes (etablissement_id, referentiel_acte_id,
période de validité)`, en `LEFT JOIN` partout : absence de tarif (ou de `code_acte`
renseigné, actuellement optionnel côté saisie) → `tarif_convention` NULL → comportement
inchangé. `ContexteAdjudication` étendu de `etablissementId`/`tarifConvention`. **Bug réel
trouvé et corrigé en conditions réelles** : les grants `svc_adjudication` (migration 018)
ne couvraient ni `dossiers_soins` ni `actes_dossier` — `permission denied for table
actes_dossier` à la première exécution réelle, puis un second oubli (`ad.deleted_at`
référencé dans le JOIN mais non accordé) — corrigés par les migrations 034 et 035
(grants colonne par colonne, même discipline que le grant existant sur `reclamations`).

### 4. `Adjudicateur.calculer()` : min(montant_facture, tarif_convention) en étape 0
Appliqué AVANT franchise/taux — si `tarifConvention` est `null` (cas par défaut),
`montantReclame` reste inchangé, rétrocompatible. 2 nouveaux tests JUnit avec montants
EXACTS : avec tarif (40000 facturé, 25000 conventionné → remboursé 18400.00 au lieu de
30400.00) et sans tarif (même 40000 facturé → 30400.00, comportement inchangé). Suite
Java complète : 21/21 (`mvn test`, microservice réellement compilé et démarré — Maven/
Java confirmés disponibles dans cet environnement, contrairement à une hypothèse
antérieure).

### 5. Écrans `/dashboard-assureur/informatique/{etablissements|pharmacies}/[id]`
Pages de détail créées de toutes pièces (aucune route `[id]` n'existait avant pour ces
deux écrans) : carte Informations + section « Tarifs conventionnés »
(`TarifsConventionnesPanneau` — DataTable, ajout/modification/suppression via
`FormulaireModal`, sélection de l'acte parmi le référentiel). Lien « Détails » ajouté sur
chaque ligne de `reseau-panneau.tsx`.

### Test — HTTP réel + microservice Java réellement démarré (mvn spring-boot:run, port
8899, connecté au Postgres réel via le rôle `svc_adjudication`)
Parcours complet réel : établissement FARAH (déjà ACTIF) → acte du référentiel créé →
tarif conventionné 25 000 F posé → adhérent réel généré un code de consultation → accueil
de FARAH valide le code (dossier réellement ouvert) → médecin de FARAH ajoute une
consultation puis un acte facturé 40 000 F (codeActe rattaché à l'acte du référentiel) →
réclamation soumise → **appel réel au microservice Java** :
- **Cas conventionné** : remboursement = **20 000,00 F** = min(40000, 25000) × 80 % — PAS
  32 000 F qu'aurait donné le montant facturé seul. Confirmé exact.
- **Cas non conventionné** (même établissement FARAH, acte différent, même montant facturé
  40 000 F, aucun tarif posé) : remboursement = **32 000,00 F** = 40000 × 80 % — comportement
  actuel inchangé, confirmé exact.
Écran « Tarifs conventionnés » testé séparément en navigateur réel : ajout (visible dans
le tableau), modification (persistée), suppression (`deletedAt` posé) — tout confirmé en
base à chaque étape. Backend 257/257, Java 21/21. Toutes les données de test éphémères
supprimées ; microservice Java et serveurs de développement arrêtés proprement.

### 🎯 Jalon — les tarifs conventionnés établissement/pharmacie × acte existent, sont
gérables depuis l'écran, et plafonnent réellement le remboursement calculé par le
microservice Java — vérifié de bout en bout avec le service réellement démarré, pas
seulement en test unitaire

## 2026-09-17 — Trois ajouts au parcours établissement (identification carte, type de
visite, simulation indicative de remboursement)

Sans casser le mécanisme anti-fraude existant (le code de consultation reste l'unique
voie d'ouverture d'un dossier).

### 1. Identification par numéro de carte (`member/`) — ADDITIF, purement informatif
`GET /member/recherche-carte?numeroCarte=...`, réservé exclusivement à
`CENTRE_MEDICAL_ACCUEIL` (nouvelle constante `ROLE_RECHERCHE_CARTE`, distincte de
`ROLES_GESTION_MEMBRE` qui reste ASSUREUR/société). `AdherentService.rechercherParNumeroCarte`
cherche d'abord dans `adherents`, puis dans `beneficiaires` (les deux tables partagent la
même séquence `cartes_membre_numero_seq`, donc jamais d'ambiguïté) ; renvoie
nom/prénom/statut/numéro — n'ouvre aucun dossier, ne crée ni ne modifie rien. 404 si
inconnu, 403 pour tout autre rôle (y compris les autres rôles `CENTRE_MEDICAL_*` et le
personnel ASSUREUR), 400 si le numéro est vide. Écran : nouvelle section « Identification
par numéro de carte » en tête de `/dashboard-centre-medical/accueil`, au-dessus du
formulaire de code existant (inchangé). 7 nouveaux tests unitaires.

### 2. `type_visite` sur `dossiers_soins` (`care-episode/`) — choisi une fois, après
ouverture
Colonne `type_visite` (texte contraint par `CHECK`, prisma/sql/036) : `CONSULTATION_GENERALISTE
| CONSULTATION_SPECIALISTE | HOSPITALISATION_MEDICALE | ANALYSES_EXAMENS_MEDICAUX |
ACTES_DENTAIRES | CONSULTATION_DENTAIRE | PRESCRIPTION_MEDICALE`. Nouvel endpoint
`POST /care-episode/dossiers/:id/type-visite` (`CareEpisodeService.definirTypeVisite`) :
refuse (409) si le dossier n'est pas `OUVERT`, refuse (409) si déjà défini — un dossier ne
peut choisir son type qu'une seule fois, jamais silencieusement écrasé. Réutilise les
gardes existantes (`assertGestion`/`assertEtablissementDossier`) sans les modifier.
L'ouverture du dossier reste conditionnée au seul code de consultation, inchangée. Écran :
ligne « Type de visite » dans la carte Informations de `dossier-detail.tsx` — bouton
« Définir » (modale) tant que non choisi, libellé lecture-seule une fois défini. 5 nouveaux
tests unitaires.

### 3. Simulation indicative du remboursement à l'ajout d'un acte (`preauthorization/`)
`PreauthorizationService.simulerMontantActe` (privée), appelée en lecture seule DANS
`ajouterActe` avant la transaction d'écriture — ne bloque jamais l'ajout de l'acte
(absence de montant/garantie/tarif → `null` sur les 3 colonnes, comportement actuel
inchangé). Logique, dans l'ordre : (a) `montant_facture` = `montantPrescrit × quantite` ;
(b) si `codeActe` renseigné ET homologué dans l'organisation ET un `tarifs_conventionnes`
existe pour cet établissement à la date du jour → base = `min(montant_facture,
tarif_convention)` (jamais de majoration, même logique que le microservice Java) ; sinon
base = `montant_facture` ; (c) `montant_simule_assurance` = base × `garanties.tauxCouverture`
(plafonné par `garanties.plafondParActe` si défini) ; (d) `montant_simule_patient` = base −
`montant_simule_assurance` ; (e) `ticket_moderateur_simule` = base × `garanties.ticketModerateur`
(champ distinct de la garantie, affiché comme composante informative de la part assurée,
pas en supplément). Stocké sur `actes_dossier` (colonnes `montant_simule_assurance`,
`montant_simule_patient`, `ticket_moderateur_simule`, prisma/sql/037) et inclus dans le
détail d'audit. Reste indicatif : le calcul définitif au moment de l'adjudication réelle
(microservice Java, `Adjudicateur.calculer`) garde le dernier mot (franchise, plafond
annuel restant, verrouillage transactionnel — rien de tout cela n'est répliqué ici). Écran :
sélecteur d'acte du référentiel homologué dans le formulaire « + Acte » de
`dossier-detail.tsx`, et 3 colonnes supplémentaires (ticket modérateur / part assuré / part
assurance simulés) dans le tableau des actes, avec rappel du caractère indicatif. 9 nouveaux
tests unitaires (dont : tarif conventionné inférieur/supérieur au montant facturé, plafond
par acte de la garantie, absence de garantie/référentiel/montant).

### Tests
Backend : 278/278 (`npx jest`, 21 nouveaux tests). `npx tsc --noEmit` propre côté API et
Web. Test HTTP réel (établissement FARAH, tarif conventionné 6 000 F posé, garantie
CONSULTATION 80 %/20 %) : recherche par numéro de carte confirmée sans création de dossier
(404 si inconnu, 403 pour l'adhérent lui-même) ; ouverture du dossier via le code de
consultation (parcours inchangé) ; définition du type de visite persistée et vérifiée en
base, 409 confirmé à la 2ᵉ tentative ; ajout d'un acte facturé 10 000 F avec tarif
conventionné 6 000 F → simulation exacte confirmée en HTTP ET en base : part assurance
4 800 F (6 000 × 80 %), part assurée 1 200 F, ticket modérateur simulé 1 200 F (6 000 ×
20 %) — PAS 8 000/2 000 qu'aurait donné le montant facturé seul. Test navigateur réel
(Playwright, Chromium) sur les 3 écrans : carte de recherche par numéro affichant le
statut, modale de type de visite (bouton disparaît une fois défini), tableau des actes
affichant les montants simulés. Toutes les données de test éphémères (adhérents, comptes
Supabase, référentiel, tarif, dossier) supprimées et l'absence de résidu vérifiée
indépendamment après coup.

## 2026-09-17 (suite 2) — Pré-autorisation obligatoire des analyses/examens médicaux

Aucun paiement patient possible sur un acte ANALYSES_EXAMENS_MEDICAUX avant validation
explicite du médecin conseil.

### 1. `statut_preautorisation` sur `actes_dossier` (prisma/sql/038)
`NON_REQUISE | EN_ATTENTE_VALIDATION | APPROUVEE | REFUSEE`, défaut `NON_REQUISE`, `CHECK`
en base. `PreauthorizationService.ajouterActe` force `EN_ATTENTE_VALIDATION` **côté
serveur uniquement**, depuis `ticket.dossier.typeVisite` réel (déjà chargé par la requête
existante) — `AjouterActeDto` n'expose d'ailleurs aucun champ permettant au client
d'influencer ce statut. S'applique à TOUS les actes d'un dossier dont le type de visite est
`ANALYSES_EXAMENS_MEDICAUX`, quelle que soit la `categorieActe` de l'acte lui-même.

### 2. `validerPreautorisation` — réservé EXCLUSIVEMENT à `ASSUREUR_MEDECIN_CONSEIL`
Nouvelle constante `ROLE_VALIDATION_PREAUTORISATION` (même séparation que
`ROLE_HOMOLOGATION_ACTE`, module reference/) : ni `ASSUREUR_INFORMATIQUE`, ni
`ASSUREUR_EXPLOITATION` ne peuvent décider. `POST /preauthorization/actes/:id/preautorisation`
(`decision: APPROUVE|REFUSE`, `motif` requis ≥ 5 caractères) — 409 si l'acte n'est pas
`EN_ATTENTE_VALIDATION` (décision déjà tranchée, ou acte non concerné), 404 si hors
organisation. Audit `PREAUTORISATION_ANALYSE` avec `decision`/`motif`/statuts avant-après.
`GET /preauthorization/actes/en-attente-preautorisation` : file d'attente organisation
entière (patient, établissement, acte, date, montant simulé).

### 3. Garde bloquante de facturation (`calculerMontants`, `genererFacture`)
Tout acte `EN_ATTENTE_VALIDATION` ou `REFUSEE` (nouvelle constante partagée
`STATUTS_PREAUTORISATION_NON_FACTURABLES`) est EXCLU du calcul du montant d'une facture —
seuls `NON_REQUISE` et `APPROUVEE` comptent. Si un ticket ne contient QUE des actes exclus
(rien à facturer), `genererFacture` refuse explicitement (409, avec la liste des actes
concernés) plutôt que de générer une facture à 0 F qui occuperait définitivement l'unique
emplacement de facture du ticket (`ticketSoinsId` unique sur `factures_dossier`). Dans le
cas mixte (au moins un acte facturable), la facture est émise normalement et
`actesExclusPreautorisation` liste les actes écartés, en réponse ET dans l'audit
`GENERATION_CODE_FACTURATION` — cette exclusion est écrite pour être réutilisée telle
quelle par le futur mécanisme de sélection d'un acte pour paiement (Prompt 3, pas encore
construit). 25 nouveaux tests unitaires côté `preauthorization` (déclenchement automatique,
validation/rôles/statuts, exclusion de facturation dans les 3 cas : mixte, tout exclu,
aucun acte).

### 4. Écran `/dashboard-assureur/medecin-conseil/preautorisations`
Nouvelle page + composant `PreautorisationsFile` (même patron que `RevueManuelleFile` des
réclamations) : DataTable (patient, établissement, acte, date, montant simulé
assurance/patient), action « Décider » → `FormulaireModal` Approuver/Refuser avec motif
obligatoire. Lien ajouté sur la vue d'ensemble médecin conseil et dans la navigation.

### 5. Visibilité côté établissement
Badge de pré-autorisation (`EN_ATTENTE_VALIDATION` ambre / `APPROUVEE` vert / `REFUSEE`
rouge, `NON_REQUISE` masqué) ajouté à la fois sur le tableau des actes de
`dossier-detail.tsx` (dossier en cours) et de `ticket-detail.tsx` (écran de facturation
comptable), avec un avertissement explicite dans ce dernier quand des actes sont exclus du
montant facturé.

### Tests
Backend : 294/294 (`npx jest`, 25 nouveaux). `npx tsc --noEmit` propre API et Web. Test
HTTP réel (établissement FARAH) : ajout d'un acte BIOLOGIE sur un dossier de type
ANALYSES_EXAMENS_MEDICAUX → `EN_ATTENTE_VALIDATION` confirmé en HTTP et en base ; tentative
de facturation avant validation → 409 explicite nommant l'acte concerné ; validation par
`ASSUREUR_INFORMATIQUE` → 403 ; validation par `ASSUREUR_MEDECIN_CONSEIL` → `APPROUVEE`,
revalidation → 409 ; facturation après validation → 201, montant total 15 000 F complet,
aucune exclusion. Test navigateur réel (Playwright) : badge « En attente » visible côté
établissement, acte listé dans la file du médecin conseil (patient + établissement
visibles), décision Approuver via la modale → acte disparaît de la file, statut confirmé
en base. Toutes les données de test éphémères supprimées, absence de résidu vérifiée
indépendamment.

## 2026-09-17 (suite 3) — Facturation par sélection d'actes, paiement partiel

Remplace la facturation unique par ticket (v8 §5) par un cycle de facturation itératif :
le comptable de l'établissement facture les actes au fil du traitement, pas seulement une
fois le dossier terminé.

### 1. `lignes_facturation` (prisma/sql/039) — cycles multiples par dossier
`factures_dossier.ticket_soins_id` n'est plus `@unique` : un dossier peut désormais avoir
plusieurs cycles de facturation successifs (chaque `FactureDossier` = un cycle = un code,
une sélection d'actes, un règlement). Nouvelle table `lignes_facturation` (id,
`facture_dossier_id` nullable, `acte_dossier_id`, `montant_reclame`, `statut`
A_PAYER/PAYE, `date_paiement`) : le détail acte par acte d'un cycle. Contrainte forte posée
en base — un index unique partiel garantit au plus UNE ligne `A_PAYER` par acte à la fois
(empêche toute double-réclamation). RLS même esprit que `factures_dossier` (lecture
établissement/adhérent/assureur, écriture ASSUREUR habilité).

### 2. `genererFactureSelection(dossierSoinsId, acteIds[])` — remplace `genererFacture`
Le comptable coche les actes à régler MAINTENANT parmi tous ceux du dossier — plus besoin
que le ticket soit clôturé (nécessaire puisque la clôture est désormais elle-même
conditionnée au solde nul, cf. point 4 : facturer doit rester possible pendant que le
dossier est encore OUVERT). EXCLUT automatiquement, quelle que soit la sélection envoyée
par le client : tout acte `EN_ATTENTE_VALIDATION`/`REFUSEE` en pré-autorisation (garde du
prompt précédent) et tout acte déjà réglé (`LigneFacturation` à `PAYE`) — 409 explicite si
plus aucun acte sélectionné n'est facturable. Un acte déjà réclamé par un cycle abandonné
(code jamais validé) est RÉATTACHÉ au nouveau cycle plutôt que dupliqué. Calcule le cumul
(montant total / part assurance / part patient, même logique de garantie que l'ancien
`calculerMontants`, généralisée à un ensemble d'actes quelconque) et génère le
`code_facturation` pour CE montant précis — transmis à l'adhérent (dashboard dès
maintenant ; e-mail/SMS restent à raccorder séparément, cohérent avec le fait qu'aucun des
3 autres codes anti-fraude de ce projet n'émet réellement d'e-mail/SMS non plus à ce jour).

### 3. `confirmerPaiement` — marque uniquement les lignes DE CE CYCLE, expose le solde
Ne touche que les `lignesFacturation` liées à la `FactureDossier` réglée (jamais les autres
cycles). Calcule et renvoie `soldeRestantDu` : somme des actes non annulés qui n'ont
JAMAIS été réglés (aucune ligne `PAYE`), qu'ils aient déjà une ligne `A_PAYER` en cours ou
qu'ils n'aient jamais été sélectionnés dans aucun cycle. `validerCodeFacturation` inchangé
dans son principe (le patient valide un code, peu importe le cycle).

### 4. Clôture bloquée tant que le solde n'est pas nul — décision actée
`CareEpisodeService.clotureNormale` ET `clotureForcee` refusent désormais explicitement
(409, montant exact dans le message) si `soldeRestantDu(dossier) > 0`. **Conséquence
explicite et assumée** : un dossier reste ouvert INDÉFINIMENT tant qu'il n'est pas
intégralement soldé — y compris si le médecin conseil ne statue jamais sur un acte
`EN_ATTENTE_VALIDATION` (il ne devient alors jamais facturable, donc jamais soldable). La
contrainte déjà en place depuis le PROMPT 17 (« aucun dossier déjà ouvert » dans le
`MoteurOuvertureDossier`) bloque alors tout nouveau dossier pour CE patient tant que
l'ancien reste ouvert, dans n'importe quel établissement du réseau — assumé, décision
actée avant implémentation, pas un bug.

### 5. Écran comptable établissement (`ticket-detail.tsx`, `/dashboard-centre-medical/comptable`)
Renommé « Actes — sélection pour facturation » : case à cocher par acte (uniquement sur les
actes facturables — pré-autorisation/déjà payé grisés), montant cumulé de la sélection mis
à jour en direct, bouton « Générer le code de facturation ». Carte « Dossier » : ligne
« Solde restant dû » (rouge si > 0, vert si 0) + bandeau « Dossier non soldé — clôture
impossible » quand applicable. Carte « Cycles de facturation » (remplace l'ancienne carte
« Facture » unique) : historique de tous les cycles (montants, validation patient,
règlement). Liste `/dashboard-centre-medical/comptable` étendue aux dossiers OUVERT/
SUSPENDU (plus seulement CLOTURE/FORCE_CLOS), avec filtre de statut — nécessaire puisque la
facturation se fait maintenant PENDANT le traitement.

### Tests
Backend : 300/300 (`npx jest`, 27 nouveaux : sélection/exclusion/réattachement de lignes,
garde de clôture bloquante côté care-episode). `npx tsc --noEmit` propre API et Web. Test
HTTP réel (établissement FARAH, dossier à 3 actes 10 000/15 000/8 000 F) : clôture refusée
AVANT toute facturation (409, solde 33 000 F) ; cycle 1 sur 2 actes → 25 000 F facturés,
code validé par l'adhérent, paiement confirmé → solde restant 8 000 F (le 3ᵉ acte, jamais
sélectionné) ; clôture refusée à nouveau (409, solde 8 000 F) ; cycle 2 sur le 3ᵉ acte →
validé, réglé → solde à 0 ; clôture désormais acceptée (dossier CLOTURE), vérifié
indépendamment en base (3 lignes PAYE). Test navigateur réel (Playwright) sur l'écran
comptable : 2 cases à cocher affichées, montant cumulé 17 000 F après sélection, badge
« Code généré (en attente) » après génération, solde restant dû et bandeau « Dossier non
soldé » visibles avant paiement. Toutes les données de test éphémères supprimées, absence
de résidu vérifiée indépendamment.

## 2026-09-18 — Remboursement pharmacie (diagnostic confirmé absent, puis corrigé)

Diagnostic préalable (voir échange précédent) : l'assurance n'intervenait PAS du tout dans
le calcul de dispensation pharmacie (aucune trace de `partAssurance`/`montantAssurance`/
`tauxCouverture` dans `pharmacy/`) ; délai d'ordonnance à 7 jours, pas 14 ; substitution
déjà en place ; aucune tâche planifiée dans ce backend (ni pour l'expiration, ni ailleurs).

### 1. `lignes_dispensation.montant_assurance` / `montant_patient` (prisma/sql/040)
Calculées dans `PharmacyService.preparerDispensation`, même pattern que
`PreauthorizationService.simulerMontantActe` (`garanties.tauxCouverture`, plafond par acte
éventuel) — une seule garantie par dispensation (catégorie `PHARMACIE` du produit de la
police du patient, taux par défaut 80 % si aucune garantie ne matche). Agrégées et
renvoyées (dispensation + par ligne) dans `preparerDispensation`, `obtenirDispensation`,
`listerDispensationsPharmacie`, `listerMesDispensations`.

### 2. Réclamation automatique à la confirmation de paiement
Le patient ne règle plus que `montant_patient` (jamais le total). `reclamations` accepte
désormais DEUX sources exclusives (`acte_dossier_id` devenu nullable, nouveau
`dispensation_id` → `dispensations_pharmacie`, CHECK exactement l'un des deux, index
unique partiel sur chacun) : « une dispensation payée = un remboursement réclamé », montant
= `montant_assurance` cumulé sur toutes les lignes, jamais un flux séparé sans lien avec
l'adjudication. `ClaimsService` refactorisé — `creerOuChargerReclamation`/
`verrouillerEtAdjuger` extraits en cœur partagé, réutilisés par `soumettre` (acte,
inchangé) ET la nouvelle `soumettreDepuisDispensation` (point d'entrée interne, jamais
exposé par un contrôleur, appelé par `PharmacyModule` important désormais `ClaimsModule`).
Idempotent sur `dispensationId` : un cycle abandonné avant l'appel Java se retrouve plutôt
que d'être dupliqué. Le paiement reste acquis même si l'appel au microservice Java échoue
(déjà committé dans sa propre transaction avant l'appel HTTP externe) — l'erreur remonte
explicitement (502/503, même contrat que l'établissement) pour permettre une nouvelle
tentative de soumission.

### 3. Délai de validité des ordonnances : 7 → 14 jours
`codes_ordonnance.date_expiration` et `ordonnances.date_validite` (defaults Postgres +
message d'erreur `validerCodeOrdonnance`). Les lignes déjà émises avant la migration
gardent leur ancienne date d'expiration (changement de défaut, pas de rétroactivité).

### 4. Expiration automatique — endpoint déclenché à la main (pas de @Cron)
Recommandation retenue sans ambiguïté réelle : ce backend n'a AUCUNE infra de tâche
planifiée (`grep` sur `@Cron`/`node-cron` → zéro résultat), et un cron in-process
introduirait un risque concret de double-exécution si l'API tourne un jour derrière
plusieurs instances (aucun verrou distribué). `PreauthorizationService.expirerOrdonnancesObsoletes`
suit exactement le pattern déjà validé par `ProviderService.reverifierObsoletes` (PROMPT 15)
— idempotent, réservé à `ASSUREUR_INFORMATIQUE`, déclenchable par un cron externe ou
manuellement. `POST /preauthorization/codes-ordonnance/expirer-obsoletes` : passe `EMIS`→
`EXPIRE` / `ACTIVE|PARTIELLEMENT_DELIVREE`→`EXPIREE` pour tout ce qui a dépassé sa date,
audité (`EXPIRATION_ORDONNANCES_OBSOLETES`).

### 5. Écran pharmacien/caissière
Part assurance / part patient affichées par ligne ET en cumulé dès l'écran de préparation
(carte « Dispensation », avant même la validation du patient) — plus seulement le montant
total. Bouton « Confirmer le paiement » affiche désormais le montant réellement à percevoir
(`Confirmer le paiement (2 000 F)`, pas le total) ; message de confirmation + statut de la
réclamation soumise affichés après paiement.

### Tests
Backend : 307/307 (`npx jest`, 7 nouveaux dans `pharmacy.service.spec.ts` : calcul du
partage assurance/patient avec/sans garantie et avec plafond, soumission automatique à
l'adjudication, paiement acquis même si l'adjudication échoue ; `claims.service.spec.ts`
21/21 inchangé après le refactor). `npx tsc --noEmit` propre API et Web. Test HTTP réel
(établissement FARAH, produit existant, nouvelle garantie PHARMACIE 80 % créée pour le
test) : dossier → consultation → ordonnance → prix pharmacie 10 000 F → préparation
(8 000/2 000 confirmés) → validation patient → confirmation paiement → patient débité de
2 000 F, réclamation de 8 000 F réellement soumise et adjugée par le microservice Java
(`AUTO_ADJUDIQUE`), vérifiée en base (`acte_dossier_id` NULL, `type_reclamation` =
PHARMACIE) ; délai de 14 jours confirmé sur le code ET l'ordonnance fraîchement créés ;
expiration manuelle refusée à un rôle non habilité (403) puis acceptée pour
ASSUREUR_INFORMATIQUE sur une ordonnance/un code antidatés (passage à EXPIRE/EXPIREE
vérifié en base). Test navigateur réel (Playwright) sur l'écran pharmacien : partage
assurance/patient affiché par ligne et en cumulé, bouton de confirmation annonçant le
montant patient exact. Toutes les données de test éphémères supprimées, absence de résidu
vérifiée indépendamment à chaque étape.

## 2026-09-18 (suite) — Pré-autorisation à deux niveaux (exploitation → médecin conseil)

Restructuration du circuit posé au Prompt du 2026-09-17 (suite 2), sans le jeter : passage
d'un contrôle à un seul niveau (médecin conseil, analyses/examens uniquement) à un circuit
à deux niveaux (exploitation en premier, escalade optionnelle vers le médecin conseil),
étendu aussi aux hospitalisations.

### 1. Déclenchement élargi
`TYPES_VISITE_PREAUTORISATION_OBLIGATOIRE` passe de `[ANALYSES_EXAMENS_MEDICAUX]` à
`[ANALYSES_EXAMENS_MEDICAUX, HOSPITALISATION_MEDICALE]` — toujours décidé côté serveur
depuis `dossier.typeVisite` réel, jamais un champ du client.

### 2. Statuts à deux niveaux (prisma/sql/041)
`EN_ATTENTE_VALIDATION` renommé/scindé en `EN_ATTENTE_EXPLOITATION` (nouveau statut
initial) et `EN_ATTENTE_MEDECIN_CONSEIL` (atteint uniquement par escalade explicite,
jamais directement). Migration des données existantes : tout `EN_ATTENTE_VALIDATION` →
`EN_ATTENTE_EXPLOITATION`. Contrainte CHECK reposée avec les 6 valeurs
(`NON_REQUISE`, `EN_ATTENTE_EXPLOITATION`, `EN_ATTENTE_MEDECIN_CONSEIL`, `APPROUVEE`,
`APPROUVEE_PARTIELLEMENT`, `REFUSEE`). Nouvelles colonnes sur `actes_dossier` :
`quantite_approuvee`, `type_acte_approuve`, `ticket_moderateur_ajuste` (surcharge le
ticket modérateur de la garantie pour CET acte uniquement).

### 3. `traiterParExploitation` — premier niveau, réservé à `ASSUREUR_EXPLOITATION`/
`ASSUREUR_EXPLOITATION_CONJOINTE`
APPROUVE/REFUSE tranchent directement (réutilisent la même logique que
`validerPreautorisation`, extraite en helpers partagés `chargerActePreautorisation` /
`estApprobationPartielle` / `finaliserDecisionPreautorisation`) ; ESCALADE_MEDECIN_CONSEIL
bascule l'acte vers `EN_ATTENTE_MEDECIN_CONSEIL` sans recalcul (décision non prise).
`quantiteApprouvee`/`typeApprouve` en dessous de la demande → `APPROUVEE_PARTIELLEMENT`
(sinon `APPROUVEE` pleine). `validerPreautorisation` (médecin conseil, second niveau)
réutilise le même cœur, mais seulement sur un acte déjà `EN_ATTENTE_MEDECIN_CONSEIL`
(jamais atteignable directement).

### 4. Recalcul automatique de la simulation
`simulerMontantActe` étendu d'un paramètre optionnel `ticketModerateurOverride`.
Sur toute décision APPROUVE (aux deux niveaux), la simulation du Prompt du 2026-09-17
(`montant_simule_assurance`/`montant_simule_patient`/`ticket_moderateur_simule`) est
recalculée sur la base APPROUVÉE (`quantiteApprouvee ?? quantite` demandée) et le
`ticketModerateurAjuste` s'il est fourni — jamais sur la base demandée.

### 5. Écran `/dashboard-assureur/exploitation(-conjointe)/preautorisations`
Nouveau composant partagé `ExploitationPreautorisationsEcran` (même duplication de
route que la « Vue d'ensemble » de ces deux dashboards, `ASSUREUR_EXPLOITATION_CONJOINTE`
n'héritant pas de la `dashboardRoute` de son parent) : 3 sections — « Propositions à
valider » (formulaire APPROUVE/REFUSE/ESCALADE_MEDECIN_CONSEIL + champs d'ajustement
conditionnels, lien vers le dossier complet du patient), « Transmis au médecin conseil »
(lecture seule) et « Actes traités » (statuts finaux, détail de l'approbation partielle
affiché). Nouvel endpoint `GET actes/preautorisation-exploitation` dédié à cet écran.

### Tests
Backend : 318/318 (`npx jest`), dont un nouveau bloc `traiterParExploitation` (10 tests :
approbation intégrale/partielle par quantité/par nature, ticket modérateur ajusté, refus,
escalade, rôles autorisés/exclus, re-décision bloquée). `npx tsc --noEmit` propre API et
Web. Test HTTP réel (24/24) sur le scénario exact de la demande : hospitalisation à 3
jours demandés, exploitation approuve `quantiteApprouvee=2` → `APPROUVEE_PARTIELLEMENT`,
montant simulé recalculé sur 2 jours (10 000 F, pas 15 000 F) avec ticket modérateur
ajusté (1 000 F) ; escalade d'un second acte → apparaît immédiatement dans la file du
médecin conseil ET disparaît de la sous-liste « à traiter » de l'exploitation (reste
visible en lecture dans « transmis ») ; accès croisé refusé dans les deux sens
(ASSUREUR_INFORMATIQUE sur le niveau exploitation, ASSUREUR_EXPLOITATION sur le niveau
médecin conseil) ; re-décision sur un acte déjà tranché bloquée (409). Test navigateur
réel (Playwright, 14/14) sur le nouvel écran : 3 sections correctement peuplées, lien
dossier vérifié, décision d'approbation partielle saisie depuis le formulaire puis
vérifiée en base (statut et montant recalculé). Toutes les données de test éphémères
supprimées, résidu d'une première tentative avortée (contrainte de format sur le code de
ticket) détecté et nettoyé indépendamment.

## 2026-09-18 (suite 2) — Complète le circuit de validation (4 éléments restants)

### 1. Statistiques `/dashboard-assureur/exploitation`
Nouvel endpoint `GET preauthorization/actes/statistiques-exploitation` (réservé
ASSUREUR_EXPLOITATION/_CONJOINTE) : compteurs jour/semaine/mois/année (approuvés =
APPROUVEE(_PARTIELLEMENT), refusés, escaladés = ACTUELLEMENT EN_ATTENTE_MEDECIN_CONSEIL).
Simple agrégation sur `statutPreautorisation`/`updatedAt` — aucune nouvelle table, aucune
colonne de date de décision dédiée (comme demandé). Frontend : nouvelle section
`GrilleCartes` dans `ExploitationVueEnsemble` (partagée exploitation/exploitation-conjointe),
4 cartes avec total + détail par issue.

### 2. Règle anti-répétition (14 jours)
Portée sur `dossier.typeVisite = ANALYSES_EXAMENS_MEDICAUX` (et non sur `categorieActe`,
qui ne connaît que BIOLOGIE/IMAGERIE/etc. — précision apportée après une première
implémentation erronée détectée par le typecheck), et seulement si un `codeActe` est
fourni. `ajouterActe` bloque (409, message explicite avec le code et la date de l'acte
précédent + `acteRepeteId`) tout acte du même code pour le même adhérent/bénéficiaire dans
les 14 jours, tous établissements confondus. Nouvelle table `autorisations_repetition_acte`
(prisma/sql/042) : nouvel endpoint `POST tickets-soins/:id/actes/autoriser-repetition`
réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL (jamais l'exploitation), crée une
autorisation à usage unique (ticket + code) consommée automatiquement au prochain
`ajouterActe` réussi.

### 3. Notes libres sur un dossier (ou un acte précis)
Nouvelle table `notes_dossier` (prisma/sql/042, RLS). Écriture réservée à
`ROLES_ECRITURE_NOTE_DOSSIER` (ASSUREUR_EXPLOITATION/ASSUREUR_MEDECIN_CONSEIL — nouvel
endpoint `POST care-episode/dossiers/:id/notes`, module `care-episode` puisqu'il possède
déjà `chargerDossier`/`modeLectureDossiers`). Lecture élargie à tout rôle ayant déjà accès
au dossier (`chargerDossier` embarque désormais `notes`, aucune règle dupliquée) — personnel
ASSUREUR habilité organisation entière, établissement traitant scopé. Frontend : nouvelle
section « Notes » sur `DossierSupervisionDetail` (lecture + formulaire d'ajout) et sur
`DossierDetail` côté centre médical (lecture seule).

### 4. Orientation vers un établissement exécutant
Nouvelle colonne `etablissement_execution_id` sur `actes_dossier` (prisma/sql/042).
`TraiterParExploitationDto` étendu (`etablissementExecutionId`, ignoré hors décision
APPROUVE, validé — 404 si introuvable/hors organisation). `simulerMontantActe` recherche
désormais le tarif conventionné pour l'établissement EXÉCUTANT une fois renseigné, plus
jamais celui d'origine du dossier. Frontend : champ « Réorienter vers un établissement
exécutant » ajouté au formulaire de décision existant (`ExploitationPreautorisationsEcran`,
liste chargée via `provider/etablissements`), et affiché dans la colonne « Approuvé » des
actes traités.

### Tests
Backend : 339/339 (`npx jest`, 21 nouveaux : 8 anti-répétition, 3 `autoriserRepetition`,
3 orientation, 6 notes, 2 statistiques — dont un test à horloge figée, `jest.useFakeTimers`,
pour rester déterministe quel que soit le jour d'exécution réel). `npx tsc --noEmit` propre
API et Web. Test HTTP réel (19/19) : répétition du même code sous 14 jours bloquée avec le
bon message, débloquée une seule fois par une autorisation du médecin conseil (rebloquée à
la tentative suivante), exploitation elle-même incapable de s'auto-débloquer (403) ; notes
ajoutées par exploitation et médecin conseil, refusées pour ASSUREUR_INFORMATIQUE en
écriture (403) mais visibles par lui ET par l'établissement traitant en lecture ;
orientation d'un acte hospitalisation vers un second établissement (tarif conventionné à
4 000 F) donnant 4 000,00 F au lieu des 10 000,00 F de l'établissement d'origine (sans
tarif). Test navigateur réel (Playwright, 7/7) : section statistiques et écran
pré-autorisations chargés, section Notes affichée avec formulaire d'ajout, note saisie et
visible immédiatement après soumission. Toutes les données de test éphémères supprimées,
résidus de deux tentatives interrompues (contrainte d'unicité sur un second dossier ouvert
pour le même adhérent, puis ordre FK au nettoyage) détectés et nettoyés indépendamment à
chaque fois.

## 2026-09-22 — Accès en revue et contestation du pharmacien conseil (prévu depuis le
début du projet, jamais construit jusqu'ici)

### 1. Accès en lecture — ASSUREUR_PHARMACIEN_CONSEIL
Rejoint `ROLES_LECTURE_DOSSIER_STAFF` (care-episode.types.ts) : lecture organisation
entière des dossiers de soins complets (diagnostic, motif de consultation, historique des
actes), même mécanisme que les autres rôles conseil. Rejoint la policy RLS
`ordonnances_lecture` (prisma/sql/043) — `lignes_ordonnance_lecture` l'incluait déjà
(prisma/sql/026) ; `dossiers_soins` était déjà ouvert à toute l'organisation en RLS (scope
tenant uniquement, RBAC réel côté NestJS). Nouvel endpoint `GET
contestation/ordonnances-a-examiner` (module `contestation/`, nouveau) : toutes les
ordonnances récentes avec leurs lignes et le statut de contestation courant de chacune.

### 2. `contestations_prescription` (prisma/sql/043)
Table dédiée + RLS (lecture : pharmacien conseil et personnel ASSUREUR habilité,
organisation entière ; toute pharmacie du réseau — le NestJS reste seul juge de l'écriture
et du scope pharmacie précis). `date_limite` par défaut au premier jour du mois suivant
(fin du mois en cours). Contrainte `contestations_prescription_active_uniq` : au plus une
contestation OUVERT/JUSTIFICATION_RECUE active par ligne à la fois.

### 3. `ouvrirContestation` — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL
Exige que la ligne ait déjà été délivrée par une pharmacie
(`ligneOrdonnance.pharmacieServanteId` non nul — c'est ce qui désigne « la pharmacie
concernée », seul moment où `confirmerPaiementDispensation` renseigne ce champ). Bloque
la double-contestation et la recontestation d'une ligne déjà REJETEE (exclusion
définitive) ; une ligne VALIDEE peut en revanche être recontestée. `PharmacyService`
(`obtenirDispensation`/`listerDispensationsPharmacie`) renvoie désormais `enLitige: true`
et masque `montantAssurance`/`montantPatient` (exclus des totaux) pour toute ligne dont la
contestation est OUVERT/JUSTIFICATION_RECUE (temporaire) ou REJETEE (définitif) — nouvelle
méthode `chargerLignesEnLitige`, appliquée à chaque lecture, jamais mise en cache : une
décision VALIDEE fait immédiatement réapparaître le montant réel.

### 4. `soumettreJustification` — réservé à PHARMACIE_PHARMACIEN/PHARMACIE_COMPTABLE de LA
pharmacie concernée
Jamais PHARMACIE_CAISSIERE (clarification métier déjà appliquée ailleurs : elle prépare,
elle ne répond pas d'un litige financier), jamais une autre pharmacie que celle qui a
délivré la ligne. Fichiers (`multipart/form-data`, `FilesInterceptor`) stockés dans
Supabase Storage — nouveau bucket privé `contestations` (même schéma que `cartes`,
prisma/sql/023) : PDF/JPEG/PNG, 10 Mo max par fichier. URL signées à durée limitée
générées à la demande (`GET contestation/contestations/:id/pieces/:nomFichier`), jamais
d'URL publique stockée en base — seul le chemin l'est (`pieces_justificatives text[]`).

### 5. `trancherContestation` — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL
VALIDEE débloque la ligne (prochaine lecture : montant réel réaffiché). REJETEE l'exclut
définitivement (`enLitige` reste `true` pour toujours, aucune recontestation possible).

### 6. Frontend
Nouveau module `contestation/` (NestJS) + `ChampFichier` ajouté à
`components/dashboard/patterns/` (upload multi-fichiers, `fd.getAll()`). `apiFetch`
corrigé pour ne plus forcer `Content-Type: application/json` quand le corps est un
`FormData` (laisse `fetch` poser la boundary multipart lui-même — aucun appel existant
n'était affecté, tous envoient du JSON). Écran `/dashboard-assureur/pharmacien-conseil/
prescriptions` : section « Prescriptions à examiner » (accès au dossier complet via une
nouvelle route `pharmacien-conseil/dossiers/:id`, réutilise `DossierSupervisionDetail`
sans dupliquer l'écran — ce rôle ne rejoint PAS `ROUTES_ADMIN_ASSUREUR`, aucun droit sur
souscripteurs/polices/utilisateurs), « Contestations en cours » (boutons Valider/Rejeter),
« Contestations traitées ». Écran côté pharmacie (`/dashboard-pharmacie/pharmacien/
contestations` et `/comptable/contestations`, composant partagé comme `dispensation-
actions.ts`) : « Contestations reçues » avec formulaire de justification (observation +
pièces).

### Tests
Backend : 366/366 (`npx jest`, 27 nouveaux : 9 `ContestationService` — revue, ouverture,
règles de blocage — , 8 `soumettreJustification`, 4 `trancherContestation`, 3 exclusion
`enLitige` dans `PharmacyService`). `npx tsc --noEmit` propre API et Web. Test HTTP réel
(29/29) : accès en lecture du pharmacien conseil (ordonnances + dossier complet) confirmé,
refus pour tout autre rôle ; contestation bloquée sur une ligne non délivrée (400) ; montant
masqué (`enLitige`, totaux à 0.00) dans les deux endpoints de lecture pharmacie dès
l'ouverture ; caissière ET pharmacie non concernée refusées en justification (403), pièce
PDF réellement téléversée et récupérée via URL signée ; VALIDEE réaffiche immédiatement le
montant réel (8 000 F), REJETEE l'exclut de façon permanente (nouvelle tentative de
contestation → 409). Test navigateur réel (Playwright, 12/12) : ouverture d'une
contestation depuis l'écran pharmacien conseil, accès au dossier complet par le lien
dédié, réponse avec pièce jointe réellement déposée depuis l'écran pharmacie, validation
visible immédiatement des deux côtés. Toutes les données de test éphémères supprimées,
résidu d'une première tentative interrompue (format du code de confirmation) détecté et
nettoyé indépendamment.

## 2026-09-22 (suite) — Consolidation mensuelle des factures pharmacie + substitution
étendue au pharmacien conseil

### 1. Substitution de médicament — capacité additive pour ASSUREUR_PHARMACIEN_CONSEIL
`substituerMedicament` reste réservée au PHARMACIE_PHARMACIEN de SA pharmacie (inchangé),
mais accepte désormais AUSSI ASSUREUR_PHARMACIEN_CONSEIL (organisation entière, jamais
scopé à une pharmacie précise — nouveau `assertPeutSubstituer`, distinct de
`assertPharmacien` toujours utilisé tel quel pour la gestion du stock). L'audit distingue
les deux acteurs (`SUBSTITUTION_PHARMACIEN` vs `SUBSTITUTION_PHARMACIEN_CONSEIL`) — vérifié
en base dans le test HTTP. RLS (`lignes_dispensation_substitution`, prisma/sql/044) étendue
en miroir.

### 2. `factures_mensuelles_pharmacie` (prisma/sql/044)
Table dédiée avec les statuts EN_PREPARATION → SOUMISE → VALIDEE_PHARMACIEN_CONSEIL →
PROGRAMMEE_PAIEMENT → PAYEE. Contrainte d'unicité `(pharmacie_id, periode)` — une seule
consolidation par pharmacie et par mois. Nouvelle colonne `lignes_dispensation.
facture_mensuelle_id` : c'est elle qui « réclame » une ligne pour une facture précise
(snapshot au moment de la soumission, pas un recalcul dynamique) — une ligne exclue pour
litige reste `NULL` et redevient éligible le mois suivant une fois la contestation
VALIDEE.

### 3. `soumettreFactureMensuelle` — PHARMACIE_PHARMACIEN/PHARMACIE_COMPTABLE (jamais la
caissière), toujours SA pharmacie
Déclenchable uniquement pour le mois civil précédent (rejette toute autre période).
Agrège les `LigneDispensation` des dispensations PAYEE de la période jamais encore
réclamées par une facture antérieure, EXCLUT celles actuellement en litige
(`ContestationPrescription`, module contestation/ — réutilise `chargerLignesEnLitige`
tel quel, aucune duplication) : `montantTotal` = somme des `montantAssurance` des lignes
facturables uniquement (ce que l'assureur doit à la pharmacie, jamais `montantLigne` ni
`montantPatient`, déjà réglé au comptoir par le patient).

### 4. `validerFactureMensuelle` — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL
Double sécurité explicite : ne fait AUCUNE confiance à l'agrégation de la soumission —
recharge les lignes stampées par CETTE facture et revérifie leur statut de litige à
l'instant présent (une contestation a pu être ouverte après la soumission, avant la
validation) ; bloque la validation (409, détail des lignes concernées) si l'une d'elles
est désormais en litige.

### 5. Verrou RLS explicite pour ASSUREUR_COMPTABLE
`ASSUREUR_COMPTABLE` (et `_ADJOINT` par héritage d'un niveau, `profil_a_role`) n'a AUCUN
accès — ni lecture ni écriture — tant que le statut n'a pas atteint
VALIDEE_PHARMACIEN_CONSEIL, verrouillé en RLS (policy dédiée avec la condition de statut
dans `USING`/`WITH CHECK`, prisma/sql/044) ET côté NestJS (`obtenirFactureMensuelle`
vérifie explicitement l'accès direct par id, pas seulement le filtre des listes).
`programmerPaiementFactureMensuelle` (VALIDEE_PHARMACIEN_CONSEIL → PROGRAMMEE_PAIEMENT) et
`marquerFactureMensuellePayee` (PROGRAMMEE_PAIEMENT → PAYEE) réservés à ce même rôle.

### 6. Écrans
Pharmacie (`/dashboard-pharmacie/{pharmacien,comptable}/factures-mensuelles`, composant
partagé) : bouton « Soumettre la facture de [mois] » (masqué si déjà soumise) + historique.
Pharmacien conseil (`/dashboard-assureur/pharmacien-conseil/factures-mensuelles`) :
« Factures mensuelles à valider », détail ligne-par-ligne chargé en une fois (file
naturellement petite), boutons Détail/Valider. Comptable
(`/dashboard-assureur/{comptable,comptable-adjoint}/factures-pharmacie`, composant
partagé, nouvelle entrée dans `navComptable`) : « Factures pharmacie prêtes à
programmer » — vide tant qu'aucune n'est validée (confirmé par le test), boutons
Programmer/Marquer payée selon le statut.

### Tests
Backend : 391/391 (`npx jest`, 25 nouveaux : 4 substitution pharmacien conseil,
5 `soumettreFactureMensuelle`, 4 `validerFactureMensuelle`, 4 `programmerPaiement`/
`marquerPayee`, 5 verrou d'accès `obtenirFactureMensuelle` — horloge figée,
`jest.useFakeTimers`, pour un mois précédent déterministe). `npx tsc --noEmit` propre API
et Web. Test HTTP réel (24/24) sur le scénario exact demandé : pharmacien substitue puis
pharmacien conseil substitue aussi (audit distinct vérifié en base), contestation ouverte
sur une ligne d'une dispensation payée du mois, soumission de la facture mensuelle —
montant total exact (8 000 F, la ligne contestée à 3 000 F exclue automatiquement),
ASSUREUR_COMPTABLE explicitement bloqué avant validation (liste vide, accès direct par id
en 403, programmation refusée), validation par le pharmacien conseil, accès du comptable
débloqué immédiatement après (liste peuplée, accès direct 200, programmation puis
paiement). Test navigateur réel (Playwright, 7/7) : les 3 écrans se chargent correctement
pour chaque rôle, liste vide confirmée visuellement côté comptable avant toute validation.
Toutes les données de test éphémères supprimées, résidu nul vérifié indépendamment.

## 2026-09-22 (suite 2) — Règle de fréquence des consultations + vérification de la
couverture tarifaire

### 1. Règle de fréquence des consultations (14 jours) — avec déblocage médecin conseil
Bloque l'ajout d'un acte dans un dossier `CONSULTATION_GENERALISTE`/
`CONSULTATION_SPECIALISTE` si un AUTRE dossier du MÊME `typeVisite` (compteurs strictement
séparés généraliste/spécialiste) existe déjà pour ce patient (adhérent XOR bénéficiaire)
dans les 14 jours, tous établissements confondus — `dateOuverture` du dossier fait foi.
Message explicite (409) avec le type et la date de la consultation précédente.

**Décision actée avant de committer** : la demande initiale prévoyait une limite dure sans
aucun recours (« contrairement à la règle des analyses/examens »), avec une invitation
explicite à objecter avant de valider. Objection soulevée et retenue : un patient peut
légitimement consulter deux fois en 14 jours pour des motifs sans rapport, et une limite
totalement sans recours risque soit de bloquer des soins légitimes, soit de pousser le
personnel à contourner la règle par une mauvaise catégorisation (ex. requalifier en
`ANALYSES_EXAMENS_MEDICAUX`), ce qui dégraderait la qualité des données bien au-delà de
cette seule règle. Un déblocage `ASSUREUR_MEDECIN_CONSEIL` au cas par cas a donc été ajouté,
symétrique à la règle anti-répétition des analyses/examens (prisma/sql/042).

**Généralisation plutôt que duplication** — la table `autorisations_repetition_acte`
(jusqu'ici scopée `(ticket_soins_id, code_acte)`) est étendue : `code_acte` devient
nullable, nouvelle colonne nullable `type_visite`, contrainte CHECK garantissant que
EXACTEMENT l'un des deux est renseigné (`prisma/sql/045_frequence_consultations.sql`). Même
concept d'autorisation à usage unique scopée à un ticket précis, réutilisé pour les deux
mécanismes plutôt que dupliqué.

Le contrôle ne s'évalue QU'AU PREMIER ACTE du ticket (aucun acte encore enregistré dessus) :
une fois la consultation admise (aucun conflit, ou déblocage consommé), les actes suivants
ajoutés à CE MÊME ticket ne redéclenchent pas la règle — ils font partie de la même visite
déjà admise. Sans cette précision, un dossier avec plusieurs actes aurait redemandé un
déblocage à chaque acte supplémentaire.

Nouveau : `PreauthorizationService.autoriserRepetitionConsultation(ticketSoinsId,
{typeVisite, motif})`, réservé EXCLUSIVEMENT à `ASSUREUR_MEDECIN_CONSEIL` (jamais
l'exploitation qui rencontre le blocage) — `POST tickets-soins/:id/actes/
autoriser-repetition-consultation`.

### 2. Couverture tarifaire des consultations — vérifiée, aucune correction nécessaire
Audit complet de la chaîne tarif conventionné : `PreauthorizationService.
simulerMontantActe` (NestJS) et `JdbcAdjudicationRepository.SQL_CONTEXTE` (microservice
Java, calcul définitif) sont tous deux **entièrement agnostiques de la catégorie d'acte** —
aucun filtre sur `categorieActe`/`ReferentielActe.categorie` nulle part dans la chaîne, ni
côté lecture du référentiel (`reference.service.ts`), ni côté création d'un tarif
conventionné (`provider.service.ts`). Le tarif conventionné plafonne déjà tout acte identifié
par un `codeActe` correspondant, y compris `CONSULTATION_GENERALISTE`/
`CONSULTATION_SPECIALISTE` — confirmé par le test HTTP réel ci-dessous. Aucun changement de
code requis pour ce point.

### Tests
Backend : 402/402 (`npx jest`, 11 nouveaux : 8 sur la règle de fréquence — blocage,
séparation des compteurs par type, ignoré hors dossiers de consultation, non
ré-déclenchement au 2e acte du même ticket, déblocage + consommation, blocage persistant
sans autorisation valable — et 3 sur `autoriserRepetitionConsultation` — création,
403 pour l'exploitation, 404 ticket introuvable). `npx tsc --noEmit` propre. Test HTTP réel
(16/16) : une patiente avec une consultation généraliste clôturée il y a 5 jours obtient
d'abord une consultation SPÉCIALISTE sans blocage (compteur séparé), puis une 2e
consultation GÉNÉRALISTE lui est bloquée (409, message avec date + type, `dossierPrecedentId`
exact) ; l'exploitation ne peut pas débloquer (403) ; le médecin conseil débloque (201) ;
la consultation généraliste repasse alors (201), l'autorisation est marquée consommée en
base ; un 2e acte ajouté ensuite au même ticket n'est pas re-bloqué (vérifie le
« premier acte seulement ») ; un référentiel d'acte + tarif conventionné (5 000 F) créés
pour un acte `CONSULTATION`, facturé à 8 000 F, donnent un montant simulé assurance de
4 000 F (5 000 × 80 %) et non 6 400 F (8 000 × 80 %) — confirme que le tarif conventionné
plafonne bien le prix de consultation avant application du taux de couverture. Toutes les
données de test éphémères supprimées, résidu nul vérifié indépendamment (0 dossier, 0
profil restants).

## 2026-09-22 (suite 3) — Contestation du médecin conseil sur les actes/hospitalisations/
analyses-examens

Même mécanisme que la contestation de prescription (`contestations_prescription`,
prisma/sql/043, 2026-09-22) réutilisé tel quel pour ce second domaine plutôt que redessiné,
comme demandé — un domaine (`contestation/`) porte désormais les deux.

### 1. `contestations_acte` (prisma/sql/046)
Même structure exacte que `contestations_prescription` (statuts, `date_limite` = fin du
mois en cours, contrainte de cohérence clôture, index d'unicité « au plus une contestation
active à la fois par acte ») mais `acte_dossier_id` au lieu de `ligne_ordonnance_id`. RLS :
lecture ouverte à tout profil avec `etablissement_id` (tout centre médical du réseau) + le
personnel ASSUREUR habilité ; écriture réservée à `ASSUREUR_MEDECIN_CONSEIL` (ouverture/
tranchage) et à `CENTRE_MEDICAL_MEDECIN/COMPTABLE/ADMINISTRATIF` de l'établissement
concerné (justification) — jamais `CENTRE_MEDICAL_ACCUEIL`, même exclusion que la caissière
côté pharmacie. Réutilise le bucket de stockage privé `contestations` déjà créé (chemins
`{contestationId}/{fichier}` — pas de collision possible, tables distinctes).

### 2-4. `ouvrirContestationActe`/`soumettreJustificationActe`/`trancherContestationActe`
Nouvelles méthodes sur le `ContestationService` existant (pas un nouveau service),
mécanique identique à leurs équivalents prescription : ouverture/tranchage réservés
EXCLUSIVEMENT à `ASSUREUR_MEDECIN_CONSEIL` ; justification réservée à l'établissement
CONCERNÉ (`acteDossier.dossier.etablissementId === ctx.etablissementId`), jamais un autre.
Acte `ANNULE` refusé (400, rien à contester). `ContexteAppelant` étendu avec
`etablissementId` (déjà nécessaire pour ce scope). Le helper `audit()` — jusqu'ici table
`contestations_prescription` codée en dur — accepte désormais un 6ᵉ paramètre `tableCible`
(défaut inchangé pour les appels existants) pour servir les deux domaines sans dupliquer la
fonction.

**Exclusion de facturation (« en_litige »)** : `PreauthorizationService.
genererFactureSelection` exclut désormais aussi tout acte sous contestation active
(nouveau `chargerActesEnLitige`, même principe que `PharmacyService.
chargerLignesEnLitige`), en plus des exclusions déjà en place (pré-autorisation en attente/
refusée, déjà réglé) — messages de réponse mis à jour pour mentionner le litige.

### 5. Écrans
Médecin conseil (`/dashboard-assureur/medecin-conseil/contestations`, nouvel écran
`MedecinConseilActesEcran`) : « Actes à examiner » (bouton Contester + lien vers le dossier
complet — nouvelle route `medecin-conseil/dossiers/[id]`, ce rôle étant déjà dans
`ROLES_LECTURE_DOSSIER_STAFF`, aucun changement API), « Contestations en cours »
(Valider/Rejeter), « Contestations traitées ». Centre médical
(`/dashboard-centre-medical/contestations`, route UNIQUE partagée par les 4 sous-rôles —
même dashboard route pour tous, `CENTRE_MEDICAL_ACCUEIL` reçoit un 403 explicite de l'API
si elle y accède) : « Contestations reçues » avec formulaire de justification + pièce
jointe (réutilise `ChampFichier`), historique.

### Tests
Backend : 426/426 (`npx jest`, 24 nouveaux : 20 sur le service de contestation d'actes —
mêmes scénarios que la contestation de prescription, adaptés — et 4 sur l'exclusion de
facturation « en litige »). `npx tsc --noEmit` propre API et Web. Test HTTP réel (17/17) sur
le scénario exact demandé, adapté aux actes : le médecin conseil voit bien le dossier
complet d'un patient (diagnostic d'entrée inclus), ouvre une contestation sur un acte
d'hospitalisation déjà réalisé, vérifie que cet acte devient explicitement exclu du montant
facturable d'un cycle de facturation par sélection (seul l'acte non contesté est retenu,
message mentionnant le litige), l'établissement soumet une justification avec fichier
(PDF réel envoyé et stocké), le médecin conseil valide, l'acte redevient normalement
facturable (les deux actes inclus au cycle suivant, montant total exact). Toutes les
données de test éphémères supprimées, résidu nul vérifié indépendamment (0 dossier, 0
profil restants).

## 2026-09-22 (suite 4) — Consolidation mensuelle des factures établissement (comptable
établissement + médecin conseil)

Miroir de la consolidation mensuelle pharmacie (`factures_mensuelles_pharmacie`,
2026-09-22 suite) réutilisé pour l'établissement (centre médical), avec une différence de
fond assumée : la vérification de fin de mois est confiée à `ASSUREUR_MEDECIN_CONSEIL`
(`VERIFIEE_MEDECIN_CONSEIL`, décision VALIDEE/A_CORRIGER) plutôt qu'au pharmacien conseil.

### 1. `factures_mensuelles_etablissement` (prisma/sql/047)
Même structure exacte que `factures_mensuelles_pharmacie` (statuts, période = 1er du mois,
contrainte de cohérence, unicité `(etablissement_id, periode)`) mais `etablissement_id` au
lieu de `pharmacie_id`, et `verifie_par_id`/`date_verification` au lieu de `valide_par_id`/
`date_validation`. Nouvelle colonne `lignes_facturation.facture_mensuelle_etablissement_id`
(même rôle que `lignes_dispensation.facture_mensuelle_id`).

**Choix structurant** : la ligne atomique agrégée est `LigneFacturation` (statut PAYE,
`date_paiement`), PAS `ActeDossier` directement — parce que `LigneFacturation.statut = PAYE`
(posé par `confirmerPaiement`, une fois le patient) EST l'équivalent exact de
`DispensationPharmacie.statut = PAYEE` côté pharmacie : le patient a déjà confirmé + réglé
son code de facturation avant que l'acte entre dans cette consolidation. Ainsi
« quel que soit leur statut de pré-autorisation individuelle passé » se vérifie
naturellement : un acte encore EN_ATTENTE_*/REFUSEE ne peut structurellement jamais avoir
de `LigneFacturation` (exclu dès `genererFactureSelection`), donc jamais atteindre PAYE —
aucune règle supplémentaire à coder pour ce point, seule l'exclusion « en litige » est
neuve à ce niveau.

### 2. `soumettreFactureMensuelleEtablissement` — CENTRE_MEDICAL_COMPTABLE/ADMINISTRATIF
uniquement (jamais MEDECIN ni ACCUEIL), toujours SON établissement
Agrège les `LigneFacturation` PAYE de la période (tous types d'actes confondus —
consultations, hospitalisations, analyses/examens), jamais déjà réclamées par une facture
mensuelle antérieure, EXCLUT celles actuellement en litige (`ContestationActe`, réutilise
`chargerActesEnLitige` déjà construit pour `genererFactureSelection`, prompt précédent).

**Résoumission après correction** : une facture `EN_PREPARATION` existante pour la même
période (issue d'un `A_CORRIGER`) est RÉUTILISÉE — jamais dupliquée — même principe que la
réattache d'une `LigneFacturation` A_PAYER orpheline déjà en place ailleurs dans ce
service ; vérifié explicitement par un test HTTP réel (même id avant/après correction).

### 3. `verifierFactureMensuelleEtablissement` — réservé EXCLUSIVEMENT à
ASSUREUR_MEDECIN_CONSEIL
Vérification globale de fin de mois, INDÉPENDANTE des validations individuelles de
pré-autorisation déjà faites pendant le mois par l'exploitation. Double sécurité explicite
identique au pharmacien conseil : ne fait AUCUNE confiance à l'agrégation faite à la
soumission, revérifie le litige à l'instant présent. `VALIDEE` → `VERIFIEE_MEDECIN_CONSEIL`
(transmission au comptable) ; `A_CORRIGER` (statut absent de l'énumération finale, comme
prévu) libère toutes les lignes stampées et remet la facture à `EN_PREPARATION` pour
resoumission après correction par l'établissement.

### 4. Verrou RLS explicite pour ASSUREUR_COMPTABLE
Même verrou que la pharmacie : aucun accès (RLS + NestJS, `obtenirFactureMensuelleEtablissement`
vérifie l'accès direct par id, pas seulement le filtre des listes) tant que le statut n'a
pas atteint `VERIFIEE_MEDECIN_CONSEIL`.

### 5. Écrans
Comptable établissement (`/dashboard-centre-medical/facture-mensuelle`) : vue d'ensemble
des actes du mois en cours (tous types, avec indicateurs « déjà facturé »/« en litige »),
bouton « Proposer la facture provisoire de [mois] », historique des factures mensuelles.
Nouvel écran séparé « Mes factures » (`/dashboard-centre-medical/mes-factures`) : TOUTES les
`FactureDossier` de l'établissement (mécanisme de facturation par sélection déjà existant),
avec 4 filtres `DataTable` COMBINABLES (société cliente, adhérent/famille, statut, période —
options dérivées dynamiquement des données reçues, filtrage 100% client-side, déjà supporté
nativement par `DataTable` sans modification du composant). Médecin conseil
(`/dashboard-assureur/medecin-conseil/factures-etablissement`) : détail ligne-par-ligne
chargé en une fois (file naturellement petite, même pattern que côté pharmacien conseil),
boutons Valider/À corriger, et bouton « Contester » directement sur chaque ligne du détail
(réutilise `ouvrirContestationActe`, prompt précédent, sans dupliquer le mécanisme).
Comptable assureur (`/dashboard-assureur/{comptable,comptable-adjoint}/factures-etablissement`,
composant partagé, nouvelle entrée `navComptable`) : « Factures établissements prêtes à
programmer » — vide tant qu'aucune n'est vérifiée, boutons Programmer/Marquer payée.

### Tests
Backend : 454/454 (`npx jest`, 28 nouveaux : 8 `soumettreFactureMensuelleEtablissement`
(dont réutilisation après correction), 6 `verifierFactureMensuelleEtablissement` (VALIDEE
et A_CORRIGER), 4 `programmer`/`marquerPayee`, 5 verrou d'accès
`obtenirFactureMensuelleEtablissement`, 2 `listerActesDuMoisEtablissement`, 3
`listerFacturesDossierEtablissement` — horloge figée, `jest.useFakeTimers`, pour un mois
précédent déterministe). `npx tsc --noEmit` propre API et Web. Test HTTP réel (30/30) sur
le scénario complet demandé : vue d'ensemble des 3 actes du mois en cours, liste « Mes
factures » avec 2 sociétés clientes distinctes et un patient nommé (vérifie les champs
nécessaires au filtre multicritère), le médecin conseil met un acte en litige, soumission
de la facture mensuelle — montant exact (35 000 F, l'acte en litige à 9 000 F exclu
automatiquement), un rôle non habilité ne peut pas vérifier (403), le médecin conseil
renvoie À CORRIGER (retour à EN_PREPARATION, lignes libérées), resoumission — confirmé
même id (pas de doublon), le comptable assureur ne voit rien tant que non vérifiée (liste
vide, accès direct 403), le médecin conseil valide, le comptable assureur voit la facture
(accès direct 200, 2 lignes), programmation puis paiement. Toutes les données de test
éphémères supprimées, résidu nul vérifié indépendamment (0 dossier, 0 profil, 0 adhérent
éphémère restants).

Cette étape clôt le circuit de consolidation mensuelle des deux familles d'acteurs de soins
(pharmacie et établissement) prévu depuis le plan directeur — même principe, même circuit à
trois niveaux (soumission → vérification médicale/pharmaceutique → paiement assureur) pour
les deux domaines.

## 2026-09-22 (suite 5) — Étend les factures mensuelles établissement/pharmacie : revue
comptable globale, décochage de ligne contestée, paiements groupés

### 1. ASSUREUR_COMPTABLE lit désormais TOUTES les factures mensuelles
Le verrou par statut (`VERIFIEE_MEDECIN_CONSEIL`/`VALIDEE_PHARMACIEN_CONSEIL` et au-delà)
est retiré de la LECTURE pour ce rôle — accès en revue global, organisation entière, tout
statut, RLS ET NestJS alignés (migration prisma/sql/048). Le détail ligne-par-ligne
(`obtenirFactureMensuelle(Etablissement)`) renvoie désormais explicitement `enLitige` par
ligne. La lecture des établissements/pharmacies eux-mêmes et du médecin/pharmacien conseil
reste inchangée (déjà organisation entière ou propre périmètre).

### 2. `decocherLigneContestee(factureMensuelleId, ligneId)` — réservé EXCLUSIVEMENT à
ASSUREUR_COMPTABLE
Retire manuellement une ligne ENCORE EN LITIGE d'une facture SOUMISE ou déjà
VERIFIEE_MEDECIN_CONSEIL/VALIDEE_PHARMACIEN_CONSEIL (jamais après — l'argent n'est pas
encore engagé), recalcule `montantTotal`, incrémente `nbLignesReportees`. La ligne retirée
est marquée `reportee_mois_suivant = true` (nouvelle colonne sur `lignes_facturation`/
`lignes_dispensation`) : la PROCHAINE soumission (`soumettreFactureMensuelle(Etablissement)`,
requête étendue avec un `OR reportee_mois_suivant = true` en plus de la fenêtre du mois)
la reprend automatiquement — **dès que son litige n'est plus actif** (VALIDEE), sinon elle
reste reportée indéfiniment ; si REJETEE, `STATUTS_CONTESTATION_EN_LITIGE` l'exclut déjà
pour toujours, aucune règle supplémentaire nécessaire. Vérifié en HTTP réel via le
mécanisme `A_CORRIGER` (remet la facture à EN_PREPARATION, seul état qui autorise une
resoumission pour la même période — sans manipulation de l'horloge système, la
réintégration ne dépend que du flag et du statut de litige, jamais de la date).

### 3. `validerPourPaiement(Etablissement)` remplace `programmerPaiementFactureMensuelle(Etablissement)`
Même transition (VERIFIEE_MEDECIN_CONSEIL/VALIDEE_PHARMACIEN_CONSEIL → PROGRAMMEE_PAIEMENT),
mais avec la garde manquante ajoutée : refuse (409, détail des actes/lignes concernés) si
UNE SEULE ligne en litige non décochée subsiste. Renommage délibéré plutôt qu'un endpoint
parallèle : garder l'ancien nom aurait laissé un contournement de cette garde. Écrans et
actions existants mis à jour (bouton « Valider pour paiement »).

### 4. `payment/` — nouveau module (déjà prévu dans l'architecture v18, jamais construit)
`paiements_groupes` + `paiements_groupes_factures` (liaison à cible exclusive établissement
XOR pharmacie, même motif que `AutorisationRepetitionActe`) : `associerFacturesPourPaiement`
regroupe plusieurs factures PROGRAMMEE_PAIEMENT du MÊME bénéficiaire (jamais mélangées) en
un paiement unique (montant sommé, `date_programmee`) ; `marquerPaiementGroupePaye` cascade
PAYEE + `date_paiement` sur toutes les factures liées. Une facture déjà groupée refuse
désormais `marquerFactureMensuellePayee(Etablissement)` individuellement (message dirigeant
vers le groupe). `listerFacturesPourComptableGlobal` unifie établissement + pharmacie en
une liste dénormalisée (société/patient/catégorie d'acte distincts par facture, calculés
depuis les lignes) pour un filtrage 100% client-side, même convention que `MesFacturesEcran`.

### 5. Écran comptable — Suivi des paiements
Nouvel écran global (`/dashboard-assureur/{comptable,comptable-adjoint}/paiements`) :
5 tableaux (Factures du mois = période la plus récente ; En paiement = PROGRAMMEE_PAIEMENT,
avec sélection multiple + regroupement ; Partiellement réglées = PAYEE avec
`nbLignesReportees > 0` ; Impayées = tout le reste avant paiement ; Réglées = PAYEE sans
reportée) avec 5 filtres combinables (bénéficiaire, société, type d'acte, adhérent/famille,
période) appliqués côté client puis répercutés sur un diagramme `recharts` (montant total
par période, selon les MÊMES filtres actifs). Détail à la demande (jamais pré-chargé pour
toutes les factures) avec bouton Décocher par ligne en litige. Paiements groupés listés en
bas avec action Marquer payé. `recharts` n'était PAS déjà une dépendance du projet malgré
la mention — installée pour ce prompt (`npm install recharts`, apps/web).

### Tests
Backend : 484/484 (`npx jest`, 30 nouveaux : 7+5 `decocherLigneContestee`
(pharmacie/établissement), 6+3 renommage/durcissement `validerPourPaiement`, 13 module
`payment` (regroupement, cascade paiement, vue globale), tests de réintégration
adaptés dans les deux specs de consolidation mensuelle). `npx tsc --noEmit` propre API et
Web. Test HTTP réel (30/30) sur le scénario exact demandé : une ligne mise en litige APRÈS
soumission bloque la vérification (409) ; le comptable la décoche (montant recalculé,
refuse de décocher une ligne saine en 400) ; la vérification est alors débloquée
(A_CORRIGER accepté) ; la contestation est tranchée VALIDEE ; la resoumission de LA MÊME
facture réintègre automatiquement la ligne reportée (même id, montant complet, 3 lignes) ;
vérification puis validation pour paiement ; regroupement de cette facture avec une
seconde du même établissement en un paiement unique (montant sommé, refuse une facture
déjà groupée en 409) ; marquage payé du groupe cascadé sur les 2 factures ; vue globale
ASSUREUR_COMPTABLE confirmée. Toutes les données de test éphémères supprimées, résidu nul
vérifié indépendamment (0 dossier, 0 facture mensuelle, 0 paiement groupé, 0 profil
restants).

## 2026-09-23 — Socle des comptes financiers de l'assureur (trésorerie interne)

Ajouté au module `payment/` (comptes bancaires + caisses internes — le même domaine que
les paiements groupés, qui EN dépendent conceptuellement) plutôt qu'un nouveau module,
pour éviter de fragmenter davantage un périmètre déjà cohérent.

### Piège d'héritage explicitement évité (leçon appliquée, pas seulement citée)
La demande était explicite : réservé à ASSUREUR_COMPTABLE, JAMAIS son adjoint. Or
`profil_a_role()` (RLS) ET `IdentityService.resoudreChaineRoles`/`roleChain` (NestJS)
remontent TOUS DEUX un rôle adjoint vers son `role_parent_code` — `ASSUREUR_COMPTABLE_
ADJOINT` a donc `'ASSUREUR_COMPTABLE'` dans son PROPRE `roleChain`. C'est un comportement
VOULU et déjà exploité ailleurs (factures mensuelles, paiements groupés : commentaire
existant « ASSUREUR_COMPTABLE_ADJOINT par héritage, profil_a_role résout un niveau de
parent »). Ici, `ctx.roleChain.includes('ASSUREUR_COMPTABLE')` aurait donc laissé passer
l'adjoint MALGRÉ l'intention. Corrigé par une comparaison sur le rôle EXACT et non résolu :
`ctx.role` côté NestJS (`profils.role` brut, pas la chaîne), `p.role = 'ASSUREUR_COMPTABLE'`
côté RLS (jamais `profil_a_role`). `permissions.peutValider` écarté aussi : capacité
générique par rôle, propre à d'autres écrans (accueil, produits, utilisateurs…), sans
rapport avec ce périmètre précis. `ROLES_GESTION_COMPTES_FINANCIERS` (payment.types.ts)
documente ce choix pour éviter de reproduire l'erreur.

### 1. `comptes_financiers` (prisma/sql/049)
`type` BANCAIRE/CAISSE_INTERNE, `banque_nom`/`numero_compte` nullables, `solde_actuel`,
`cree_par`. RLS lecture ET écriture toutes deux verrouillées sur le rôle exact (pas de
lecture élargie à ASSUREUR_INFORMATIQUE ici, contrairement aux factures mensuelles/
paiements groupés — l'énoncé demandait une réserve totale, pas seulement sur l'écriture).

### 2. `creerCompteFinancier(type, nom, fondsInitial)`
Crée le compte avec son solde de départ, journalise via `log_audit()` (table cible
`comptes_financiers`, paramètre ajouté à `PaymentService.audit()` — jusque-là câblé en dur
sur `paiements_groupes`).

### 3. `approvisionnerCompte(compteId, montant, source, compteSourceId?, piecesJustificatives?)`
Augmente le solde du compte cible. Si `source = 'AUTRE_COMPTE'` : exige `compteSourceId`,
refuse l'auto-approvisionnement, vérifie un solde source suffisant (409 sinon — sans cette
garde un compte pourrait passer négatif sans qu'aucune règle du prompt ne l'autorise), puis
CRÉDITE la cible ET DÉBITE la source dans la MÊME transaction Prisma (les deux mouvements
réussissent ou échouent ensemble — jamais d'argent créé de nulle part). `piecesJustificatives`
et `source`/`compteSourceId` sont journalisés en détail dans `log_audit()` (pas de table de
mouvements séparée : non demandée, l'audit log fait office d'historique, cohérent avec la
règle transverse « toute écriture d'audit passe par log_audit() »).

### 4. Écran `/dashboard-assureur/comptable/comptes-financiers`
Liste + création + approvisionnement (formulaire avec champ dynamique : sélecteur de
compte source affiché uniquement si la source choisie est « Un autre compte »), solde
recalculé immédiatement après chaque action (`router.refresh()`). Lien de navigation
ajouté SEULEMENT à l'entrée `[COMPTABLE]` de `dashboard-nav.ts`, jamais à
`[COMPTABLE_ADJOINT]` (qui partage par ailleurs la même fonction `navComptable()`) —
l'adjoint ne voit même pas le lien, cohérent avec le 403 qu'il obtiendrait de toute façon.

### Tests
Backend : 499/499 (`npx jest`, 28 nouveaux : dont 6 tests dédiés au piège d'héritage —
`ASSUREUR_COMPTABLE_ADJOINT` avec un `roleChain` simulé fidèlement à
`IdentityService.resoudreChaineRoles` (incluant bien le parent hérité) pour prouver que le
test aurait échoué avec une implémentation basée sur `roleChain.includes(...)`, plus les
cas 404/400/409 d'`approvisionnerCompte`). `npx tsc --noEmit` propre API et Web. Test HTTP
réel (15/15) sur le scénario exact demandé : création d'un compte bancaire avec fonds
initial (100 000 F), approvisionnement externe (+50 000 F, 150 000 F), création d'une
caisse interne (40 000 F), approvisionnement du compte bancaire DEPUIS la caisse (+20 000 F,
170 000 F) avec débit simultané vérifié en relisant la liste (caisse à 20 000 F) ET
directement en base, puis `ASSUREUR_COMPTABLE_ADJOINT` refusé (403) sur la création, les
deux formes d'approvisionnement, ET la simple lecture de la liste. Toutes les données de
test éphémères supprimées, résidu nul vérifié indépendamment (0 compte financier, 0 profil
restants).

## 2026-09-23 (suite) — Mouvements entre comptes financiers + suivi des dépenses courantes

Étend le socle des comptes financiers (ci-dessus) avec la table de mouvements : même
périmètre EXCLUSIF (`ASSUREUR_COMPTABLE`, jamais l'adjoint, comparaison sur le rôle exact).

### 1. `mouvements_financiers` (prisma/sql/050) — table d'audit IMMUABLE
`compte_source_id`/`compte_destination_id` nullables selon `type` (contrainte SQL
`mouvements_financiers_comptes_coherents` : TRANSFERT exige les deux, DEPENSE et
PAIEMENT_FACTURE la source seule, APPROVISIONNEMENT la destination seule), plus une
contrainte anti-auto-transfert (`compte_source_id is distinct from compte_destination_id`).
RLS lecture identique à `comptes_financiers` (rôle exact) ; écriture en `for insert`
seulement (jamais `for all`) — cohérent avec « jamais modifiée après création, seulement
des insertions », RLS et application interdisent toutes deux l'update/delete. `organisation_id`
ajouté à la table bien que non listé explicitement dans la demande : nécessaire pour scoper
la RLS et cohérent avec la règle transverse déjà appliquée à toutes les tables sensibles du
projet. Bucket Storage privé dédié `mouvements-financiers` (même schéma que `contestations`/
`cartes`) pour les pièces jointes (chèque/reçu, PDF/JPEG/PNG, 10 Mo max) — le champ
`piece_jointe_url` stocke en réalité le CHEMIN dans le bucket, jamais une URL, signée à la
demande (`GET payment/mouvements/:id/piece`, durée limitée) : même principe que
`pieces_justificatives` des contestations, jamais d'URL permanente en base.

`type` accepte aussi `APPROVISIONNEMENT` et `PAIEMENT_FACTURE` (demandés dans l'énoncé de la
table) : `approvisionnerCompte` (déjà existant, prompt précédent) a été étendu pour y écrire
également un mouvement — sinon l'historique par compte aurait un trou sur son propre mode de
financement, alors que la table venait justement d'être conçue pour ça. `PAIEMENT_FACTURE`
reste défini mais non émis : `marquerPaiementGroupePaye` ne débite aujourd'hui aucun compte
financier (aucun lien entre les deux domaines n'a été demandé) — réservé à une intégration
future plutôt qu'inventé ici.

### 2. `transfererEntreComptes(compteSourceId, compteDestinationId, montant, description?, pieceJointe?)`
Débite la source et crédite la destination dans LA MÊME transaction Prisma, refuse (409,
message explicite avec le nom du compte et le solde disponible) si le solde source est
insuffisant — vérifié AVANT toute écriture, aucun mouvement partiel possible. Rejette aussi
compte source = compte destination (400) et un UUID mal formé (400, évite une erreur
Postgres brute puisque ces champs arrivent en `multipart/form-data`, jamais validés par
class-validator sur cette route — voir point 4). `description` n'était pas dans la signature
demandée pour cette fonction (contrairement à `enregistrerDepense`) alors que la table
l'exige : rendue optionnelle, auto-générée (« Transfert de « X » vers « Y ».») si omise.

### 3. `enregistrerDepense(compteId, montant, description, pieceJointe?)`
Débite un compte (bancaire ou caisse interne), refuse (409) si le solde est insuffisant —
jamais de compte négatif par cette voie. `description` requise (min. 3 caractères, 400
sinon), conforme à la signature demandée.

### 4. Upload réel (multipart) — extension du mécanisme déjà en place pour les contestations
`FileInterceptor('pieceJointe')` sur les deux routes POST ; champs texte extraits
individuellement via `@Body('champ')` plutôt qu'un DTO `class-validator`, même convention
que `ContestationController` (un DTO de classe n'est pas fiable sur une requête multipart où
tous les champs arrivent en `string`). Validation manuelle côté service : UUID (regex),
montant (`Decimal`, > 0), description. Mime autorisés PDF/JPEG/PNG, 10 Mo max (mêmes limites
que les contestations).

### 5. Écran `/dashboard-assureur/comptable/mouvements-financiers`
Deux formulaires d'action (Nouveau transfert, Nouvelle dépense — sélecteurs de comptes avec
solde affiché, champ fichier facultatif) + tableau d'historique avec filtres multicritères
100% client-side (compte, type, période du/au, montant min/max — même approche que l'écran
« Suivi des paiements » du prompt précédent : pas de filtres serveur, la table est petite et
déjà chargée). Quand un compte précis est filtré, une colonne « Solde après » reconstitue le
solde du compte à l'issue de CHAQUE mouvement en partant de son solde actuel et en défaisant
les mouvements du plus récent au plus ancien — masquée quand le filtre est sur « tous les
comptes » (un solde courant unique n'a pas de sens en mélangeant plusieurs comptes). Lien de
navigation ajouté seulement à `[COMPTABLE]`, jamais `[COMPTABLE_ADJOINT]`, même asymétrie que
« Comptes financiers ».

### Tests
Backend : 55 tests sur `payment.service.spec.ts` (27 nouveaux), suite complète 526/526.
Piège d'héritage revérifié sur les 2 nouvelles fonctions ET sur `listerMouvementsFinanciers`/
`obtenirUrlPieceJointeMouvement` avec le même helper `comptableAdjoint()`. `npx tsc --noEmit`
propre API et Web. Test HTTP réel (16/16) : transfert de 30 000 F entre 2 comptes fraîchement
créés (soldes 70 000 F / 50 000 F vérifiés en relisant la liste — atomicité confirmée),
dépense de 5 000 F avec une pièce jointe PDF réellement téléversée (présence confirmée via
`aUnePieceJointe` puis URL signée obtenue), tentative de transfert de 999 999 F (solde
disponible 70 000 F) refusée en 409 avec message explicite, solde inchangé après le refus,
plus en bonus `ASSUREUR_COMPTABLE_ADJOINT` refusé (403) sur le transfert ET la lecture de
l'historique. Toutes les données de test éphémères supprimées, résidu nul vérifié
indépendamment (0 mouvement, 0 compte financier, 0 profil restants).

## 2026-09-23 (suite 2) — Paiement RÉEL des factures établissement/pharmacie relié aux comptes financiers

Point de convergence le plus sensible du système jusqu'ici : jusqu'à ce prompt, « marquer
payée/payé » (factures individuelles, `preauthorization`/`pharmacy`, ou groupes,
`payment`) ne débitait RIEN — statut symbolique uniquement, aucune trace financière réelle.
`payerFacture` (module `payment/`) remplace intégralement ces trois anciens endpoints
symboliques (`marquerFactureMensuelleEtablissementPayee`, `marquerFactureMensuellePayee`,
`marquerPaiementGroupePaye` — tous retirés, backend ET frontend, pour ne laisser aucun
chemin de paiement fictif actif à côté du paiement réel) par un point d'entrée unique,
`factureMensuelleId` OU `paiementGroupeId`.

### Rôle : périmètre EXCLUSIF (rôle exact), pas celui du reste du circuit de facturation
Choisir un compte à débiter est un acte de TRÉSORERIE, pas une étape du circuit de
facturation — `payerFacture` est donc réservé au rôle EXACT `ASSUREUR_COMPTABLE`
(`assertGestionComptesFinanciers`, JAMAIS l'adjoint), contrairement à
`validerPourPaiement`/`associerFacturesPourPaiement` du même domaine qui restent
accessibles à l'adjoint par héritage (`roleChain`, décision assumée des prompts
précédents). Conséquence assumée côté écran « Suivi des paiements » : la page de
`comptable-adjoint` reçoit une liste de comptes financiers vide (403 attendu sur
`GET payment/comptes-financiers`, silencieux — pas une erreur de page), donc aucun compte
à choisir dans le formulaire de paiement ; l'adjoint garde consultation/validation/
regroupement, jamais le débit réel lui-même.

### 1. Nouveaux statuts (communs aux 3 tables : factures établissement/pharmacie, groupes)
- `PARTIELLEMENT_REGLEE` : paiement réel partiel déjà effectué (`montantPaye` < `montantTotal`,
  factures individuelles uniquement — jamais un groupe, qui se paie toujours intégralement).
  Distinct de l'existant « payée avec lignes reportées » (`nbLignesReportees`, litige) —
  section renommée dans l'écran pour éviter la confusion entre les deux notions de
  « partiellement réglée ».
- `PAIEMENT_PROGRAMME` : paiement réel programmé à une date future — RIEN n'est débité
  tant que non confirmé. 4 nouvelles colonnes portent l'intention en attente
  (`paiementProgrammeCompteId/Montant/Preuves/Date` — pas de nouvelle table : un seul
  paiement programmé possible à la fois par facture/groupe, cohérent avec les colonnes
  déjà existantes `dateProgrammation`/`datePaiement` du même style).
Migration 051 : `montant_paye` ajouté (défaut 0), contraintes `statut_check` et
`*_coherente` étendues (les 2 nouveaux statuts exigent les mêmes `date_soumission`/
`verifie_par_id`/`date_verification` que `VERIFIEE_MEDECIN_CONSEIL` et au-delà), policy RLS
`ecriture_comptable` étendue aux 2 nouveaux statuts sur les 3 tables.

### 2. `payerFacture(factureMensuelleId | paiementGroupeId, compteId, montant?, dateProgrammee?, preuvePaiement?)`
Un seul endpoint pour les DEUX étapes « programmer » et « confirmer » — pas de deuxième
endpoint séparé : rappeler `payerFacture` (mêmes identifiants) sur une facture/un groupe
déjà `PAIEMENT_PROGRAMME`, SANS nouvelle `dateProgrammee`, confirme et exécute le débit réel
maintenant (avec re-vérification fraîche du solde — il a pu changer depuis la
programmation) ; avec une nouvelle date future, reprogramme. `factureMensuelleId` est
cherché dans `factures_mensuelles_etablissement` PUIS `factures_mensuelles_pharmacie` (pas
de discriminant de type demandé dans la signature — collision UUID entre les deux tables
statistiquement impossible).
- **Facture individuelle** : statuts acceptés `PROGRAMMEE_PAIEMENT`/`PAIEMENT_PROGRAMME`/
  `PARTIELLEMENT_REGLEE` (le dernier permet des paiements partiels successifs jusqu'à solde
  nul) ; refuse (409) si déjà intégrée à un paiement groupé — payer le groupe plutôt,
  même garde que l'ancien `marquerFactureMensuelle(Etablissement)Payee`. `montant` omis =
  solde restant dû (`montantTotal - montantPaye`) ; fourni et `> restant` → 400. Paiement
  intégral → `PAYEE` + `datePaiement` ; partiel → `PARTIELLEMENT_REGLEE`, `montantPaye`
  incrémenté, `montantRestant` recalculé et exposé.
- **Paiement groupé** : statuts acceptés `PROGRAMME`/`PAIEMENT_PROGRAMME` ; toujours
  intégral (`montant` fourni doit égaler `montantTotal` du groupe, sinon 400 — jamais de
  distribution partielle entre les factures d'un groupe, non demandée) ; cascade `PAYEE` +
  `montantPaye = montantTotal` sur CHAQUE facture membre (établissement et/ou pharmacie),
  même mécanisme que l'ancien `marquerPaiementGroupePaye`.
- Dans les deux cas, si `dateProgrammee` absente ou déjà passée : débite le compte ET crée
  le `mouvementFinancier` (`type: 'PAIEMENT_FACTURE'`, réservé à cet usage dans le schéma
  des mouvements financiers depuis le prompt précédent) dans LA MÊME transaction Prisma que
  la mise à jour de statut — jamais l'un sans l'autre. Solde insuffisant → 409 explicite,
  AUCUNE écriture (vérifié avant toute mutation).
- `approvisionnerCompte` (existant) inchangé ; `PAIEMENT_FACTURE` reste le seul type de
  mouvement émis par ce prompt — `APPROVISIONNEMENT` continue d'être émis par
  `approvisionnerCompte` seul.

### 3. Frontend
Nouveau composant partagé `PaiementFactureForm` (compte à débiter, montant facultatif,
date de programmation facultative, références de paiement facultatives) branché à 3
endroits qui affichaient auparavant un bouton « Marquer payé(e) » symbolique : les tableaux
« Paiements groupés » et factures individuelles de l'écran global « Suivi des paiements »,
et — remplacé par un simple texte renvoyant vers cet écran — les deux écrans par domaine
`factures-etablissement-comptable-ecran`/`factures-pharmacie-comptable-ecran` (évite de
dupliquer 3 fois la logique de sélection de compte). Nouvelles sections dans l'écran
global : « Paiements programmés (à confirmer) », « Réglées partiellement (paiement réel) » ;
section existante renommée « Payées avec report » pour la distinguer du nouveau statut
`PARTIELLEMENT_REGLEE`.

### Tests
Backend : 74 tests sur `payment.service.spec.ts` (dont le piège d'héritage revérifié sur
`payerFacture` — `ASSUREUR_COMPTABLE_ADJOINT` refusé même via son `roleChain` hérité),
suite complète 540/540. `npx tsc --noEmit` propre API et Web. Test HTTP réel (20/20) sur le
scénario exact demandé avec montants vérifiés à l'exact : compte à 500 000 F, facture de
120 000 F payée → compte à 380 000,00 F EXACTEMENT, mouvement tracé à 120 000,00 F pile,
facture PAYEE ; paiement programmé à une date future sur une 2ᵉ facture (20 000 F) —
solde et nombre de mouvements INCHANGÉS après la simple programmation, débité (360 000,00 F)
et facture PAYEE SEULEMENT après un second appel de confirmation ; tentative de paiement
d'une 3ᵉ facture dépassant le solde disponible → 409 explicite, solde et statut de la
facture strictement inchangés (aucune déduction partielle). Toutes les données de test
éphémères supprimées, résidu nul vérifié indépendamment (0 facture, 0 compte financier,
0 profil, 0 mouvement restants).

## 2026-09-23 (suite 3) — Vérification étanchéité adjoint, extension provisioning/tarification, coupure de facturation mensuelle — FIN DE L'ÉTAPE « trésorerie de l'assureur »

Clôture l'arc des 4 prompts précédents (comptes financiers → mouvements/dépenses →
paiement réel → cette vérification/extension finale). Quatre volets indépendants.

### 1. Vérification HTTP réelle (pas seulement lecture de code) de l'étanchéité adjoint
Même exigence qu'au Prompt B (comptes financiers) : test HTTP réel, comptes/facture RÉELS
préparés par un ASSUREUR_COMPTABLE titulaire, puis les 5 actions tentées par
`ASSUREUR_COMPTABLE_ADJOINT` sur ces MÊMES ressources — `creerCompteFinancier`,
`approvisionnerCompte`, `transfererEntreComptes`, `enregistrerDepense`, `payerFacture`.
13/13 vérifications : les 5 actions refusées en 403, ET vérification indépendante en base
qu'aucune des tentatives n'a eu le moindre effet (soldes inchangés, facture toujours
PROGRAMMEE_PAIEMENT, aucun compte créé par l'adjoint, aucun mouvement financier créé).

### 2. Provisioning/tenant : périmètres distincts pour ASSUREUR_COMPTABLE
`ROLES_GESTION_SOUSCRIPTEUR` (tenant.types.ts) étendu à ASSUREUR_COMPTABLE — peut désormais
`creerSouscripteur`. Pas de nouvelle ligne `regles_provisioning` : cette table gouverne la
création de COMPTES UTILISATEUR (rôles/profils), pas la création d'entités métier comme un
souscripteur — l'ajouter là n'aurait eu aucun effet ; le vrai mécanisme est le `roleChain`
vérifié dans `TenantService.assertGestion()`, désormais étendu, plus la policy RLS
`souscripteurs_modif` (prisma/sql/052, défense en profondeur).

Découverte en creusant `grilles_tarifaires` : `ROLES_GESTION_BILLING` (billing.types.ts)
incluait DÉJÀ ASSUREUR_COMPTABLE pour la création de grilles — en contradiction directe
avec l'énoncé (« reste exclusif à ASSUREUR_INFORMATIQUE »). Corrigé en scindant en deux
constantes : `ROLES_GESTION_BILLING` (cotisations, paiements — ASSUREUR_COMPTABLE +
ASSUREUR_INFORMATIQUE, inchangé) et la nouvelle `ROLES_GESTION_GRILLES_TARIFAIRES`
(ASSUREUR_INFORMATIQUE SEUL), cette dernière appliquée à `creerGrille` via un nouveau
`assertGestionGrilles()`. RLS `grilles_tarifaires_ecriture` alignée (retrait de
ASSUREUR_COMPTABLE). `tarifs_conventionnes` (provider/) était déjà exclusif à
ASSUREUR_INFORMATIQUE (RLS ET NestJS) — vérifié, rien à changer.

### 3. Coupure de facturation mensuelle — `genererCotisationsPeriode` (billing/)
`Adherent` (prisma/sql/052) gagne `dateValidation`/`valideParId` — AUCUN champ équivalent
sur `Beneficiaire` (jamais de coupure sur les bénéficiaires, cohérent avec l'énoncé).
Nouvelle méthode `AdherentService.validerAdherent()`, réservée EXCLUSIVEMENT à
ASSUREUR_EXPLOITATION (`ROLE_VALIDATION_ADHERENT`) — jamais DIRECTION/INFORMATIQUE, qui
peuvent pourtant CRÉER l'adhérent (`ROLES_GESTION_MEMBRE`) : la création et la validation
sont deux étapes distinctes, cette dernière gouvernant désormais la facturation. Bouton
« Valider cet adhérent » ajouté à l'écran détail adhérent existant (sinon la règle aurait
été inutilisable en pratique) — visible uniquement si `peutValiderAdherent` (nouveau helper
`lib/member.ts`, distinct de `peutGererMembres`).

`genererCotisationsPeriode` : pour chaque adhérent demandé, si `dateValidation` absente ou
`>= premierJourDuMois(periode)`, la ligne est REPORTÉE (`reportee: true` dans le résultat,
compteur `reportees`) — aucune cotisation créée pour ce mois, sans faire échouer le reste du
lot. Le même adhérent redemandé pour le mois suivant est généré normalement dès que sa date
de validation est antérieure à CE nouveau 1er du mois — pas de mécanisme de report actif à
construire, la coupure se réévalue simplement à chaque appel.

### 4. Écran « Facturation sociétés » (comptable + comptable-adjoint)
Deux nouvelles méthodes billing/ : `listerAdherentsPourFacturation(souscripteurId, periode)`
(adhérents PRINCIPAUX validés avant la coupure, âge et `nbBeneficiaires` calculés à la
demande — reflète l'ÉTAT ACTUEL des bénéficiaires, jamais soumis à la coupure) et
`consoliderFacturationSociete(souscripteurId, periode)` (« Consolider et valider la facture
société ») qui réutilise TEL QUEL `genererCotisationsPeriode` en lui passant la liste déjà
filtrée des adhérents éligibles (la coupure n'est écrite qu'une fois, jamais dupliquée),
puis crée UNE `Cotisation` consolidée au niveau société (`societeId` renseigné, `adherentId`
null — même principe « exactement l'un des deux » que `PaiementGroupeFacture`) sommant leurs
montants. Écran `/dashboard-assureur/{comptable,comptable-adjoint}/facturation-societes` :
sélecteur société + mois, tableau des adhérents éligibles, bouton de consolidation.

### Tests
Backend : +21 tests billing (`creerGrille` exclusion, coupure sur `genererCotisationsPeriode`
dans les 3 cas — avant/après/jamais validé —, `listerAdherentsPourFacturation`,
`consoliderFacturationSociete`), +5 tests `validerAdherent` (adherent.service.spec.ts), +1
test tenant (ASSUREUR_COMPTABLE crée un souscripteur), 1 test existant corrigé (attendait à
tort un refus pour ASSUREUR_COMPTABLE). Suite complète 562/562. `npx tsc --noEmit` propre
API et Web. Deux scripts HTTP réels : (a) étanchéité adjoint, 13/13 — cf. §1 ; (b) coupure de
facturation, 16/16 — bonus provisioning (comptable crée un souscripteur, refusé sur une
grille tarifaire), adhérent validé le 2 du mois absent de la facturation du mois courant
puis présent le mois suivant, bénéficiaire ajouté en cours de mois immédiatement reflété
(`nbBeneficiaires`), coupure brute vérifiée sur `genererCotisationsPeriode` (reporté puis
généré le mois suivant), consolidation société passant de 1 à 2 adhérents facturés d'un
mois à l'autre. Toutes les données de test éphémères supprimées, résidu nul vérifié
indépendamment sur les deux scripts.

## 2026-09-23 (suite 4) — Import en masse d'adhérents depuis Excel

Nouveau module `member/import-adherents.service.ts` (même module que `AdherentService`/
`MemberCarteService` — un domaine métier strict) pour une société cliente déjà créée avec
sa police/formule établie.

### Bibliothèque de parsing Excel — écartée `xlsx` (SheetJS) au profit d'`exceljs`
`xlsx` était le choix évident mais `npm audit` révèle deux vulnérabilités HIGH connues
(Prototype Pollution, ReDoS) sur le paquet npm officiel — inacceptable pour parser un
fichier envoyé par un utilisateur (surface d'attaque directe). Remplacé par `exceljs`
(seule vulnérabilité : modérée, sur un chemin de code — buffer explicite fourni à `uuid` —
jamais emprunté ici).

### 1. `importerAdherentsExcel(souscripteurId, fichier)` — réservé ASSUREUR_INFORMATIQUE/ASSUREUR_COMPTABLE
Parse le .xlsx (colonnes nom/prénom/téléphone/email/date de naissance — en-têtes reconnus
avec ou sans accents/espaces/tirets). La police/formule est déterminée par le
`souscripteurId` choisi, jamais répétée ligne par ligne. **N'écrit AUCUN `Adherent`** —
persiste un `ImportAdherents` en `EN_ATTENTE_VALIDATION` avec `lignesValides` (JSON, prêtes
à créer) et `erreursDetail` (JSON, une entrée précise par ligne rejetée : numéro de ligne,
données brutes, liste des erreurs) — jamais un fichier bloquant : les lignes valides
avancent, les autres sont listées sans interrompre l'import.

Erreurs détectées : champ obligatoire manquant (nom/prénom/téléphone/email/date de
naissance), email invalide (`class-validator` `isEmail`, déjà une dépendance — pas de
nouvelle lib pour ça), téléphone invalide (regex permissive 8-15 chiffres, +optionnel),
date de naissance illisible (ISO ou JJ/MM/AAAA, ou cellule Excel déjà typée Date). Email en
doublon vérifié à DEUX niveaux : **dans le fichier** (toutes les lignes partageant un même
email sont rejetées — impossible de deviner laquelle est la bonne) ET **contre les
adhérents déjà existants** de l'organisation entière.

Le schéma (`Adherent`) gagne `email` (unique quand renseigné) et `telephone` — et `sexe`
devient NULLABLE : les 5 colonnes demandées n'incluent pas le sexe, un champ jusque-là
`not null`. Reste requis pour la création manuelle (`CreateAdherentDto`, inchangée) ; usage
backend de `.sexe` vérifié étroit (4 occurrences, toutes dans `adherent.service.ts`) avant
de changer la contrainte — risque de régression jugé faible.

### 2. `imports_adherents` (prisma/sql/053)
`souscripteur_id`, `fichier_nom`, `statut` EN_ATTENTE_VALIDATION/VALIDE/REJETE (ce dernier
défini pour le schéma, non câblé à une action — aucun endpoint de rejet demandé),
`nb_lignes_*`, `lignes_valides`/`erreurs_detail` en jsonb, `importe_par`/`valide_par`+
`date_validation`. RLS scindée en 3 policies (lecture : les 3 rôles concernés ; insertion :
INFORMATIQUE/COMPTABLE seuls ; mise à jour/validation : INFORMATIQUE/EXPLOITATION seuls) —
pas de `regles_provisioning` : cette table gouverne un import métier, pas la création d'un
compte utilisateur.

### 3. `validerImportAdherents(importId)` — réservé ASSUREUR_INFORMATIQUE/ASSUREUR_EXPLOITATION
Seul moment où les `Adherent` réels sont créés — numéro chronologique via la séquence déjà
existante (`adherents_numero_seq`, inchangée), carte générée en réutilisant TEL QUEL
`MemberCarteService.genererCarteAdherent` (aucune duplication de la génération PDF/QR/
Storage). Un échec ponctuel de génération de carte (ex. Storage indisponible pour une ligne)
n'interrompt ni les autres lignes ni la validation elle-même — l'adhérent existe déjà,
listé dans `echecsCarte` pour régénération séparée plus tard. Requiert une police ACTIVE
pour le souscripteur (409 sinon) et au moins une ligne valide (409 sinon) ; refuse un import
déjà VALIDE/REJETE (409) ; rôle non habilité → 403 (`ASSUREUR_COMPTABLE`, qui a pourtant pu
importer, ne peut pas valider — création et validation restent deux étapes distinctes,
même principe que `validerAdherent`/coupure de facturation du prompt précédent).

### 4. Écran `/dashboard-assureur/informatique/adherents`
Bouton « Importer depuis Excel » (société + fichier .xlsx) et section « Imports en attente
de validation » : un import par carte, aperçu des lignes valides (tableau) et en erreur
(liste avec le motif précis par ligne) affiché à la demande — c'est cet aperçu, persistant
tant que l'import n'est pas validé, qui sert de « confirmation avant validation » (pas un
troisième état intermédiaire non persisté). Bouton « Valider l'import » visible seulement
pour INFORMATIQUE/EXPLOITATION.

### Tests
Backend : 17 nouveaux tests (`import-adherents.service.spec.ts` — fichiers .xlsx réels
générés via `exceljs` en mémoire, pas des mocks de parsing), suite complète 579/579.
`npx tsc --noEmit` propre API et Web. Test HTTP réel (16/16) : fichier de 4 lignes (2
valides, 2 en erreur car partageant le même email) importé par ASSUREUR_INFORMATIQUE →
EN_ATTENTE_VALIDATION, 0 adhérent en base à ce stade (vérifié indépendamment) ;
ASSUREUR_COMPTABLE refusé (403) sur la validation ; ASSUREUR_EXPLOITATION valide → 2
adhérents créés avec numéro chronologique et numéro de carte réels, carte générée avec
succès pour les deux (0 échec), les 2 lignes en erreur n'ont créé aucun adhérent. Toutes les
données de test éphémères supprimées, résidu nul vérifié indépendamment (0 adhérent, 0
import, 0 profil restants).

## 2026-09-23 (suite 5) — Gestion collaborative de la liste d'adhérents par la société cliente

Étend `imports_adherents` (déjà construit au prompt précédent) pour que
`SOCIETE_ASSUREE`/`SOCIETE_ADMINISTRATION` puissent proposer des ajouts d'adhérents et de
bénéficiaires directement, sans passer par l'import Excel de l'informatique — même circuit
de validation, sans aucune duplication.

### 1. Nouveau statut `BROUILLON` (prisma/sql/054)
`imports_adherents.fichier_nom` devient nullable (aucun fichier pour une liste composée à la
main) ; `statut` accepte désormais `BROUILLON | EN_ATTENTE_VALIDATION | VALIDE | REJETE`.
Un brouillon est éditable ligne par ligne par la société (ajout/modification/suppression),
jamais visible par l'assureur tant qu'il n'est pas soumis. Nouvelles policies RLS société
(lecture/insertion/mise à jour de son propre brouillon, scopé `societe_id = souscripteur_id`),
en plus des policies assureur déjà en place (permissives, combinées en OR).

### 2. `ImportAdherentsService` — 7 nouveaux endpoints, réservés SOCIETE_ASSUREE/ADMINISTRATION
`proposerAdherent`/`proposerBeneficiaire` (créent le brouillon au premier appel, find-or-
create), `modifierPropositionAdherent`/`modifierPropositionBeneficiaire`/`supprimerProposition`
(par index de ligne, refusés avec 409 si le brouillon a déjà été soumis), `soumettrePourValidation`
(BROUILLON → EN_ATTENTE_VALIDATION, refuse une liste vide), `obtenirBrouillonSociete` (lecture
du brouillon en cours). Toujours scopés à SA PROPRE société (`ctx.societeId === souscripteurId`,
même principe que `AdherentService.assertGestion`) — `ROLES_PROPOSITION_ADHERENTS_SOCIETE`
élargi par rapport à `ROLE_GESTION_MEMBRE_SOCIETE` (SOCIETE_ADMINISTRATION seule) : proposer
reste soumis à validation assureur, donc moins risqué que la création directe déjà ouverte à
SOCIETE_ADMINISTRATION. Un bénéficiaire proposé se rattache toujours à un `Adherent` déjà RÉEL
de la société (jamais à une autre ligne du même brouillon — hors périmètre, non demandé).

`lignesValides` devient un array discriminé par `type` (`ADHERENT` | `BENEFICIAIRE`) —
`validerImportAdherents` (inchangé dans son contrat, déjà construit au prompt précédent)
branche dessus sans distinction d'origine : crée les `Adherent` (police ACTIVE requise
seulement si le lot contient au moins un ADHERENT) puis les `Beneficiaire`, génère leur carte
respective (`genererCarteAdherent`/`genererCarteBeneficiaire`, réutilisés tels quels), un
échec de génération ne bloque toujours ni les autres lignes ni la validation.

### 3. `ClaimsService` — lecture des réclamations scopée à la société (mode `'SOCIETE'`)
`reclamations` n'ayant pas de colonne société (dette déjà notée au fix du 2026-09-11), le
scope est dérivé via `adherentIdsSociete()` (sous-ensemble des `adherents` de son
`souscripteurId`) — `ROLES_SOCIETE_CLAIMS = ['SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION']`.
`listerReclamations`/`obtenirReclamation` filtrent sur `adherentId IN (...)` en mode SOCIETE,
jamais l'organisation entière ; une réclamation d'un adhérent d'une AUTRE société → 404 (pas
de fuite). Policy RLS `reclamations_lecture_societe` posée en miroir (prisma/sql/054). Les
deux `include` (liste + détail) gagnent `adherent`/`beneficiaire` (nom/prénom) pour que
l'écran société sache de qui il s'agit — inchangé pour les autres modes de lecture.

### 4. Frontend
- `AdherentsListe` (composant partagé assureur/société) : recherche étendue à la formule
  (`police.produit.nom`) + nouveau filtre select « Formule » — satisfait la recherche
  multicritère demandée (police/formule, nom) sans dupliquer l'écran.
- `PropositionsAdherentsPanel` (nouveau, sous `/dashboard-societe/administration/adherents`,
  visible aussi pour `SOCIETE_ASSUREE` qui partage cette URL) : composer/modifier/supprimer
  ses propositions ligne par ligne, bouton « Soumettre pour validation ». `ImportsAdherentsPanel`
  (écran informatique, inchangé dans sa logique) étendu pour afficher proprement les lignes
  BENEFICIAIRE (table séparée) en plus des ADHERENT.
- Nouvel écran `/dashboard-societe/administration/reclamations` (`ReclamationsSocieteEcran`) :
  colonnes adhérent/bénéficiaire, montant, remboursé, statut, date d'ouverture (`createdAt`)
  et date de conclusion (`updatedAt` si statut terminal — `reclamations` n'a pas de colonne
  dédiée, non demandée) ; compteurs Ouvertes/Conclues. Nav ajoutée pour
  SOCIETE_ADMINISTRATION et SOCIETE_ASSUREE (URL partagée, même convention que « Adhérents »).

### Tests
Backend : 21 nouveaux tests `import-adherents.service.spec.ts` (propositions, modification,
suppression, soumission, scoping société de `listerImportsAdherents`, validation d'un lot
BENEFICIAIRE-only) + 8 nouveaux `claims.service.spec.ts` (lecture société scopée, 404
inter-société, 403 rôle non habilité) — suite complète API 604/604, `npx tsc --noEmit`
propre API et Web. Test HTTP réel (30/30 vérifications) : SOCIETE_COMPTABLE refusé (403) sur
la proposition et sur la modification/suppression ; SOCIETE_ASSUREE propose un adhérent puis
un bénéficiaire (rattaché à un adhérent existant), voit son brouillon, modifie la ligne
adhérent avant soumission, soumet (409 sur toute modification après) ; 0 adhérent/bénéficiaire
en base avant validation (vérifié indépendamment) ; ASSUREUR_INFORMATIQUE voit la liste
soumise et valide → 1 adhérent + 1 bénéficiaire créés avec numéro/carte réels, 0 échec.
Toutes les données de test éphémères supprimées, résidu nul vérifié indépendamment.

## 2026-09-24 — Photo de profil + double validation d'un bénéficiaire ajouté par l'adhérent lui-même

Étend le dashboard adhérent pour la gestion de son propre profil et de ses bénéficiaires,
avec un circuit de double validation distinct de celui des propositions société (2026-09-23
suite 5) : ici c'est l'ADHÉRENT lui-même qui propose, jamais sa société.

### 1. `photo_url` sur `adherents` et `beneficiaires` (prisma/sql/055)
Chemin de stockage (jamais une URL signée, éphémère par nature) dans un nouveau bucket
privé `photos` — même recette que `cartes` (prisma/sql/023) : `public = false`, aucune
policy `storage.objects`, écriture/signature exclusivement via `service_role`
(`AdherentService`, endpoints `POST/GET .../photo`, `FileInterceptor` réutilisé tel quel).
Modifiable par l'adhérent SANS AUCUNE validation (donnée non structurante, y compris
pour un bénéficiaire encore en attente) — nom de fichier fixe (`photo.<ext>`, `x-upsert`)
pour ne jamais accumuler d'anciens fichiers orphelins à chaque changement.

### 2. Double validation d'un bénéficiaire proposé par l'adhérent (prisma/sql/055)
`beneficiaires.numero_carte` devient nullable (INSERT explicite de NULL, hors du défaut de
séquence — inchangé pour la création directe par SOCIETE_ADMINISTRATION/ASSUREUR, qui reçoit
toujours un numéro immédiatement) ; `statut` accepte désormais `EN_ATTENTE_SOCIETE` et
`EN_ATTENTE_ASSUREUR` en plus de ACTIF/SUSPENDU/RADIE, avec une contrainte de cohérence
(`beneficiaires_carte_coherente`) : en attente ⇒ jamais de carte, ACTIF/SUSPENDU/RADIE ⇒
toujours une carte.

- `proposerMonBeneficiaire` (`POST /member/adherents/:id/beneficiaires/proposition`,
  self-service ADHERENT) crée directement une vraie ligne `Beneficiaire` (pas de staging
  JSON, à la différence des propositions société) au statut `EN_ATTENTE_SOCIETE`, sans carte.
- `validerBeneficiaireSociete` (`POST /member/beneficiaires/:id/valider-societe`, réservé
  SOCIETE_ADMINISTRATION, scopé à SA PROPRE société) : `EN_ATTENTE_SOCIETE` →
  `EN_ATTENTE_ASSUREUR`. Toujours pas de carte à ce stade.
- `validerBeneficiaireAssureur` (`POST /member/beneficiaires/:id/valider-assureur`, réservé
  ASSUREUR_INFORMATIQUE/EXPLOITATION) : `EN_ATTENTE_ASSUREUR` → `ACTIF`, numéro de carte
  attribué manuellement à cet instant précis (`nextval` de la même séquence que le défaut de
  colonne, puisqu'une `UPDATE` ne déclenche jamais un défaut de création), puis génération
  automatique de la carte (réutilise `MemberCarteService.genererCarteBeneficiaire` tel quel) —
  un échec de génération ne bloque ni la validation ni l'attribution du numéro (même
  tolérance que `validerImportAdherents`).

### 3. Immutabilité post-carte — additif, pas de régression sur le circuit existant
`modifierMonBeneficiaire` (self-service ADHERENT) refuse explicitement (409) dès que
`numeroCarte` n'est plus `null` — c'est la carte, pas le passage par la validation société,
qui verrouille (règle explicite du prompt : modifiable pendant EN_ATTENTE_SOCIETE ET
EN_ATTENTE_ASSUREUR). Décision consciente, actée avec l'utilisateur : cette immutabilité ne
s'applique QU'à ce nouvel endpoint self-service — le circuit existant `modifierBeneficiaire`
(SOCIETE_ADMINISTRATION/ASSUREUR, création directe avec carte immédiate) reste inchangé,
cohérent avec les décisions additives des prompts précédents.

### 4. Couverture bénéficiaires des dossiers de soins — gap réel trouvé et corrigé
Audit demandé par le prompt : `listerMesCodes`, `listerMesCodesOrdonnance` et
`listerMesFactures` (preauthorization/) ne filtraient QUE `adherentId`, alors que
`CodeConsultation`/`CodeOrdonnance`/`FactureDossier` ont `adherentId`/`beneficiaireId`
mutuellement exclusifs — un acte pris pour un bénéficiaire n'apparaissait donc JAMAIS dans
les listes self-service de l'adhérent. Même gap trouvé et corrigé dans
`ClaimsService.listerReclamations`/`chargerReclamation` (mode `'ADHERENT'`). Corrigé en
élargissant chaque `where` en `OR: [{adherentId}, {beneficiaireId: {in: [...]}}]` (ids des
bénéficiaires propres, requête dédiée). À l'occasion, corrigé un bug adjacent dans
`genererCodeConsultation` : une demande de code pour un bénéficiaire sans `dto.adherentId`
explicite retombait sur `ctx.adherentId`, violant la mutuelle exclusivité — désormais
`adherentId` reste `null` dès qu'un `beneficiaireId` est fourni, et la propriété du
bénéficiaire ciblé est vérifiée (403 sinon, fuite inter-adhérent fermée).

### 5. Frontend
- Nouvel écran `/dashboard-adherent/beneficiaires` (`BeneficiairesEcran`) : photo de profil
  (upload direct, avatar cliquable), liste des bénéficiaires avec statut visible
  (badges dédiés « En attente (société) »/« En attente (assureur) »), proposition d'ajout,
  modification tant que `numeroCarte` est `null`. Nav ajoutée pour le dashboard adhérent.
- `adherent-detail.tsx` (écran staff partagé société/assureur informatique) étendu : boutons
  « Valider (société) »/« Valider (assureur) — génère la carte » sur les bénéficiaires en
  attente, visibles selon le rôle connecté ; `numeroCarte` affiché `—` tant que `null`.

### Tests
Backend : 21 nouveaux tests `adherent.service.spec.ts` (proposition, modification,
immutabilité post-carte, double validation, photo adhérent/bénéficiaire), 6 nouveaux tests
répartis sur `preauthorization.service.spec.ts`/`preauthorization-ordonnance.service.spec.ts`/
`preauthorization-facture.service.spec.ts` (couverture bénéficiaires + ownership check),
2 nouveaux `claims.service.spec.ts` — suite complète API 632/632, `npx tsc --noEmit` propre
API et Web. Test HTTP réel (30/30 vérifications) : l'adhérent propose un bénéficiaire
(statut EN_ATTENTE_SOCIETE, carte NULL), le modifie, SOCIETE_ADMINISTRATION valide
(EN_ATTENTE_ASSUREUR, toujours pas de carte), ASSUREUR_COMPTABLE refusé (403) aux deux
étapes de validation, ASSUREUR_INFORMATIQUE valide en dernier → statut ACTIF, numéro de
carte réel attribué SEULEMENT à ce moment ; tentative de modification après génération de
carte → 409, valeurs inchangées en base (immutabilité confirmée) ; re-validation société sur
un bénéficiaire déjà ACTIF → 409 ; upload photo adhérent + bénéficiaire (chemin de stockage
correct en base, URL signée renvoyée par upload et par lecture). Toutes les données de test
éphémères supprimées, résidu nul vérifié indépendamment (organisation, profils, comptes
Supabase Auth).

## 2026-09-24 (suite) — Mouvements de personnel (sortants/entrants) par la société cliente — FIN DE L'ÉTAPE « gestion collaborative société cliente »

Dernier volet de la filière société cliente ouverte au prompt du 2026-09-23 (import Excel,
puis propositions collaboratives, puis photo/double validation bénéficiaire) : la société
gère elle-même ses mouvements de personnel, avec la même discipline de coupure que la
facturation mensuelle déjà construite (prisma/sql/052).

### 1. Sortants (prisma/sql/056) — effet IMMÉDIAT une fois validé
Nouveau statut intermédiaire `PROPOSE_SORTANT` sur `Adherent` (+ `statutSortantCible`
SUSPENDU/RADIE et `motifSortie`, contrainte de cohérence `adherents_sortant_coherent`).
`proposerSortants` (`POST /member/sortants/proposer`, réservé EXCLUSIVEMENT
SOCIETE_ADMINISTRATION — pas SOCIETE_ASSUREE, contrairement aux propositions d'ajout,
jugé plus sensible) bascule le statut de l'adhérent IMMÉDIATEMENT (visible sans délai) ;
`validerSortants` (`POST /member/sortants/valider`, réutilise tel quel
`ROLES_VALIDATION_IMPORT_ADHERENTS`) applique la cible choisie, effective à l'instant même
— **à la différence des entrants ci-dessous, aucun report au mois suivant n'est demandé
pour une sortie** (décision actée : seul le prompt le demande explicitement pour les
entrants). Réutilise aussi l'import Excel (colonnes adaptées : identifiant adhérent + motif
+ statut cible optionnel, défaut RADIE) via `importerSortantsExcel`, qui délègue directement
à `proposerSortants` après résolution de chaque identifiant (numéro d'adhérent ou email) —
tolérant aux erreurs par ligne, comme l'import d'origine.

### 2. Entrants — effet DIFFÉRÉ au mois suivant (prisma/sql/056, `ImportAdherents.moisEffet`)
`ImportAdherents` gagne un `moisEffet` (1er du mois) explicite, posé sur le brouillon entier
via `proposerAdherent` (manuel, champ optionnel — comportement historique inchangé si omis,
additif pur envers la fonctionnalité « suite 5 » déjà tenue) ou `importerEntrantsExcel`
(nouveau, réutilise `parserEtValider`/le parsing Excel du Prompt A tel quel mais APPEND au
brouillon société au lieu de créer un import distinct — `moisEffet` toujours posé, calculé
au mois calendaire suivant si omis). `validerImportAdherents` (déjà construit, contrat
inchangé pour tout lot sans `moisEffet`) stampe alors directement `Adherent.dateValidation`
à la VEILLE du 1er de `moisEffet` — jamais `now()` — pour CHAQUE adhérent créé du lot : le
mois promis à la proposition est ainsi garanti même si la validation assureur est tardive
(calcul vérifié robuste à un décalage arbitraire entre proposition et validation).

### 3. Écran société « Entrants / sortants » (`/dashboard-societe/administration/mouvements`)
Deux flux distincts avec statuts visibles jusqu'à validation : bloc Sortants (liste des
adhérents ACTIFS avec action « Proposer la sortie » par ligne + import Excel, section
« En attente de validation assureur » pour les PROPOSE_SORTANT) et bloc Entrants (formulaire
manuel avec champ « Mois d'effet » + import Excel, liste des lots avec leur mois d'effet et
statut). Le calcul du mois par défaut (mois suivant) est fait CÔTÉ FRONTEND pour la saisie
manuelle (l'API `proposerAdherent` reste neutre par défaut, pour ne pas changer le
comportement des propositions générales hors mouvements de personnel) — l'import Excel,
lui, défère toujours côté API puisque dédié à cette fonctionnalité. Un panneau symétrique
« Sortants en attente de validation » a été ajouté à l'écran ASSUREUR_INFORMATIQUE existant
pour rendre la validation atteignable en interface, pas seulement via l'API.

### Tests
Backend : 12 nouveaux tests `adherent.service.spec.ts` (proposerSortants/validerSortants),
11 nouveaux `import-adherents.service.spec.ts` (importerEntrantsExcel/importerSortantsExcel,
moisEffet différé sur validerImportAdherents) — suite complète API 655/655, `npx tsc --noEmit`
propre API et Web. Bug de routage trouvé et corrigé pendant le test réel : `POST
/member/adherents/sortants/valider` était masqué par le pattern déjà enregistré
`adherents/:id/valider` (Express/Nest matchent dans l'ordre d'enregistrement, `:id`
capturait littéralement « sortants ») — déplacé sur un chemin top-level `sortants/valider`
sans ambiguïté. Test HTTP réel (20/20 vérifications) : SOCIETE_ADMINISTRATION propose une
sortie → PROPOSE_SORTANT immédiat en base ; ASSUREUR_COMPTABLE refusé (403) ; ASSUREUR_
INFORMATIQUE valide → statut cible effectif IMMÉDIATEMENT ; SOCIETE_ADMINISTRATION propose
un entrant avec mois d'effet explicite (mois suivant), soumet, ASSUREUR_INFORMATIQUE valide
→ adhérent créé ACTIF avec `dateValidation` déjà renseignée ; vérifié sur l'endpoint réel de
facturation (`GET .../adherents-facturation`) que ce nouvel entrant N'apparaît PAS dans la
liste du mois courant mais apparaît bien dans celle du mois suivant — la coupure de
facturation déjà construite au 2026-09-23 traite donc correctement l'effet différé. Toutes
les données de test éphémères supprimées, résidu nul vérifié indépendamment.

**Fin de l'étape « gestion collaborative société cliente »** : import Excel (entrants),
propositions manuelles (adhérents/bénéficiaires), photo de profil, double validation d'un
bénéficiaire ajouté par l'adhérent, et mouvements de personnel (sortants/entrants à effet
différé) sont désormais tous construits, testés unitairement et vérifiés en HTTP réel.

## 2026-09-24 (suite 2) — Audit d'incohérences puis correction des 3 problèmes confirmés (log_audit avalé, rejet facture pharmacie manquant, rupture Decimal)

Audit diagnostic complet (5 catégories : terminologie/modèle, RBAC/sécurité, règles métier
transverses, financier, PROGRESSION.md vs réalité) mené sur l'ensemble des fonctionnalités
métier ajoutées récemment (établissement, pharmacie, exploitation, médecin conseil,
pharmacien conseil, comptable assurance, société cliente, adhérent) — aucune correction
pendant l'audit, diagnostic seul. 3 problèmes confirmés ont été corrigés dans ce prompt,
chacun testé séparément en HTTP réel avant tout commit ; les autres points de l'audit
(3 règles « 14 jours », duplication de la règle du 1er du mois, bouton « Payer » visible à
l'adjoint, `paiements_groupes`) restent des décisions à trancher plus tard, volontairement
non touchés.

### 1. CRITIQUE — log_audit() avalé dans 3 fichiers (rupture de la règle du PROMPT 4)
`payment.service.ts`, `contestation.service.ts` et `member/import-adherents.service.ts`
journalisaient l'échec de `log_audit()` via `this.logger.error()` puis continuaient
normalement — contrairement aux 15 autres fichiers du projet déjà conformes, qui
re-lancent l'erreur pour faire échouer la transaction Prisma englobante. Un `throw error;`
ajouté après le log dans les 3 `audit()` privés (aucun autre changement) suffit : chaque
appel à `this.audit(tx, …)` se fait déjà à l'intérieur d'un `$transaction(async (tx) => …)`,
donc l'exception fait maintenant échouer tout le bloc, y compris dans `transfererEntreComptes`,
`enregistrerDepense` et `payerFacture`.

### 2. Rejet de facture mensuelle pharmacie, manquant (miroir établissement incomplet)
`validerFactureMensuelle` (pharmacy.service.ts) n'acceptait aucune décision et ne pouvait
donc jamais renvoyer une facture en correction — contrairement à
`verifierFactureMensuelleEtablissement` (preauthorization.service.ts) qui gère déjà
VALIDEE/A_CORRIGER. Ajout du vrai miroir fonctionnel : `DECISIONS_VALIDATION_FACTURE_
MENSUELLE_PHARMACIE` (pharmacy.types.ts), `ValiderFactureMensuelleDto` (dto/pharmacy.dto.ts),
branche `A_CORRIGER` dans `validerFactureMensuelle` qui libère les `LigneDispensation`
stampées (`factureMensuelleId` → null) et repasse la facture en `EN_PREPARATION`
(`dateSoumission` → null), exactement comme côté établissement. Route `POST
pharmacy/factures-mensuelles/:id/valider` étendue pour accepter `{ decision }` ; écran
« Factures mensuelles » du pharmacien conseil doté d'un bouton « À corriger » à côté de
« Valider », même pattern que l'écran établissement équivalent.

### 3. Rupture Decimal dans creerCompteFinancier / approvisionnerCompte
Les deux méthodes persistaient directement depuis le `number` natif du DTO
(`dto.fondsInitial.toFixed(2)` / `dto.montant.toFixed(2)`) au lieu de passer par
`decimal.js`, alors que le reste du module (`parserMontant`, `transfererEntreComptes`,
`enregistrerDepense`) applique cette discipline partout. `creerCompteFinancier` construit
désormais `new Decimal(dto.fondsInitial)` une seule fois et le réutilise pour l'écriture ET
le détail d'audit ; `approvisionnerCompte` hisse la construction du `Decimal(dto.montant)`
(déjà présente pour la vérification de solde de la branche `AUTRE_COMPTE`) en tête de
méthode et réutilise cette même instance pour le contrôle de solde, l'incrément/décrément,
le `MouvementFinancier` créé et l'audit — plus aucun recalcul ni écriture native parallèle.

### Tests
Backend : 8 nouveaux tests (3 « log_audit échoue → rejette » dans `payment.service.spec.ts`,
1 dans `contestation.service.spec.ts`, 1 dans `import-adherents.service.spec.ts` ; 1 test
`A_CORRIGER` dans `pharmacy.service.spec.ts` ; 2 tests montant à virgule dans
`payment.service.spec.ts`) — suite complète API 663/663, Java adjudication 21/21 inchangés,
`npx tsc --noEmit` propre.

Test HTTP réel (19/19 vérifications, script Node éphémère + organisation/comptes/pharmacie
de test, tout supprimé après coup) : (1) un transfert réel entre deux comptes financiers
pendant que `log_audit()` est temporairement redéfinie en base pour lever une exception
(signature exacte préservée, définition originale sauvegardée via `pg_get_functiondef` puis
restaurée immédiatement après le test, y compris en cas d'échec du script) échoue bien
intégralement — solde source et destination inchangés au centime près, aucun
`MouvementFinancier` créé — puis un transfert identique une fois `log_audit()` restaurée
réussit normalement (débit confirmé), preuve que la restauration n'a rien cassé ; (2) une
facture mensuelle pharmacie SOUMISE rejetée via `{decision:'A_CORRIGER'}` repasse bien à
`EN_PREPARATION` avec `dateSoumission` à `null` (vérifié indépendamment en base), et le
chemin `VALIDEE` continue de fonctionner normalement (non-régression) ; (3) un compte
financier créé avec `fondsInitial: 150000.75` puis approvisionné de `1500.50` conserve un
solde exact à `151501.25` au centime près, à la fois dans la réponse HTTP et en base.

## 2026-09-24 (suite 3) — Consolidation d'audit : 4 décisions tranchées (paiements groupés, bouton Payer, double validation confirmée, coupure du 1er du mois factorisée) — FIN DE CET AUDIT DE CONSOLIDATION

Dernier volet de l'audit du 2026-09-24 : 4 points restés en suspens après les corrections
précédentes (log_audit, rejet facture pharmacie, Decimal), chacun tranché explicitement par
l'utilisateur plutôt que corrigé silencieusement.

### 1. Fermeture de l'exception `paiements_groupes` pour ASSUREUR_COMPTABLE_ADJOINT
`assertComptable` (`payment.service.ts`) vérifiait `ctx.roleChain` (incluant l'adjoint par
héritage) — une exception VOLONTAIRE documentée, distincte de `assertGestionComptesFinanciers`
(rôle EXACT). Sur décision explicite, cette exception est refermée : `associerFacturesPourPaiement`
et `listerPaiementsGroupes` appellent désormais `assertGestionComptesFinanciers` (rôle exact,
jamais l'adjoint). `assertComptable`/`ROLE_COMPTABLE_PAIEMENT_GROUPE` restent utilisés
uniquement par `listerFacturesPourComptableGlobal` (vue d'ensemble en LECTURE seule, aucun
mouvement d'argent) — volontairement PAS touchée, ce n'est pas une action financière.
Commentaires des deux méthodes de garde mis à jour pour refléter ce nouveau partage des rôles.

### 2. Bouton "Payer" retiré pour l'adjoint quand aucun compte n'est accessible
`PaiementFactureForm` (composant partagé par les 3 écrans de paiement — factures individuelles
et paiements groupés) affiche désormais « Action réservée au comptable titulaire » à la place
du bouton dès que `comptes.length === 0`, plutôt que de rendre un sélecteur de compte vide.
`comptable-adjoint/paiements/page.tsx` : le calcul de `erreur` ne dépend plus que de
`resFactures` — un 403 sur `paiements-groupes` (conséquence du point 1) ou sur
`comptes-financiers` (déjà le cas avant ce prompt) dégrade silencieusement en liste vide au
lieu de bloquer toute la page avec un message d'erreur.

### 3. Double validation des bénéficiaires — confirmé comme choix assumé
Aucune modification : le circuit à deux validations successives (SOCIETE_ADMINISTRATION puis
ASSUREUR_INFORMATIQUE/EXPLOITATION) pour un bénéficiaire ajouté par l'adhérent lui-même reste
tel quel, ce n'est pas une incohérence à corriger.

### 4. Utilitaire partagé `premierJourDuMois`/`premierJourDuMoisSuivant`
L'audit avait supposé 3 implémentations inline dans `billing.service.ts` — vérification faite,
`billing.service.ts` n'avait en réalité qu'une seule méthode privée déjà factorisée
(`premierJourDuMois(d)`, 1er jour du mois DE `d`, utilisée 3 fois comme coupure de facturation),
pas de duplication à corriger là. Les vraies duplications de « 1er jour du mois SUIVANT »
étaient dans `member/import-adherents.service.ts` (`resoudreMoisEffet`, mois d'effet par défaut
des mouvements de personnel) et `preauthorization.service.ts` (`listerActesDuMoisEtablissement`,
borne de fin pour la vue « actes du mois »). Décision (validée avec l'utilisateur) : créer un
utilitaire complet plutôt que de s'en tenir à la description initiale — nouveau fichier
`src/common/dates.util.ts` exportant `premierJourDuMois(d)` et
`premierJourDuMoisSuivant(reference?)`, tous deux en UTC minuit. Migration sans changement de
comportement : les 3 appels de `billing.service.ts` vers `premierJourDuMois` partagé (la
méthode privée est supprimée), `resoudreMoisEffet` et `listerActesDuMoisEtablissement` vers les
deux fonctions partagées selon le cas.

### Tests
Backend : 4 nouveaux tests RBAC (`associerFacturesPourPaiement`/`listerPaiementsGroupes` —
adjoint 403, titulaire 200) dans `payment.service.spec.ts` ; nouveau fichier
`src/common/dates.util.spec.ts` (11 tests : fin de mois, année bissextile 2024, passage
décembre → janvier, valeur par défaut) ; suite complète des 3 fichiers touchés par la
factorisation (`billing.service.spec.ts`, `import-adherents.service.spec.ts`,
`preauthorization.service.spec.ts`) rejouée sans aucune modification de test nécessaire — même
résultat qu'avant, confirmant l'absence de changement de comportement. Suite complète : 678
tests backend (655 + 8 du prompt précédent + 4 RBAC + 11 dates.util), 21 Java, `tsc --noEmit`
propre API et Web.

Test HTTP réel (11/11 vérifications, script Node éphémère avec vraie session Next.js via
cookies `@supabase/ssr` en plus des tokens Bearer, tout supprimé après coup) : adjoint reçoit
403 sur `GET`/`POST paiements-groupes`, titulaire reçoit toujours 200 (non-régression) ; la
vue globale en lecture (`GET factures-mensuelles`) reste accessible à l'adjoint (non-régression,
volontairement pas touchée) ; page `comptable-adjoint/paiements` réellement rendue (session
cookie authentique) pour une facture `PROGRAMMEE_PAIEMENT` : aucun bouton « Payer » dans le
HTML, message « Action réservée au comptable titulaire » présent, page non bloquée par une
erreur malgré le 403 sur paiements-groupes ; page `comptable/paiements` du titulaire (même
composant partagé) : bouton « Payer » toujours présent (non-régression).

**Fin de cet audit de consolidation** : les 3 problèmes critiques (log_audit avalé, rejet
facture pharmacie manquant, rupture Decimal) et les 4 décisions de fermeture/clarification
(paiements groupés, bouton Payer, double validation, coupure du 1er du mois) issus de l'audit
du 2026-09-24 sont désormais tous traités, testés et documentés.

## 2026-09-24 (suite 4) — Import en masse par Excel du catalogue national (actes/médicaments), réservé SUPERADMIN_PRINCIPAL

Même pattern que `importerAdherentsExcel` (module `member/`), transposé au catalogue national
(`referentiel_national_actes`/`referentiel_national_medicaments`) — cross-tenant par nature
(pas d'`organisation_id`), réservé EXCLUSIVEMENT à SUPERADMIN_PRINCIPAL de bout en bout.

### 1. Nouvelle table `imports_catalogue_national` (prisma/sql/057)
Mêmes colonnes que `imports_adherents` (id, type ACTES/MEDICAMENTS, fichier_nom, statut EN_
ATTENTE_VALIDATION/VALIDE/REJETE, nb_lignes_total/valides/erreur, lignes_valides/erreurs_detail
jsonb, importe_par/valide_par FK profils, created_at) — mais RLS `for all` réservée
EXCLUSIVEMENT SUPERADMIN_PRINCIPAL (même politique que `parametres_plateforme` et
`referentiel_national_*`, prisma/sql/017), pas de rôles multiples comme côté adhérents.

### 2. `CatalogueImportService` (nouveau fichier, module `superadmin/`)
`importerCatalogueExcel(type, fichier)` parse le .xlsx (colonnes `code, libelle, categorie`
pour les actes ; `denomination_commune, nom_commercial, classe_therapeutique,
prix_reference_xof, medicament_essentiel` pour les médicaments) — AUCUNE entrée créée/modifiée
à ce stade. Un code (actes) ou une dénomination commune (médicaments, comparaison insensible à
la casse, cohérent avec l'index `lower(denomination_commune)` déjà en place) déjà présent dans
le catalogue national est signalé `estMiseAJour: true` avec l'id existant — PAS une erreur
bloquante, contrairement à un doublon DANS le fichier lui-même (erreur pour toutes les lignes
concernées, même règle que les emails en double de l'import adhérents).

### 3. `validerImportCatalogue(importId)` — pas de double validation
Réservé au même rôle que l'import (SUPERADMIN_PRINCIPAL) : contrairement aux adhérents, aucune
seconde validation par un rôle distinct — le Super Admin est déjà la plus haute autorité sur
cette donnée. Chaque ligne `estMiseAJour: false` crée une entrée au statut **PROPOSE** (jamais
HOMOLOGUE directement). Chaque ligne `estMiseAJour: true` met à jour SEULEMENT les champs
importés, sans jamais toucher `statut`/`statutHomologation`, `homologuePar`, `dateHomologation`.

**Point à noter, vérifié en code avant d'implémenter** : `creerActeNational`/
`creerMedicamentNational` (création UNITAIRE déjà existante, PROMPT 23) défaut au contraire à
`HOMOLOGUE` directement pour SUPERADMIN_PRINCIPAL (`dto.statut ?? 'HOMOLOGUE'`) — la règle
« le Super Admin ne peut pas homologuer » invoquée pour ce prompt s'applique en réalité à
l'import d'une organisation VERS SON PROPRE référentiel (`ASSUREUR_INFORMATIQUE` → PROPOSE,
seul son ASSUREUR_MEDECIN_CONSEIL/PHARMACIEN_CONSEIL homologue ensuite), pas à la maintenance
du catalogue national lui-même. Implémenté tel qu'explicitement demandé (PROPOSE pour tout
import en masse, jamais HOMOLOGUE) — asymétrie VOLONTAIRE avec la création unitaire assumée
comme telle : une donnée importée en masse depuis un fichier externe mérite une vérification
supplémentaire qu'une saisie unitaire délibérée n'exige pas forcément.

### 4. Écran `/superadmin/catalogue-national`
Nouveau composant `ImportsCataloguePanel` (mêmes conventions que `ImportsAdherentsPanel`) —
un panneau par onglet (actes/médicaments) avec bouton « Importer depuis Excel », historique des
imports, détail dépliable distinguant explicitement « Nouvelles entrées » et « Doublons
détectés — mise à jour », et lignes en erreur. Aucune étape de prévisualisation séparée avant
la création de l'import : l'aperçu se fait en dépliant l'import fraîchement créé (encore
EN_ATTENTE_VALIDATION) avant de cliquer sur « Valider l'import » — même UX que l'import
adhérents, déjà éprouvée.

### Tests
Backend : 24 nouveaux tests `catalogue-import.service.spec.ts` (RBAC, parsing actes/médicaments
— nouvelle entrée / doublon en base / doublon dans le fichier / colonnes manquantes / prix
invalide, validation création vs mise à jour, statut PROPOSE jamais HOMOLOGUE, log_audit jamais
avalé). Suite complète : 702 tests backend (678 + 24), 21 Java inchangés, `tsc --noEmit` propre
API et Web.

Test HTTP réel (21/21 vérifications, script Node éphémère avec un acte et un médicament
HOMOLOGUE pré-existants pour tester la détection de doublon, tout supprimé après coup) : rôle
ASSUREUR_INFORMATIQUE refusé (403) sur l'import ; import d'un fichier actes avec une entrée
nouvelle + une mise à jour d'un code existant, détection correcte des deux (`estMiseAJour`) ;
validation crée la nouvelle entrée au statut PROPOSE (jamais HOMOLOGUE) et met à jour le
libellé/catégorie de l'entrée existante SANS toucher son statut HOMOLOGUE ; même vérification
pour les médicaments (prix exact au centime, 750.50) ; re-validation d'un import déjà VALIDE
→ 409. Page `/superadmin/catalogue-national` réellement rendue (session Next.js authentique
via cookies `@supabase/ssr`) avec un import EN_ATTENTE_VALIDATION en base : panneau d'import,
nom de fichier et statut bien affichés, aucune erreur de rendu.

## 2026-09-24 (suite 5) — Audit des codes patient + écran /dashboard-adherent/dispensations (gap confirmé corrigé)

Audit diagnostique complet de tous les mécanismes de code générés pour le patient (Code de
Consultation, Code d'Ordonnance, Code de Facturation établissement avec cycles multiples,
Code de confirmation de dispensation pharmacie avec cycles multiples, Ticket de Soins) :
seul le code de dispensation pharmacie avait un backend complet (`listerMesDispensations`,
`pharmacy.service.ts`) mais aucun écran `/dashboard-adherent` ne l'affichait — 100% backend,
0% frontend. Ce prompt corrige exactement ce gap, sans toucher aux autres points relevés
par l'audit (incohérences bénéficiaires sur `chargerCodeAdherent`/`obtenirFacture`, accès
`individuel/` non branché) qui restent des décisions à trancher séparément.

### 1. Nouvel écran `/dashboard-adherent/dispensations`
`app/dashboard-adherent/dispensations/page.tsx` + `components/dashboard/adherent/
dispensations-ecran.tsx`, même squelette que `ordonnances-ecran.tsx`/`factures-ecran.tsx` :
`DataTable` de TOUTES les dispensations de l'adhérent (et ses bénéficiaires), toutes
pharmacies et tous cycles confondus — `listerMesDispensations` ne filtre déjà par aucun
`ordonnanceId`, donc plusieurs dispensations actives simultanément (délivrance partielle
répartie sur plusieurs pharmacies) apparaissent toutes, pas seulement la première/dernière.
Colonnes : pharmacie, médicaments, date de préparation, part assurance, part patient (voir
point 2), statut (colonne séparée, `StatutBadge`), code de confirmation — masqué (tiret) dès
que le statut n'est plus `EN_ATTENTE_VALIDATION_PATIENT` (masquage déjà fait côté backend,
`code` vaut `undefined` dans la réponse — le frontend ne fait qu'afficher ce qui est fourni).
Bouton « Valider le code » par ligne quand le code est visible — mirroir exact de
`factures-ecran.tsx` (`validerFacturation`), cohérent avec le fait que `validerCodeDispensation`
est, comme la facturation, une validation en libre-service par l'ADHÉRENT lui-même (pas une
validation par un rôle staff, contrairement au code de consultation/ordonnance).

### 2. Backend : ajout de `montantAssurance` à `listerMesDispensations`
La demande précise « montant part assurance/part patient visible » nécessitait un champ que
le backend ne renvoyait pas encore (seul `montantPatient` était sommé depuis les lignes).
Ajout de la même sommation `Decimal` pour `montantAssurance` (`pharmacy.service.ts`), sur le
modèle déjà utilisé par `obtenirDispensation` (côté pharmacien) — jamais de soustraction
`montantTotal - montantPatient` côté navigateur (règle du projet : `decimal.js` côté API,
jamais côté UI).

### 3. Navigation
Entrée « Dispensations » ajoutée à `dashboard-nav.ts` sous `[ADHERENT]`, entre Ordonnances et
Factures. PAS ajoutée à `individuel/` (nav limitée à la seule Vue d'ensemble sur décision
explicite antérieure, non revisitée par ce prompt — cf. audit, à trancher séparément).

### 4. Tests
Backend : 10 nouveaux tests (`listerMesDispensations` — scope adhérent, masquage du code par
statut, calcul `montantAssurance`/`montantPatient`, multi-cycle toutes pharmacies confondues ;
`validerCodeDispensation` — rôle, code invalide, dispensation d'un tiers, déjà validée,
succès), module jusque-là entièrement non testé. Suite complète : 712 tests backend (702 +
10), 21 Java inchangés, `tsc --noEmit` propre API et Web.

Test EN NAVIGATEUR RÉEL (14/14 vérifications, script Node éphémère avec chaîne complète
Organisation → Souscripteur → Produit PUBLIE → Police → Adhérent → Établissement → Dossier →
Consultation → Ordonnance → 2 lignes → 2 pharmacies → 2 dispensations, session Next.js
authentique via cookies `@supabase/ssr`, tout supprimé après coup) : la page rendue affiche
bien le code de la dispensation `EN_ATTENTE_VALIDATION_PATIENT`, les DEUX pharmacies et leurs
statuts respectifs (une seconde dispensation déjà `VALIDEE` n'affiche pas son code), les
montants part assurance (4000) et part patient (1000) ; après un appel réel à `POST
pharmacy/dispensations/valider-code` (ce que fait le bouton), la page re-rendue ne montre
plus le code ni le statut « en attente » — confirmé indépendamment en base (`statut: VALIDEE`).

## 2026-09-24 (suite 6) — Corrige les 2 incohérences lecture/écriture bénéficiaires (codes-consultation, factures)

Dernier point de l'audit des codes patient : `chargerCodeAdherent` et `obtenirFacture` ne
vérifiaient que `ctx.adherentId === xxx.adherentId`, refusant l'accès à l'adhérent pour un
code/une facture émis pour l'un de ses propres bénéficiaires — alors que les listes
(`listerMesCodes`, `listerMesFactures`, via `filtreMoiEtMesBeneficiaires`) les incluent déjà.

### 1. Nouvelle méthode partagée `estMonBeneficiaire(ctx, beneficiaireId)`
`preauthorization.service.ts` — équivalent de `filtreMoiEtMesBeneficiaires` mais pour la
lecture d'UN seul enregistrement (où un simple `where` ne suffit pas) : vérifie que
`beneficiaireId` appartient bien à `ctx.adherentId` (`Beneficiaire.findFirst`). Réutilisée
par les deux corrections ci-dessous — même logique, un seul endroit.

### 2. `chargerCodeAdherent` (confirmerPresence / annulerCode)
Élargi : `estLAdherent || estSonBeneficiaire` avant de lever `ForbiddenException`. Un
adhérent peut désormais confirmer sa présence ou annuler un code de consultation émis pour
l'un de ses bénéficiaires (enfant, conjoint…), pas seulement les siens propres. Sémantique
d'exception INCHANGÉE (toujours 403 « Ce code ne vous appartient pas » pour un code d'un
tiers, jamais un changement de 403 vers 404) — correction volontairement minimale, limitée
à l'élargissement de la condition d'appartenance.

### 3. `obtenirFacture`
Même correction : `estLAdherent` couvre désormais `ctx.adherentId === facture.adherentId`
OU `estMonBeneficiaire(ctx, facture.beneficiaireId)`. Comme cette variable pilote aussi le
masquage de `codeFacturation`, le code de facturation d'une facture de bénéficiaire est
maintenant révélé à l'adhérent propriétaire, cohérent avec `listerMesFactures`.

### Tests
Backend : 6 nouveaux tests (4 dans `preauthorization.service.spec.ts` — confirmerPresence/
annulerCode sur le code d'un bénéficiaire, refus sur le code d'un tiers, non-appel de
`beneficiaire.findFirst` si `beneficiaireId` est null ; 2 dans `preauthorization-facture.
service.spec.ts` — obtenirFacture sur la facture d'un bénéficiaire, refus si le bénéficiaire
n'est pas le sien). Suite complète : 718 tests backend (712 + 6), 21 Java inchangés,
`tsc --noEmit` propre.

Test HTTP réel (11/11 vérifications, script Node éphémère — adhérent + bénéficiaire ENFANT
+ bénéficiaire CONJOINT + un adhérent tiers pour la non-régression, tout supprimé après
coup) : confirmation ET annulation réussies sur deux codes de consultation émis pour
l'enfant de l'adhérent connecté (vérifié indépendamment en base) ; lecture complète du
détail d'une facture émise pour le conjoint (code de facturation inclus, montants
corrects) ; non-régression confirmée — un adhérent tiers sans lien avec cette facture reçoit
toujours 403.

## 2026-09-24 (suite 7) — Élargit la navigation SOUSCRIPTEUR_INDIVIDUEL (consultation/ordonnances/factures/dispensations/carte)

### Vérification préalable demandée : le narrowing du 2026-09-15 était-il volontaire pour une raison produit/sécurité ?
Réponse : **non** — relu l'entrée PROGRESSION.md du 2026-09-15 et le commentaire de
`dashboard-nav.ts` : le périmètre de `/dashboard-adherent/individuel` avait été limité au
seul dossier de souscription (questionnaire médical + tarification) **« hors périmètre de
ce prompt »**, une limite de temps/scope du prompt qui avait corrigé le 404
`SOUSCRIPTEUR_INDIVIDUEL`, pas une décision métier. Le commentaire notait déjà explicitement
que les écrans de soins étaient « API-accessibles à ce rôle (`ROLES_ADHERENT` les traite à
l'identique d'`ADHERENT_TITULAIRE`) mais non branchés ici ». Aucune raison de sécurité trouvée
en creusant le code des 5 écrans concernés (aucun n'a de branche conditionnelle sur le rôle
exact, seulement sur `profil.entite === 'ADHERENT'`, commun aux deux rôles) — élargissement
fait sans réserve.

### Correction
`lib/dashboard-nav.ts` — `NAV_PAR_DASHBOARD['/dashboard-adherent/individuel']` : ajoute
Consultation, Ordonnances, Dispensations, Factures, Ma carte, **pointant vers les mêmes
routes partagées que `[ADHERENT]`** (`/dashboard-adherent/consultation`, etc.) — jamais de
duplication de page : le layout ne distingue le rôle que par `dashboardRoute` (la sidebar
affichée), la page sous-jacente est déjà entièrement partagée et déjà scopée sur
`ctx.adherentId` indépendamment du rôle exact. Aucun fichier backend touché. « Mes
bénéficiaires » et « Réclamations » restent volontairement hors périmètre — non demandés
pour ce rôle par l'utilisateur, à considérer séparément si besoin.

### Test en navigateur réel (compte SOUSCRIPTEUR_INDIVIDUEL, 20/20 vérifications)
Provisioning complet (organisation → souscripteur INDIVIDUEL → produit publié → police
ACTIVE → adhérent → profil `SOUSCRIPTEUR_INDIVIDUEL` avec `societeId`/`adherentId`, même
schéma que documenté au 2026-09-15), session Next.js authentique via cookies `@supabase/ssr` :
la page `/dashboard-adherent/individuel` rendue affiche maintenant les 5 nouveaux liens de
sidebar (et toujours pas « Mes bénéficiaires »/« Réclamations ») ; les 5 pages partagées
(`consultation`, `ordonnances`, `dispensations`, `factures`, `carte`) répondent 200 avec la
sidebar individuel affichée, sans redirection ni 403 ; preuve fonctionnelle au-delà du simple
rendu de page — un vrai code de consultation généré par ce compte `SOUSCRIPTEUR_INDIVIDUEL`
est créé en base avec le bon `adherentId`. Données et compte éphémères supprimés.

## 2026-09-29 — Dossier famille : nommage et rangement des photos adhérent/bénéficiaires

Les photos adhérent/bénéficiaires (prisma/sql/055) étaient stockées sous
`{organisationId}/adherents/{id}/photo.ext` et `{organisationId}/beneficiaires/{id}/photo.ext`
— un dossier Storage par personne, nom de fichier générique. Remplacé par un « dossier
famille » unique par adhérent titulaire, nommé `{NOM}-{2 lettres société}-{numero_carte}`,
regroupant sa propre photo ET celles de tous ses bénéficiaires.

### Convention (nouvelles méthodes privées, `member/adherent.service.ts`)
`identifiantFamille(nom, nomSouscripteur, numeroCarte)` — réutilisée à l'identique pour
nommer le dossier (à partir de l'ADHÉRENT titulaire) et chaque fichier qu'il contient (à
partir de la personne concernée) :
- `segmentPourFichier` : accents retirés, majuscules, espaces → `_`, toute autre
  ponctuation retirée SANS substitution — point vérifié explicitement sur l'exemple fourni
  (`DIALLO-AC-CM0000000007`) : le tiret d'un `numero_carte` généré (`CM-0000000042`)
  disparaît, il ne devient pas un `_` en plus des séparateurs de segments.
- `deuxLettresSociete` : 2 premières lettres A-Z du nom du souscripteur (accents/espaces/
  chiffres ignorés), repli `XX` si le nom n'a aucune lettre (garde-fou, jamais un segment vide).
- Nouveau chemin : `{organisationId}/familles/{DOSSIER}/{DOSSIER}.ext` pour la photo de
  l'adhérent lui-même, `{organisationId}/familles/{DOSSIER}/{NOM_BENEF}-{2 lettres}-
  {numeroCarteBenef}.ext` pour un bénéficiaire — `DOSSIER` toujours dérivé de l'ADHÉRENT
  TITULAIRE dans les deux cas, jamais du bénéficiaire, pour qu'un seul dossier regroupe
  toute la famille.
- `Beneficiaire.numeroCarte` est nullable tant que la double validation (prisma/sql/055)
  n'est pas terminée — repli sur `beneficiaire.id` (normalisé comme le reste) dans ce cas,
  pour ne jamais bloquer l'upload de la photo (donnée non structurante, comportement déjà
  établi). Aucune migration des photos déjà stockées sous l'ancien schéma — restent lisibles
  telles quelles (`signerPhoto` signe n'importe quel chemin déjà en base), seuls les
  nouveaux uploads utilisent la nouvelle convention.
- Collision : par construction impossible — `numero_carte` est déjà `@unique` en base pour
  `Adherent` et `Beneficiaire`, donc deux fichiers du même dossier famille ne peuvent jamais
  porter le même nom même à nom de famille identique (vérifié explicitement par un test dédié).
- Endpoints inchangés (`POST member/adherents/:id/photo`,
  `POST member/adherents/:id/beneficiaires/:beneficiaireId/photo`) — seule la construction
  du chemin de stockage change, aucun autre aspect du mécanisme d'upload touché.

### Tests
Backend : `adherent.service.spec.ts` — 2 tests existants réécrits pour la nouvelle
convention (dossier famille au lieu de l'ancien schéma par personne), 4 nouveaux (accents/
espaces/ponctuation normalisés sans casser le format, bénéficiaire dans le même dossier que
l'adhérent avec son propre numéro, repli sur l'id quand `numeroCarte` est encore `null`,
non-collision explicite entre deux fichiers du même dossier). Suite complète : 721 tests
backend (718 + 3 nets), `tsc --noEmit` propre.

Test HTTP réel (12/12 vérifications, script Node éphémère — organisation, souscripteur
« Access Bank », adhérent Diallo + 2 bénéficiaires, tout supprimé après coup y compris les
objets Storage) : upload réel des 3 photos (adhérent, 2 bénéficiaires) via les endpoints
existants ; `photoUrl` en base vérifié pour chacun ; les 3 chemins pointent vers EXACTEMENT
le même dossier (`{org}/familles/DIALLO-AC-CM0000000100`) avec 3 noms de fichiers distincts
(`DIALLO-AC-CM0000000100.jpg`, `DIALLO-AC-CM0000000101.jpg`, `TRAORE-AC-CM0000000102.jpg`) ;
listing RÉEL du bucket Supabase Storage (pas seulement la colonne `photoUrl`) confirmant que
les 3 fichiers existent bien physiquement à cet endroit.

## 2026-09-29 (suite) — Audit UI/UX : lot P0 (accessibilité, contrastes, parcours d'authentification)

Premier lot de l'audit UI/UX du frontend (`apps/web`), validé seul (P1/P2/P3 non traités).
Aucune logique métier, API, contrat front/back, Supabase, NestJS ni microservice touché.

### Réalisé
- **Contraste `--destructive`** (`app/globals.css`) : clair `0 72% 45%` (≥ 5,3:1 sur blanc
  et sur la teinte `destructive/5`, contre 3,8:1 avant), sombre `0 84% 67%` (≥ 5,8:1, contre
  2:1 avant) ; `--destructive-foreground` sombre passé en foncé pour rester lisible sur le
  rouge clair. Le bouton `destructive` (texte blanc, `dark:bg-destructive/60`) reste ≥ 5,8:1.
- **`color-scheme`** : `light` sur `:root`, `dark` sur `.dark` (selects natifs, barres de
  défilement et champs date suivent le thème).
- **DataTable** (`patterns/data-table.tsx`) : recherche en `type="search"` avec libellé
  `sr-only` associé (`useId`), `aria-sort` sur les en-têtes triables, `aria-label`
  « Page précédente / Page suivante » sur la pagination, icônes décoratives `aria-hidden`.
- **FormulaireModal** : bloc d'erreur en `role="alert"` (annoncé à l'apparition).
- **Parcours d'authentification en français** (connexion, mot de passe oublié / mis à jour,
  inscription, succès d'inscription, page d'erreur) : lien « Sign up » retiré de la connexion
  (compte créé par l'administrateur ; la route `/auth/sign-up` reste en place, traduite), un
  seul lien « Mot de passe oublié ? » (dans le formulaire), `autocomplete` (`username`,
  `current-password`, `email`, `new-password`), `spellCheck={false}` sur les e-mails, erreurs
  en `role="alert"` + `text-destructive` au lieu de `text-red-500`.
- **Erreurs Supabase traduites** : nouveau `lib/auth-erreurs.ts` (`messageErreurAuth`), basé
  sur `error.code` (invalid_credentials, email_not_confirmed, weak_password, same_password,
  otp_expired, rate limits…), repli réseau et message générique français. La page
  `/auth/error` affiche un message français ; le message brut de Supabase n'y apparaît plus
  que comme « détail technique ».

### Tests
`tsc --noEmit` propre ; `next build --webpack` OK (toutes les routes). Vérification sur le
build de production (`next start`, serveur arrêté ensuite) : HTML de `/login`,
`/auth/forgot-password`, `/auth/update-password`, `/auth/error` en français, attributs
`autocomplete` présents, plus aucun lien vers `/auth/sign-up` ; CSS compilé contenant les
nouveaux `--destructive` et les deux `color-scheme`. `npm run lint` inutilisable (préexistant :
`next lint` supprimé dans Next 16, aucun ESLint configuré).

### Statut
Lot P0 terminé. En attente de validation pour P1.

## 2026-09-29 (suite 2) — Audit UI/UX : lot P1-01 (fondations UI partagées)

Premier sous-lot de P1. Aucune API, logique métier, permission, route ni fonctionnalité
modifiée ; les contrôles d'accès de la navigation (`minNiveau`, `requiertValidation`) sont
inchangés.

### Réalisé
- **`lib/format.ts`** : `dateFr`, `dateHeureFr`, `moisFr` (UTC, accepte `AAAA-MM`),
  `periodeFr`, `montantF` (option `arrondi`), `pourcent`, `VIDE` — `Intl` mis en cache,
  « — » pour une valeur absente. Parité vérifiée à l'identique avec les anciennes
  implémentations (46/46 cas, plusieurs fuseaux). Migrés : `comptes-financiers-ecran`,
  `centre-medical/mes-factures-ecran`, `factures-pharmacie-comptable-ecran`,
  `comptable-vue-ensemble`, `cotisations-ecran` (le reste : migration progressive).
- **Pattern `<Alerte>`** (`patterns/alerte.tsx`) : tons `succes` / `erreur` /
  `avertissement` / `info`, icône + couleur, `annonce` `immediate` (role=alert, défaut des
  erreurs) / `polie` (role=status, défaut des autres) / `aucune` (bandeau statique).
  Couleurs = celles déjà en usage, réunies en un seul endroit ; contrastes ≥ 5,3:1.
  Migrés : `comptes-financiers-ecran` et `medecin-conseil-actes-ecran` (succès),
  `referentiel-medical-ecran` (erreur).
- **Navigation partagée** (`components/dashboard/navigation-shell.tsx`, `lib/navigation.ts`)
  utilisée par les deux shells : lien d'évitement « Aller au contenu principal » (cible
  `#contenu-principal`), `aria-current="page"` uniquement sur le lien de la page exacte,
  un seul lien actif (le plus précis — corrige « Vue d'ensemble » affiché actif en même
  temps que la page courante), menu mobile en panneau latéral (Dialog existant) au lieu de
  la barre horizontale — et désormais présent sur le superadmin, qui n'en avait pas.
- **Largeur du contenu par type de page**, déduite de la navigation : fiche `[id]` →
  `max-w-5xl`, vue d'ensemble → `max-w-7xl`, liste → `max-w-screen-2xl` (1536 px) ;
  champ optionnel `largeur` sur `NavItem`. Classification vérifiée sur les 97 routes des
  shells : 15 fiches, 19 vues d'ensemble / hors menu, 63 listes.

### Tests
`git diff --check` propre, `tsc --noEmit` OK, `next build --webpack` OK. Scripts Node de
vérification (hors dépôt) : parité des formats, classification des largeurs, calcul du lien
actif / `aria-current` sur la vraie navigation (10/10), présence et ordre des classes dans
le CSS compilé. Pas de test authentifié du rendu des shells (aucun compte de test
permanent ; la création de comptes éphémères n'a pas été faite sans accord).

### Statut
P1-01 terminé, non commité. En attente de validation.

## 2026-09-29 — Palette « lavande » (réf. Dribbble #23605847) appliquée au dashboard

### Réalisé
- **Jetons de thème** (`apps/web/app/globals.css`, clair + sombre) repris du shot Dribbble
  #23605847 (pixels échantillonnés sur l'original) : primaire violet `#7353EA` (≈ `#7757EA`
  du shot, assombri d'un cran pour l'AA), fond de page lavande `#F3F4FC`, surfaces blanches,
  texte `#2A2A2A`, accent `#EBE5FD`, bordures teintées. Thème sombre dérivé (violet `#9A7FE9`
  éclairci, fonds violet-noir). Contrastes calculés : tous ≥ 4,6:1 (AA).
- **Shells** (`dashboard/shell.tsx`, `superadmin/shell.tsx`) : sidebar et en-tête sur `bg-card`
  (blanc), contenu sur le fond de page lavande.
- **Menu** (`navigation-shell.tsx`) : élément actif = pilule `bg-accent` + texte violet semi-gras.
- **CarteResume** : icône sur pastille lavande (`bg-accent text-accent-foreground`).
- **Badge** : tonalités alignées sur le shot — succès vert, attention orange (pêche),
  danger rose, info cyan.
- Captures de référence : `docs/design-references/` (Behance HealthTrack + 3 shots Dribbble).

### Tests
`tsc --noEmit` OK. Rendu vérifié dans Chrome sur `/login` (clair et sombre) : `--primary`
= `253 78% 62%`, bouton `rgb(115,83,234)`. Pas de vérification visuelle des écrans
authentifiés (pas de compte de test utilisable sans mot de passe).

### Statut
Terminé, non commité. En attente de validation.

## 2026-09-29 — Palette lavande : bordure des champs à 3:1 (WCAG 1.4.11) + commentaires corrigés

### Réalisé
- `--input` (bordure de tous les champs : `Input`, `Champ*`, selects de `DataTable` et des
  écrans) : clair `235 10% 58%` = `#898B9F` (avant `#D6D7E1`, 1,43:1) ; sombre
  `250 10% 45%` = `#6B677E` (avant `#34313F`, 1,43:1).
- Commentaires de `globals.css` alignés sur les valeurs réelles après conversion HSL :
  fond `#F3F4FC`, accent `#EDE7FD`, bordures des champs `#898B9F` / `#6B677E`.

### Tests
Ratios mesurés dans Chrome (`/login`, styles calculés, transitions neutralisées) et
identiques au calcul : bordure/carte 3,36 (clair) / 3,33 (sombre), bordure/fond de page
3,06 / 3,51. Effet de bord sombre vérifié (`dark:bg-input/30` s'éclaircit : fond de champ
`#302E3B`) : texte 12,19:1, placeholder 5,25:1. `tsc --noEmit` OK, `git diff --check` OK.

### Statut
Terminé, non commité. En attente de validation.
