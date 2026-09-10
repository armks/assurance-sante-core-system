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