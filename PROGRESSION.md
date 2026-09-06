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