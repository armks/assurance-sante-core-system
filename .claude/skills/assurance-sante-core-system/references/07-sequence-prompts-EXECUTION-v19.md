---
name: assurance-sante-core-system
version: 19.0-PROMPTS-NESTJS
description: >
  Remplace cursor-prompts-execution-guide.md (v11, pensé pour Supabase pur) par la
  séquence adaptée à l'architecture confirmée : Next.js (frontend) + NestJS (couche
  applicative, modules stricts) + Supabase (Auth, Postgres, Storage, RLS) + microservice
  Java d'Adjudication (v12, inchangé). Référence architecture : v18.
---

# Séquence de prompts Claude Code — Next.js + NestJS + Supabase

## 0. Structure du projet

```
assurance-sante-app/
├── apps/
│   ├── web/        (Next.js)
│   └── api/        (NestJS — modules identity, member, plan, policy, billing,
│                     provider, eligibility, preauthorization, claims, adjudication,
│                     payment, notification, reporting)
├── adjudication-service/   (microservice Java, v12, inchangé)
├── docs/skill/             (fichiers de référence v9-v18)
└── .claude/skills/
```

```
PROMPT 0 — Initialisation du monorepo
Crée une structure de dossiers avec apps/web (Next.js 16 App Router, TypeScript, Tailwind,
ShadCN) et apps/api (NestJS, TypeScript, avec @nestjs/config, @nestjs/jwt, class-validator,
Prisma comme ORM connecté à Postgres). Utilise des workspaces npm/pnpm simples (pas de
Turborepo/Nx pour l'instant — inutile à ce stade). Configure .env dans chaque app avec les
variables Supabase (SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL pour la connexion directe
Prisma à Postgres).
```

---

## PALIER 1 — MVP

### Phase 0 — Fondations

```
PROMPT 1 — Supabase : organisations et audit
Dans Supabase, crée la table organisations et la fonction log_audit() (v9 §1.6, copie
exacte). Configure Prisma dans apps/api pour se connecter à cette base Postgres.
```

```
PROMPT 2 — Authentification (Supabase Auth + garde NestJS)
Dans apps/web, installe le composant Supabase UI d'authentification
(npx shadcn@latest add https://supabase.com/ui/r/password-based-auth-nextjs.json), active
MFA et SSO Google/Microsoft. Dans apps/api (NestJS), crée un SupabaseAuthGuard qui valide
le JWT émis par Supabase Auth sur chaque requête entrante, extrait le user_id et le rôle
depuis les claims, et les injecte dans le contexte de la requête (décorateur @CurrentUser()).
```

```
PROMPT 3 — Module identity (NestJS) + schéma des rôles (Supabase)
Dans Supabase : crée entites_metier, sous_roles (avec héritage, y compris
ASSUREUR_MEDECIN_SOUSCRIPTEUR séparé de ASSUREUR_MEDECIN_CONSEIL, v9 §1.4), et profils
(avec numero_ordre_medecin et sa contrainte d'unicité, v10 §2.2). Dans apps/api, crée le
module NestJS `identity/` avec IdentityService (lecture des rôles/permissions via Prisma) et
IdentityController exposant GET /api/v1/identity/me (profil + permissions de l'utilisateur
courant).
```

### Phase 1 — Provisioning

```
PROMPT 4 — Module tenant (NestJS) + souscripteurs (Supabase)
Dans Supabase : table souscripteurs (v9 §1.2) et membres_comite_gestion (v9 §1.3). Dans
apps/api, crée le module `tenant/` avec les endpoints CRUD scopés par organisation_id
(vérification du rôle appelant dans chaque endpoint, en plus de la RLS Postgres —
défense en profondeur, v15 §6).
```

```
PROMPT 5 — Provisioning et policies RLS
Dans Supabase : table regles_provisioning remplie selon les règles exactes de v9 §1.4 et
v6 §4 (SUPERADMIN_PRINCIPAL, ASSUREUR_INFORMATIQUE, délégation PHARMACIE_PHARMACIEN avec
scope pharmacie_id — pas etablissement_id, correction v9 §1.5). Policies RLS INSERT sur
profils. Dans apps/api, le module `identity/` expose POST /api/v1/identity/comptes qui
vérifie la règle de provisioning AVANT d'appeler l'API Admin Supabase pour l'invitation —
double vérification (NestJS + RLS), jamais l'une sans l'autre.
```

```
PROMPT 6 — Invitations sécurisées
Table invitations (v5 §3, statuts incluant EN_ATTENTE_VALIDATION_INFORMATIQUE). Le module
`identity/` NestJS orchestre : création de la ligne invitation, appel à l'API Admin Supabase
(inviteUserByEmail) pour l'envoi réel, jamais de mot de passe généré ou visible côté NestJS.
```

```
PROMPT 7 — Interface de gestion des comptes (Next.js)
Page /dashboard-assureur/informatique/utilisateurs dans apps/web : formulaire (liste de
sous-rôles proposables récupérée depuis GET /api/v1/identity/roles-proposables, filtrée
côté NestJS selon regles_provisioning), tableau avec filtres, actions activer/désactiver.
Page propositions pour la délégation pharmacien → caissier.
```

### Phase 2 — Produit et souscription

```
PROMPT 8 — Module plan (NestJS) + produits/garanties (Supabase)
Tables produits et garanties versionnées (v3 §2). Module `plan/` NestJS : logique de
publication d'une nouvelle version, jamais de modification d'une version déjà publiée.
```

```
PROMPT 9 — Module policy (NestJS) + polices/avenants (Supabase)
Table polices (machine à états) et avenants (v3 §3). Module `policy/` NestJS : calcul de
proratisation à la création d'un avenant.
```

