---
name: saas-assurance-sante-afrique
version: 12.0
description: >
  Extension v12 — isole le moteur d'adjudication/calcul de remboursement (v3 §4) dans un
  microservice Java Spring Boot dédié, avec sa propre frontière transactionnelle, son propre
  rôle de base de données restreint, et un canal d'appel sécurisé depuis Supabase. Le reste
  du système (Auth, cartes, dashboards, réseau de soins) reste en Next.js + Supabase.
---

# Extension v12 — Microservice Java d'adjudication et de remboursement

## 1. Architecture cible

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js + Supabase (inchangé pour tout le reste)             │
│  Adhérent soumet une réclamation → reclamations.statut='SOUMISE'│
└───────────────────────────┬───────────────────────────────────┘
                            │ trigger (Edge Function)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Edge Function "declencher-adjudication"                       │
│  1. Verrouille la réclamation : statut SOUMISE → EN_ADJUDICATION│
│     (empêche un double déclenchement)                          │
│  2. Signe un jeton de service (JWT court, secret partagé)       │
│  3. Appelle POST /api/v1/adjudication/{id}/evaluer              │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS + JWT de service
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MICROSERVICE JAVA (Spring Boot) — propriétaire de la          │
│  transaction complète d'adjudication                            │
│  - connexion JDBC dédiée (rôle Postgres svc_adjudication)        │
│  - une seule transaction : lecture verrouillée du plafond,       │
│    pipeline de règles, écriture du remboursement                 │
│  - retourne la décision structurée                               │
└───────────────────────────┬───────────────────────────────────┘
                            │ écrit directement dans Postgres
                            ▼
                    reclamations / remboursements / audit_log
```

---

## 2. Sécurité — rôle de base de données dédié et restreint

```sql
-- Rôle technique, jamais utilisé par un humain, jamais exposé côté client
create role svc_adjudication login password '...' bypassrls;

-- Grants STRICTEMENT nécessaires, rien de plus
grant select on plans_couverture, garanties, grilles_tarifaires,
  referentiel_actes, medicaments to svc_adjudication;
