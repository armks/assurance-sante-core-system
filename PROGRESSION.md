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