```
PROMPT 10 — Questionnaire médical et tarification individuelle
Table questionnaires_medicaux, décision réservée à ASSUREUR_MEDECIN_SOUSCRIPTEUR (vérifié
par le guard NestJS ET par RLS). Module `plan/` étendu avec tarification_individuelle
(v4 §3.2).
```

```
PROMPT 11 — Module billing (NestJS) — tarification collective
Tables grilles_tarifaires et plan_paiement_collectivite (v9 phase 2.5-2.6). Module
`billing/` NestJS pour le calcul de cotisation par tranche d'âge/société.
```

### Phase 3 — Adhérents et cartes

```
PROMPT 12 — Module member (NestJS) + adhérents/bénéficiaires (Supabase)
Tables adherents, beneficiaires (avec iban_ou_rib, mode_paiement_prefere). Module `member/`
NestJS avec les endpoints CRUD, policies RLS self-read/société/assureur déjà définies.
```

```
PROMPT 13 — Génération de cartes de membre
Dans le module `member/` NestJS : endpoint POST /api/v1/member/cartes/generer (unitaire ou
en lot), génération PDF avec QR code (librairie pdf-lib côté NestJS, cohérent avec Node),
upload vers Supabase Storage (bucket privé), retour d'URL signée.
```

### Phase 4 — Réseau de soins

```
PROMPT 14 — Module provider (NestJS) + établissements/pharmacies
Tables etablissements_sante, pharmacies avec géolocalisation. Module `provider/` NestJS
exposant la recherche géolocalisée (endpoint consommé par la carte react-leaflet côté
Next.js).
```

```
PROMPT 15 — Géocodage automatique et vérification périodique
Dans le module `provider/` NestJS : appel Nominatim à la création d'un établissement, table
verifications_etablissement, tâche planifiée (NestJS @Cron ou Supabase pg_cron) marquant
A_REVERIFIER après 12 mois.
```

### Phase 5 — Référentiels médicaux

```
PROMPT 16 — Référentiel actes et médicaments
Tables referentiel_actes, medicaments avec statuts PROPOSE/HOMOLOGUE/SUSPENDU/RETIRE.
Module `plan/` NestJS étendu, endpoints d'homologation réservés aux rôles conseil.
```

### Phase 6 — Parcours de soins et anti-fraude

```
PROMPT 17 — Module preauthorization (NestJS) — Dossier de Soins et Numéro de Traitement
Tables dossiers_soins, consultations_dossier (medecin_id lié à un vrai compte
CENTRE_MEDICAL_MEDECIN, correction v10 §1), actes_dossier. Module `preauthorization/`
NestJS avec le MoteurOuvertureDossier (vérifications carte/contrat/dossier ouvert/limite
consultations).
```

```
PROMPT 18 — Code de Consultation
Table codes_consultation. Module `preauthorization/` : génération du code, envoi (SMS via
un provider tiers + notification dans l'app), endpoint de saisie côté établissement qui
déclenche l'ouverture du DossierSoins — aucune autre voie de création du dossier.
```

```
PROMPT 19 — Code Référence d'Ordonnance
Table codes_ordonnance. Endpoint de saisie côté pharmacie qui débloque l'affichage du
contenu de l'ordonnance uniquement si le code est valide.
```

```
PROMPT 20 — Ticket de Soins
Table tickets_soins, rattachement des actes_dossier, blocage d'ajout après clôture
(vérifié dans le module `preauthorization/` NestJS, pas seulement en base).
```

```
PROMPT 21 — Code de Facturation
Colonnes code_facturation, code_valide_par_patient sur factures_dossier. Le module
`payment/` NestJS refuse d'appeler la confirmation de paiement si code_valide_par_patient
est faux — garde explicite dans le code, pas seulement une case cochée côté UI.
```

### Phase 7 — Réclamations et adjudication

```
PROMPT 22a — Module claims (NestJS)
Crée le module `claims/` NestJS : réception de la réclamation, verrouillage du statut
(SOUMISE → EN_ADJUDICATION, empêche le double déclenchement), puis appel HTTP au
microservice Java d'Adjudication (endpoint défini en v12 §3), réception de la décision
structurée, mise à jour de la réclamation.
```

```
PROMPT 22b à 22d — Microservice Java d'Adjudication
Reprendre tel quel les prompts 22b, 22c, 22d de v12 (Spring Boot, pipeline en une
transaction JDBC avec verrouillage FOR UPDATE, tests JUnit, Dockerfile) — aucune
modification, ce composant reste en Java pour la précision financière (BigDecimal),
appelé désormais par le module claims/ de NestJS plutôt que par une Edge Function Supabase.
```

---

## Fin du Palier 1 — Points de contrôle

- [ ] Le guard NestJS ET la policy RLS Postgres refusent tous deux une action hors périmètre
      (testez en désactivant volontairement l'un des deux pour vérifier que l'autre bloque
      toujours)
- [ ] Un dossier de soins ne peut être créé que via un code de consultation validé
- [ ] Une facture ne peut être réglée que via un code de facturation validé
- [ ] Le microservice Java répond correctement aux appels du module `claims/` NestJS, avec
      verrouillage du plafond vérifié sous double soumission simultanée

## Prochaine étape après le Palier 1

Déploiement : apps/web sur AWS Amplify, apps/api (NestJS) sur AWS ECS Fargate (même logique
que le microservice Java en v13, un Dockerfile Node au lieu d'un Dockerfile Java),
adjudication-service sur ECS Fargate (inchangé, v13), Supabase reste managé tel quel.
