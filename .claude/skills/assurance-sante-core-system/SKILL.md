---
name: assurance-sante-core-system
description: >
  Skill de référence OBLIGATOIRE pour la conception et le développement du core system
  d'assurance santé collective (Côte d'Ivoire). ARCHITECTURE CONFIRMÉE ET FINALE : Next.js
  (frontend) + NestJS (backend applicatif, modules stricts) + Supabase (Auth, Postgres, RLS,
  Storage) + un microservice Java Spring Boot isolé pour le calcul d'adjudication/
  remboursement uniquement (précision financière BigDecimal). Utiliser ce skill dès que la
  tâche concerne : schéma de base de données, RBAC/rôles, RLS, réclamations, remboursements,
  cotisations, polices, adhérents, bénéficiaires, réseau de soins, établissements,
  pharmacies, cartes de membre, codes de vérification anti-fraude, workflow de validation
  médecin/pharmacien conseil, module NestJS, microservice Java d'adjudication, ou
  déploiement AWS. Consulter ce skill AVANT d'écrire le moindre code lié à ce projet.
---

# Core System Assurance Santé Collective — Skill de référence (architecture finale)

## Architecture confirmée — ne pas dévier sans validation explicite de l'utilisateur

```
Next.js 16 (frontend, dashboards par rôle)
        │
        ▼
NestJS (backend applicatif — un seul déployable au départ, organisé en
modules stricts : identity, tenant, member, plan, policy, billing,
provider, eligibility, preauthorization, claims, adjudication-client,
payment, notification, reporting)
        │
        ├──► Supabase (Auth avec JWT signé en ECC/JWKS — pas de secret
        │    partagé, PostgreSQL avec RLS, Storage)
        │
        └──► Microservice Java Spring Boot (Adjudication uniquement —
             calcul de remboursement, verrouillage du plafond en
             transaction JDBC, précision BigDecimal)
```

## Que faire en premier

1. Identifier la **phase** du projet concernée (v9 §3, `01-plan-directeur-v9.md`).
2. Vérifier si la tâche relève de NestJS, Supabase, ou du microservice Java.
3. Lire le fichier de référence correspondant — ne jamais deviner un schéma déjà spécifié,
   **y compris la liste complète des 25 sous-rôles, désormais recopiée intégralement dans
   l'ADDENDUM de `01-plan-directeur-v9.md`** — ne plus jamais s'arrêter faute de cette liste.
4. Appliquer sans exception les règles transverses ci-dessous.

## Table de routage

| Sujet | Fichier |
|---|---|
| Schéma global, entités, dictionnaire des 25 sous-rôles (liste SQL complète en addendum) | `01-plan-directeur-v9.md` |
| Séparation médecin traitant / conseil / souscripteur | `02-corrections-medicales-v10.md` |
| Calcul de remboursement, microservice Java | `03-microservice-java-adjudication-v12.md` |
| Déploiement AWS | `04-deploiement-aws-v13.md` |
| CRM, Service Client, API Gateway, Recherche, comptabilité complète | `05-domaines-manquants-v14.md` |
| Détail architecture Next.js + NestJS + Supabase | `06-architecture-finale-nestjs-supabase-v18.md` |
| **Séquence de prompts à exécuter — LA référence d'exécution** | `07-sequence-prompts-EXECUTION-v19.md` |
| Cahier des charges vendeurs (évaluation fournisseurs externes uniquement) | `08-cahier-des-charges-vendeurs.md` |

## Règles transverses

- **TypeScript partout** (Next.js, NestJS) sauf le microservice Adjudication (Java, précision BigDecimal).
- **Défense en profondeur** : guard NestJS ET policy RLS Postgres, toujours les deux.
- **Multi-tenant** : `organisation_id` + RLS sur toute table sensible.
- **UUID**, `created_at`/`updated_at`/`deleted_at` sur toutes les tables.
- **Audit unique** : toute écriture d'audit passe par `log_audit()`.
- **JWT via JWKS** (`SUPABASE_JWKS_URL`), jamais `SUPABASE_JWT_SECRET` — ce projet utilise la
  signature asymétrique ECC P-256.
- **Next.js 16**, jamais 14 (EOL depuis le 26/10/2025).
- **Séparation des rôles médicaux** : `CENTRE_MEDICAL_MEDECIN`, `ASSUREUR_MEDECIN_CONSEIL`,
  `ASSUREUR_MEDECIN_SOUSCRIPTEUR` — jamais cumulables (contrainte `numero_ordre_medecin`).
- **Système anti-fraude à 4 codes** (Consultation, Ordonnance, Ticket de Soins, Facturation).
- **Verrouillage optimiste sur les plafonds** dans le microservice Java (`FOR UPDATE`).
- **Un module NestJS = un domaine métier strict**.
- **Un prompt de la séquence = une étape = une validation**.
- **Terminologie** : `reclamations` = sinistre uniquement, jamais une plainte (`plaintes` pour le CRM).
- **Git obligatoire dès le premier prompt** — voir procédure de reprise ci-dessous, §0.

## Incohérences déjà rencontrées et corrigées

| Piège | Correction |
|---|---|
| Table `societes_clientes` séparée | Utiliser uniquement `souscripteurs` |
| Confondre `ETABLISSEMENT_SANTE` et `CENTRE_MEDICAL` | Une seule chose, `etablissements_sante` = table physique |
| Oublier `ASSUREUR_MEDECIN_SOUSCRIPTEUR` | Toujours l'inclure — voir liste complète en addendum de 01 |
| `etablissement_id` au lieu de `pharmacie_id` en provisioning | Utiliser `pharmacie_id` |
| Insertion directe dans `audit_log` | Toujours `log_audit()` |
| Calcul financier en NestJS/TypeScript | Reste dans le microservice Java |
| `SUPABASE_JWT_SECRET` | N'existe pas dans ce projet — utiliser `SUPABASE_JWKS_URL` |
| Next.js 14 | Next.js 16 (14 est EOL) |
| MCP Supabase sans `read_only`/`project_ref` | Toujours scoper (voir addendum D de 01) |
| **Pas de dépôt Git dès le premier prompt** | **Cause de la perte du projet précédent — désormais obligatoire dès Prompt 0** |