grant select (id, adherent_id, police_id, date_soin, montant, type) on reclamations to svc_adjudication;
grant update (statut) on reclamations to svc_adjudication;
grant insert on remboursements to svc_adjudication;
grant execute on function log_audit(text, text, uuid, uuid, jsonb) to svc_adjudication;
```

**Pourquoi `bypassrls` est acceptable ici, et seulement ici** : ce rôle n'est jamais utilisé
par une session utilisateur — aucun `auth.uid()` n'existe dans son contexte, donc les policies
RLS (qui filtrent par `auth.uid()`) le bloqueraient complètement, pas seulement le
restreindraient. La protection ne vient donc pas de RLS pour ce rôle, mais de trois choses
combinées : (1) grants de colonnes explicitement limités ci-dessus, (2) le service n'est
joignable que depuis l'Edge Function interne, jamais depuis Internet, (3) **chaque** calcul
est journalisé via `log_audit()` — aucune écriture silencieuse possible.

### Authentification service-à-service

```
Edge Function → génère un JWT signé avec un secret partagé (stocké dans les variables
d'environnement Supabase ET du microservice Java, jamais dans le code) → validé côté Java
par un filtre Spring Security avant d'accepter toute requête.
```

---

## 3. Contrat d'API

```
POST /api/v1/adjudication/{reclamationId}/evaluer
Authorization: Bearer <jwt-service-signé>

Réponse 200 :
{
  "decision": "AUTO_ADJUDIQUE" | "REVUE_MANUELLE" | "REJETE",
  "montant_rembourse": 12500,
  "codes_rejet": ["E006"],
  "plafond_restant_apres": 87500,
  "duree_traitement_ms": 43
}
```

Idempotent par construction : si la réclamation n'est pas au statut `EN_ADJUDICATION`
attendu, le service refuse (409 Conflict) — impossible de traiter deux fois la même
réclamation même en cas de retry réseau.

---

## 4. Prompts Cursor/Claude Code — remplace le PROMPT 22 de v11

Ces prompts remplacent le PROMPT 22 de `cursor-prompts-execution-guide.md`. Le microservice
vit dans un **second dossier/dépôt** distinct du projet Next.js — Claude Code gère très bien
les deux, l'un après l'autre.

```
PROMPT 22a — Préparation côté Supabase
Crée le rôle Postgres svc_adjudication avec exactement les grants suivants : [copier les
grants de la section 2 ci-dessus]. Crée une Edge Function declencher-adjudication qui
verrouille la réclamation (statut SOUMISE → EN_ADJUDICATION en une seule requête UPDATE ...
WHERE statut = 'SOUMISE' RETURNING id — refuse si aucune ligne affectée), génère un JWT de
service signé avec un secret partagé (variable d'environnement SERVICE_JWT_SECRET), puis
appelle le microservice Java à l'URL configurée en variable d'environnement.
```

```
PROMPT 22b — Initialisation du microservice Java
Dans un nouveau dossier adjudication-service/, crée un projet Spring Boot 3 (Java 21,
Maven) avec les dépendances : spring-boot-starter-web, spring-boot-starter-jdbc,
postgresql driver, spring-boot-starter-security, spring-boot-starter-test, junit5. Configure
la connexion JDBC vers Postgres via variables d'environnement (JDBC_URL, JDBC_USER,
JDBC_PASSWORD — jamais en dur). Ajoute un filtre Spring Security qui valide un JWT signé
avec un secret partagé (HMAC) sur toute requête entrante, rejette sinon en 401.
```

```
PROMPT 22c — Pipeline d'adjudication en Java
Implémente AdjudicationController (POST /api/v1/adjudication/{id}/evaluer) et
AdjudicationService qui exécute, dans UNE SEULE transaction JDBC (@Transactional) :
1. SELECT reclamation + plan_couverture + garantie applicable
2. Vérification éligibilité (police active à la date de soin), carence, doublon
3. SELECT plafond_annuel - SUM(remboursements de l'année) FOR UPDATE (verrouillage
   pessimiste sur la ligne, pas un simple SELECT)
4. Calcul du montant (taux, franchise, min avec plafond restant)
5. INSERT dans remboursements, UPDATE reclamations.statut selon le résultat
6. Appel de log_audit() pour tracer la décision
Retourne la décision structurée (voir contrat d'API section 3). Génère des tests JUnit
avec un jeu de données de référence couvrant : cas normal, cas plafond dépassé, cas
carence active, cas doublon détecté — chaque test vérifie un montant exact, pas
approximatif (zéro tolérance sur le calcul financier, conformément à la règle qualité
du plan directeur).
```

```
PROMPT 22d — Déploiement du microservice
Crée un Dockerfile multi-stage pour le service Spring Boot (build Maven puis image légère
JRE). Documente dans un README les variables d'environnement requises (JDBC_URL,
JDBC_USER, JDBC_PASSWORD, SERVICE_JWT_SECRET) et une configuration de déploiement simple
(ex: Fly.io ou Railway pour un démarrage rapide en solo, avec connexion sécurisée vers la
base Postgres de Supabase).
```

---

## 5. Ce qui ne change pas

Tout le reste du plan directeur (v9) et de la séquence de prompts (v11) reste identique —
seul le PROMPT 22 est remplacé par 22a-22d. Les référentiels (actes, médicaments), le réseau
de soins, les cartes, les dashboards, l'authentification restent en Next.js + Supabase, sans
aucune modification.

## 6. Point de vigilance à ne pas oublier

Le microservice Java devient, de fait, le composant qui déplace le plus d'argent dans le
système — traitez son code review et ses tests avec au moins autant de rigueur que la
sécurité des comptes (v5-v7). Avant mise en production réelle : faites relire le pipeline de
calcul par quelqu'un d'autre que Claude Code seul, même brièvement — un second regard humain
sur la logique financière, pas seulement sur le code.