---

# Procédure de reprise complète, étape par étape, après incident disque

## 0. Avant tout code : Git + GitHub (nouveau, à ne jamais sauter cette fois)

1. Installez Git si nécessaire : **git-scm.com** → téléchargez → installez.
2. Créez un dépôt **vide et privé** sur **github.com** (bouton "New repository"), nommez-le
   par exemple `assurance-sante-core-system`, cochez "Private".
3. Ne créez le dossier de projet qu'une fois ce dépôt distant prêt.

## 1. Réinstaller VS Code

**code.visualstudio.com** → téléchargez → installez.

## 2. Créer le dossier de projet et le lier à Git immédiatement

1. Créez le dossier (ex: `Desktop\assurance-sante-core-system`).
2. Ouvrez-le dans VS Code (**File → Open Folder**).
3. Terminal intégré (`` Ctrl+` ``) :
```
git init
git remote add origin https://github.com/VOTRE-COMPTE/assurance-sante-core-system.git
```
4. Créez un fichier `.gitignore` à la racine avec ce contenu minimal :
```
node_modules/
.env
.env.local
.claude/settings.local.json
```

## 3. Réinstaller Claude Code

```
npm install -g @anthropic-ai/claude-code
```
Vérifiez : `node --version` doit répondre avant cette commande — sinon installez Node.js
depuis **nodejs.org** (version LTS) d'abord.

## 4. Extension Claude Code dans VS Code (optionnel mais recommandé)

Icône Extensions (`Ctrl+Shift+X`) → recherchez "Claude Code" → installez celle d'Anthropic.

## 5. Lancer et authentifier Claude Code

```
claude
```
Choisissez la connexion par compte (Claude Pro), suivez le lien dans le navigateur.

## 6. Désactiver le mode auto immédiatement

Dès l'écran d'accueil, tapez :
```
/update-config
```
puis répondez :
```
Désactive le mode auto et utilise le mode par défaut qui demande mon approbation avant chaque commande ou modification de fichier.
```

## 7. Placer le skill

1. Créez `.claude/skills/` dans le projet.
2. Téléchargez le fichier `.skill` fourni, renommez-le en `.zip`, extrayez-le dans
   `.claude/skills/`.
3. Créez `CLAUDE.md` à la racine :
```markdown
# CLAUDE.md

Ce projet utilise le skill `assurance-sante-core-system` (voir .claude/skills/) —
consulte-le systématiquement avant toute tâche liée au schéma, aux rôles, au RBAC,
au NestJS, à Supabase, ou au microservice Java d'adjudication. Architecture confirmée :
Next.js 16 + NestJS + Supabase + microservice Java isolé pour l'adjudication uniquement.
Ne réinvente jamais une règle déjà spécifiée dans ce skill.

## Suivi de progression
Après chaque tâche significative terminée, mets à jour PROGRESSION.md à la racine :
entrée datée, étape réalisée, ce qui a été créé, statut. Ajoute seulement, ne réécris
jamais l'historique.

## Contrôle de version
Après chaque prompt validé par l'utilisateur, propose un commit git avec un message
clair référençant le numéro du prompt (ex: "Prompt 3 - rôles et identity"), puis un push
vers origin si l'utilisateur confirme.
```
4. Vérifiez : `/skills` doit lister `assurance-sante-core-system`.

## 8. Reconnecter le connecteur MCP Supabase (si vous réutilisez le même projet Supabase)

Si votre **projet Supabase existe toujours** (c'est votre base de données dans le cloud —
elle n'a probablement pas été affectée par l'incident de disque local, à vérifier) :

```
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=untipyycbhllqxwpucml&read_only=true&features=docs,database,development,functions"
```
Puis `/mcp` → authentifiez-vous.

**Vérifiez d'abord sur supabase.com si vos données (organisations, audit_log, et
éventuellement sous_roles/profils si le Prompt 3 avait progressé) sont toujours là** — si
oui, vous n'avez peut-être pas tout à refaire côté base de données, seulement côté code local.

## 9. Reconstituer les fichiers `.env`

Puisque le projet Supabase cloud est probablement intact, retournez chercher (via
**Connect** sur le tableau de bord Supabase) :
- `SUPABASE_URL`, clé publique → `apps/web/.env.local` et `apps/api/.env`
- `DATABASE_URL`/`DIRECT_URL` (onglet ORM → Prisma) → `apps/api/.env` uniquement
- `SUPABASE_JWKS_URL=https://untipyycbhllqxwpucml.supabase.co/auth/v1/jwks` → `apps/api/.env`
  (pas de secret à chercher, c'est une URL publique)

## 10. Relancer la séquence de prompts, dans l'ordre, avec commit après chacun

Suivez `07-sequence-prompts-EXECUTION-v19.md` — **PROMPT 0, puis 1, 2, 3...** — mais avant
de passer au prompt suivant, ajoutez systématiquement :
```
git add .
git commit -m "Prompt X - [description]"
git push origin main
```

Si votre base Supabase a effectivement conservé les données des Prompts 1 et 2 (vérifié à
l'étape 8), vous pouvez dire à Claude Code : *"Vérifie via le connecteur MCP ce qui existe
déjà dans Supabase avant de recréer quoi que ce soit — je repars du code perdu, mais la base
de données cloud est peut-être intacte."*
