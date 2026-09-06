---
name: saas-assurance-sante-afrique
version: 9.0-FINAL
description: >
  PLAN DIRECTEUR FINAL — document de référence unique qui consolide et corrige v1 à v8.
  Ne pas suivre les fichiers précédents indépendamment : ce document résout les
  incohérences de nommage et de logique accumulées au fil des extensions, et donne
  l'ordre d'exécution complet, phase par phase, pour une équipe de développement.
---

# Plan Directeur Final — Core System Assurance Santé Collective (v9)

## 0. Note de méthode

Ce document est la **synthèse faisant foi**. Les fichiers v1 à v8 restent utiles comme
documentation détaillée (schémas SQL complets, exemples de code), mais **ce document corrige
les incohérences** qui se sont accumulées à mesure que le projet s'est enrichi par itérations
successives — c'est normal dans une conception progressive, mais ça doit être nettoyé avant
exécution. Les corrections sont listées en §1 avant toute chose, puis le plan de travail
complet suit en §2 à §16.

---

## 1. Corrections apportées avant émission finale

### 1.1 Incohérence de nommage : établissement sanitaire vs "Centre Médical"

**Problème** : v1-v3 utilisaient l'entité/table `etablissements_sante` et le rôle
`ETABLISSEMENT_SANTE`. v6 a introduit l'entité `CENTRE_MEDICAL` avec ses sous-rôles
(`CENTRE_MEDICAL_MEDECIN`, etc.) sans jamais dire explicitement si c'est la même chose
renommée ou une entité distincte. v8 continue d'utiliser `etablissements_sante` dans son
schéma. Livré tel quel, un développeur créerait deux structures parallèles.

**Correction retenue** : `CENTRE_MEDICAL` (v6) est le **nom d'affichage de l'entité**
métier ; `etablissements_sante` reste le **nom de la table physique** (hérité de v1, ne pas
renommer une table déjà référencée par de nombreuses clés étrangères). Règle définitive :
partout où v6/v8 disent "CENTRE_MEDICAL", la clé étrangère technique pointe vers
`etablissements_sante(id)`.

### 1.2 Incohérence de nommage : société cliente vs souscripteur vs société affiliée

**Problème** : v1-v3 utilisaient `societes_clientes`. v4 a généralisé en `souscripteurs`
(type ENTREPRISE/COLLECTIVITE/INDIVIDUEL) pour couvrir les 3 segments. v6 a introduit
l'entité d'affichage `SOCIETE_AFFILIEE` avec ses sous-rôles, sans relier explicitement aux
deux précédentes.

**Correction retenue** : **une seule table physique**, `souscripteurs` (le modèle v4 est le
bon, le plus complet). `SOCIETE_AFFILIEE` (v6) est le nom d'entité/affichage pour les
souscripteurs de type `ENTREPRISE` et `COLLECTIVITE` (pas `INDIVIDUEL`, qui relève de
l'entité `ADHERENT`, cohérent avec v4 §3). La table `societes_clientes` mentionnée dans les
premiers schémas de v1-v3 est **abandonnée** au profit de `souscripteurs` — ne pas la créer
si vous partez de zéro.

### 1.3 Rôle de gouvernance des collectivités jamais raccordé à la hiérarchie de sous-rôles

**Problème** : v4 §2.1 introduit `GESTIONNAIRE_COLLECTIVITE` et une table
`membres_comite_gestion` pour la gouvernance à plusieurs titulaires des mutuelles
communautaires/coopératives. v6 §3 (la hiérarchie de sous-rôles) ne mentionne jamais ce rôle
— seulement `SOCIETE_ADMINISTRATION`, `SOCIETE_COMPTABLE`, etc., pensés pour une entreprise
classique avec un service RH unique.

**Correction retenue** : `SOCIETE_ADMINISTRATION` (v6) sert pour les deux cas
(entreprise et collectivité), mais pour une collectivité, **plusieurs comptes**
`SOCIETE_ADMINISTRATION` peuvent coexister sur le même `souscripteur_id`, chacun lié à une
ligne de `membres_comite_gestion` (v4 §2.1) précisant sa fonction (Président, Trésorier,
Secrétaire). `GESTIONNAIRE_COLLECTIVITE` en tant que code de rôle séparé est abandonné — il
est remplacé par `SOCIETE_ADMINISTRATION` + `membres_comite_gestion` pour éviter d'avoir deux
mécanismes concurrents pour la même chose.

### 1.4 Conflit d'intérêt non fermé : médecin souscripteur vs médecin conseil

**Problème** : v4 §3.1 exige explicitement une **séparation de fonction** entre le médecin
qui évalue le questionnaire médical à la souscription (décision d'acceptation/exclusion) et
le médecin qui liquide les sinistres (`MEDECIN_CONSEIL`) — pour éviter qu'une même personne
soit juge et partie. v4 §4 avait bien créé le rôle `MEDECIN_SOUSCRIPTEUR` pour ça. Mais la
liste consolidée des 24 sous-rôles en v6 §3.2 **a oublié ce rôle** — seul
`ASSUREUR_MEDECIN_CONSEIL` y figure. C'est une régression silencieuse entre v4 et v6.

**Correction retenue** : ajout du sous-rôle manquant.

```sql
insert into sous_roles (code, entite_code, libelle, role_parent_code, niveau_acces, peut_valider, dashboard_route)
values ('ASSUREUR_MEDECIN_SOUSCRIPTEUR','ASSUREUR','Médecin Souscripteur (évaluation à l''entrée)',
        null, 'MODIFICATION', true, '/dashboard-assureur/medecin-souscripteur');

insert into regles_provisioning (role_createur, role_cree, scope_verifie, mode)
values ('ASSUREUR_INFORMATIQUE','ASSUREUR_MEDECIN_SOUSCRIPTEUR','organisation_id','CREATION_DIRECTE');
```

`ASSUREUR_MEDECIN_SOUSCRIPTEUR` a accès à `questionnaires_medicaux` (v4 §3.1) en
lecture/décision, mais **aucun accès** aux réclamations/liquidations (`ASSUREUR_MEDECIN_CONSEIL`
en a l'exclusivité) — c'est la séparation qui protège l'assureur contre un conflit d'intérêt
et qui doit apparaître dans les policies RLS de `questionnaires_medicaux` et de
`reclamations` respectivement.

### 1.5 Bug de scope dans la règle de délégation pharmacien → caissier (v7)

**Problème** : v7 §1.1 insère la règle de provisioning avec `scope_verifie = 'etablissement_id'`
pour la délégation `PHARMACIE_PHARMACIEN → PHARMACIE_CAISSIERE`. Mais la policy RLS
réellement écrite en v7 §2.1 vérifie `p.pharmacie_id = invitations.pharmacie_id` — c'est
`pharmacie_id`, pas `etablissement_id`. Une pharmacie n'est pas un établissement sanitaire
dans ce modèle (deux tables distinctes depuis v1). Tel quel, la ligne de configuration ne
correspond pas à ce que la policy vérifie réellement.

**Correction retenue** :

```sql
update regles_provisioning
set scope_verifie = 'pharmacie_id'
where role_createur = 'PHARMACIE_PHARMACIEN' and role_cree = 'PHARMACIE_CAISSIERE';
```

### 1.6 Deux mécanismes d'audit qui se chevauchent

**Problème** : v2 §4 pose `audit_log` comme table générique. v5 §4 ajoute un trigger dédié
`audit_creation_compte`. v8 §6.2 ajoute un appel `log_audit('ANNULATION_ACTE', ...)` dans une
fonction métier. Trois points d'entrée différents vers, en principe, la même table — sans
garantie qu'ils utilisent tous la même fonction `log_audit()` avec la même signature.

**Correction retenue** : une seule fonction d'audit générique, appelée partout.

```sql
create or replace function log_audit(
  p_action text, p_table_cible text, p_enregistrement_id uuid,
  p_user_id uuid, p_details jsonb default null
) returns void language plpgsql as $$
begin
  insert into audit_log (organisation_id, user_id, action, table_cible, enregistrement_id, details, created_at)
  values (
    (select organisation_id from profils where id = p_user_id),
    p_user_id, p_action, p_table_cible, p_enregistrement_id, p_details, now()
  );
end;
$$;
```

Tout trigger ou toute fonction métier (création de compte, annulation d'acte, décision de
contestation, validation de proposition) appelle **cette seule fonction**, jamais une
insertion directe dans `audit_log` — sinon le format des lignes d'audit diverge avec le temps
et rend le reporting de conformité (v3 §14) peu fiable.

---

## 2. Dictionnaire final des entités (fait foi, remplace toute version antérieure)

| Entité (affichage) | Table physique | Segment couvert |
|---|---|---|
| SUPERADMIN | `profils` (role SUPERADMIN_*) | Plateforme |
| ASSUREUR | `organisations` + `profils` | Compagnie d'assurance / mutuelle |
| SOCIETE_AFFILIEE | `souscripteurs` (type ENTREPRISE ou COLLECTIVITE) | Entreprises et collectivités |
| ADHERENT | `adherents`, `beneficiaires`, `souscripteurs` (type INDIVIDUEL) | Salariés, membres, individus |
| CENTRE_MEDICAL | `etablissements_sante` | Réseau de soins |
| PHARMACIE | `pharmacies` | Réseau de soins |

---

## 3. Plan de travail progressif — phases d'exécution complètes

### PHASE 0 — Fondations transverses
*Préalable à tout développement métier.*
- 0.1 `organisations` + multi-tenant (v2 §2)
- 0.2 Dictionnaire des entités et rôles (§2 ci-dessus, fait foi)
- 0.3 Authentification email/mdp + MFA + SSO (v6 §1)
- 0.4 Profils enrichis : coordonnées bancaires, mode de connexion (v6 §2)
- 0.5 Fonction d'audit unique `log_audit()` (§1.6 ci-dessus — à créer en tout premier, tout
  le reste en dépend)

**Livrable de fin de phase** : projet Supabase initialisé, Auth fonctionnel, table
`organisations` et fonction d'audit en place, testables indépendamment de toute logique
métier.

### PHASE 1 — Gouvernance des accès (provisioning)
- 1.1 Table `souscripteurs` unifiée, 3 types (v4 §1, corrigé §1.2 ci-dessus)
- 1.2 Gouvernance collectivités par comité (v4 §2.1, corrigé §1.3 ci-dessus)
- 1.3 Hiérarchie de sous-rôles + héritage adjoint (v6 §3, corrigée avec l'ajout §1.4)
- 1.4 `regles_provisioning` + policies RLS d'insertion scopées (v5 §1-2, v6 §4, corrigée §1.5)
- 1.5 Flux d'invitation sécurisé, pas de mot de passe connu de l'admin (v5 §3)
- 1.6 Délégation contrôlée pharmacien → caissier (v7, avec correction du scope)
- 1.7 CRUD complet de gestion des comptes, formulaire + tableau + filtres (v6 §8)

**Livrable de fin de phase** : un SUPERADMIN peut créer un compte Assureur/Informatique ; un
compte Informatique Assurance peut provisionner tout le reste ; un pharmacien peut proposer
un caissier ; toute tentative hors périmètre est refusée par la base, pas seulement par
l'interface. Testable par des tentatives volontaires de contournement (tests de sécurité).

### PHASE 2 — Produit et souscription
- 2.1 Moteur de configuration produit, garanties versionnées (v3 §2)
- 2.2 Cycle de vie police + avenants (v3 §3)
- 2.3 Questionnaire médical + décision `ASSUREUR_MEDECIN_SOUSCRIPTEUR` (v4 §3.1, rôle ajouté §1.4)
- 2.4 Tarification individuelle au risque (v4 §3.2)
- 2.5 Tarification collectivité subventionnée + paiement saisonnier (v4 §2.2)
- 2.6 Grille tarifaire par tranche d'âge/société pour le collectif (v2 §11.2)

**Livrable de fin de phase** : un gestionnaire produit peut publier une formule d'assurance
sans intervention technique ; les 3 segments (entreprise, collectivité, individuel) ont
chacun leur logique de tarification et de souscription fonctionnelle.

### PHASE 3 — Adhérents, bénéficiaires, cartes
- 3.1 Adhérents et bénéficiaires (v1 §5A.2)
- 3.2 Génération de cartes de membre, unitaire et en lot (v2 §7)

### PHASE 4 — Réseau de soins
- 4.1 Établissements et pharmacies avec géolocalisation (v1 §9)
- 4.2 Grilles tarifaires conventionnées (v3 §5)
- 4.3 Automatisation géocodage à la saisie, vérification périodique, détection de doublons (v8 §9)

### PHASE 5 — Référentiels médicaux (MDM)
- 5.1 Nomenclatures CIM-10, actes, ATC (v3 §9)
- 5.2 Gouvernance d'homologation `PROPOSE → HOMOLOGUE → SUSPENDU/RETIRE` (v8 §10)

**Livrable de fin de phase** : aucun acte ou médicament n'est remboursable sans homologation
explicite par un médecin/pharmacien conseil ; le réseau de soins se met à jour avec un
minimum d'intervention manuelle.

### PHASE 6 — Parcours de soins et système anti-fraude à 4 codes
- 6.1 Dossier de Soins / Numéro de Traitement (v1 §15) — **rappel** : c'est le socle sur
  lequel s'accroche tout ce qui suit
- 6.2 Code Consultation (v8 §2)
- 6.3 Code Ordonnance (v8 §3)
- 6.4 Ticket de Soins (v8 §4)
- 6.5 Code Facturation (v8 §5)

**Livrable de fin de phase** : impossible de créer un dossier de soins, une dispensation en
pharmacie, ou de régler une facture sans un code transmis et confirmé par le patient lui-même
— testable en tentant de contourner chaque étape via l'API directement.

### PHASE 7 — Réclamations et adjudication
- 7.1 Pipeline d'adjudication multi-règles + codes de rejet normalisés (v3 §4)
- 7.2 Coordination avec la CMU (v4 §2.3)
- 7.3 Calcul de remboursement (v2 §5)
- 7.4 Verrouillage optimiste sur les plafonds (v3 §4.3 — **critique**, ne pas sauter cette
  sous-étape, c'est une faille financière réelle si oubliée)

### PHASE 8 — Workflow de validation multi-acteurs
- 8.1 Moteur BPM configurable (v3 §6)
- 8.2 Rôles conseil réconciliés avec la hiérarchie de sous-rôles (`ASSUREUR_MEDECIN_CONSEIL`,
  `ASSUREUR_PHARMACIEN_CONSEIL`, `ASSUREUR_EXPLOITATION`, `ASSUREUR_COMPTABLE` — v3 §14 +
  v6 §3.4)
- 8.3 Pouvoir d'annulation d'acte/prescription avec recalcul automatique (v8 §6)
- 8.4 Ticket de contestation avant consolidation (v8 §7)

### PHASE 9 — Finance et paiement
- 9.1 Paiement Mobile Money avec idempotence (v2 §11.3)
- 9.2 Consolidation mensuelle, exclusion automatique des litiges ouverts (v8 §8)
- 9.3 Comptabilité technique séparée (v3 §7.3)

### PHASE 10 — Actuariat et réassurance *(Palier 3, ne pas anticiper — voir §4)*
- 10.1 Provisions IBNR, ratio Sinistres/Primes (v3 §7)
- 10.2 Réassurance : traités, rétention, priorité (v3 §8)

### PHASE 11 — Data, Business Intelligence, Intelligence Artificielle
- 11.1 Data Warehouse séparé, modèle en étoile (v3 §11)
- 11.2 Agent IA conversationnel, strictement lecture seule et scopé au JWT de l'utilisateur (v2 §6)
- 11.3 Moteur documentaire et correspondance (v3 §12)

### PHASE 12 — Expérience utilisateur
- 12.1 Dashboards générés par sous-rôle, composants ShadCN + Recharts (v6 §7)
- 12.2 Canaux omnicanaux : portail, PWA, WhatsApp Business, centre d'appel (v3 §13)

### PHASE 13 — Sécurité, conformité, fiabilité opérationnelle
- 13.1 Sécurité niveau entreprise : chiffrement champ, gouvernance des données, PIA (v3 §14)
- 13.2 Conformité CIMA + trajectoire IFRS 17 (v3 §14)
- 13.3 SRE : SLO, RTO/RPO testés, PCA (v3 §15)
- 13.4 Qualité logicielle : tests actuariels obligatoires, non-régression (v3 §16)
- 13.5 Gouvernance produit et release management (v3 §17)

---

## 4. Feuille de route de maturité — ce qu'il ne faut PAS construire trop tôt

| Palier | Phases incluses | Ne pas anticiper avant |
|---|---|---|
| **1 — MVP** | Phases 0 à 4, 6, 7 (sans coordination CMU ni actuariat) | Premières sociétés clientes signées |
| **2 — Croissance** | Phases 5, 8, 9, 12 | Volume suffisant pour justifier le BPM configurable et la consolidation mensuelle automatisée |
| **3 — Entreprise** | Phases 10, 11, 13 | Historique de sinistralité réel (12-24 mois minimum) — construire l'actuariat sur des données simulées produit des modèles faux et coûteux à corriger |

---

## 5. Checklist finale de cohérence (à cocher avant tout développement)

- [ ] Aucune table `societes_clientes` créée séparément de `souscripteurs` (§1.2)
- [ ] `profils.role` référence `sous_roles(code)`, pas une liste `check` codée en dur héritée
      de v2/v3
- [ ] `ASSUREUR_MEDECIN_SOUSCRIPTEUR` existe et n'a **aucun accès** à `reclamations` ou
      `factures_dossier` (séparation de fonction, §1.4)
- [ ] La règle de délégation pharmacien → caissier utilise `pharmacie_id`, pas
      `etablissement_id` (§1.5)
- [ ] Toute écriture dans `audit_log` passe par `log_audit()`, aucune insertion directe (§1.6)
- [ ] Le verrouillage optimiste sur les plafonds (Phase 7.4) est en place avant l'ouverture
      du système à plus d'un utilisateur simultané
- [ ] Aucun acte/médicament n'est remboursable sans statut `HOMOLOGUE` (Phase 5.2)
- [ ] Aucune facture ne peut être réglée sans `code_valide_par_patient = true` (Phase 6.5)

Ce document est désormais la référence unique à donner à Cursor, phase par phase, dans
l'ordre indiqué en §3 — un prompt par sous-étape, une validation avant de passer à la
suivante, conformément à la règle d'exécution posée depuis la toute première version de ce
skill.

---

## ADDENDUM — Corrections découvertes lors de la première tentative d'exécution

### A. Liste SQL complète des 25 sous-rôles (manquait, a bloqué le PROMPT 3)

```sql
insert into sous_roles (code, entite_code, libelle, role_parent_code, niveau_acces, peut_valider, dashboard_route) values

-- SUPERADMIN (2)
('SUPERADMIN_PRINCIPAL','SUPERADMIN','Superadministrateur', null,'ADMIN', true, '/dashboard-superadmin/principal'),
('SUPERADMIN_UTILISATEUR_ADMIN','SUPERADMIN','Utilisateur Administrateur','SUPERADMIN_PRINCIPAL','ADMIN', false, '/dashboard-superadmin/utilisateur-admin'),

-- ASSUREUR (10, dont ASSUREUR_MEDECIN_SOUSCRIPTEUR = correction v9 §1.4)
('ASSUREUR_DIRECTION','ASSUREUR','Assurance de Direction', null,'ADMIN', true, '/dashboard-assureur/direction'),
('ASSUREUR_INFORMATIQUE','ASSUREUR','Assurance Informatique', null,'ADMIN', true, '/dashboard-assureur/informatique'),
('ASSUREUR_INFORMATIQUE_ADJOINT','ASSUREUR','Assurance Informatique Adjointe','ASSUREUR_INFORMATIQUE','MODIFICATION', false, '/dashboard-assureur/informatique-adjoint'),
('ASSUREUR_COMPTABLE','ASSUREUR','Assurance Comptable', null,'MODIFICATION', true, '/dashboard-assureur/comptable'),
('ASSUREUR_COMPTABLE_ADJOINT','ASSUREUR','Comptable Adjoint Assurance','ASSUREUR_COMPTABLE','MODIFICATION', false, '/dashboard-assureur/comptable-adjoint'),
('ASSUREUR_EXPLOITATION','ASSUREUR','Assurance d''Exploitation', null,'MODIFICATION', true, '/dashboard-assureur/exploitation'),
('ASSUREUR_EXPLOITATION_CONJOINTE','ASSUREUR','Assurance d''Exploitation Conjointe','ASSUREUR_EXPLOITATION','MODIFICATION', true, '/dashboard-assureur/exploitation-conjointe'),
('ASSUREUR_MEDECIN_CONSEIL','ASSUREUR','Médecin Conseil', null,'MODIFICATION', true, '/dashboard-assureur/medecin-conseil'),
('ASSUREUR_MEDECIN_SOUSCRIPTEUR','ASSUREUR','Médecin Souscripteur (évaluation à l''entrée)', null,'MODIFICATION', true, '/dashboard-assureur/medecin-souscripteur'),
('ASSUREUR_PHARMACIEN_CONSEIL','ASSUREUR','Pharmacien Conseil', null,'MODIFICATION', true, '/dashboard-assureur/pharmacien-conseil'),

-- PHARMACIE (3)
('PHARMACIE_PHARMACIEN','PHARMACIE','Pharmacien (titulaire)', null,'MODIFICATION', true, '/dashboard-pharmacie/pharmacien'),
('PHARMACIE_COMPTABLE','PHARMACIE','Pharmacien Comptable', null,'MODIFICATION', false, '/dashboard-pharmacie/comptable'),
('PHARMACIE_CAISSIERE','PHARMACIE','Pharmacie - Caissière', null,'MODIFICATION', false, '/dashboard-pharmacie/caissiere'),

-- CENTRE_MEDICAL (4)
('CENTRE_MEDICAL_MEDECIN','CENTRE_MEDICAL','Médecin Centre Médical', null,'MODIFICATION', true, '/dashboard-centre-medical/medecin'),
('CENTRE_MEDICAL_COMPTABLE','CENTRE_MEDICAL','Comptable Centre Médical', null,'MODIFICATION', false, '/dashboard-centre-medical/comptable'),
('CENTRE_MEDICAL_ACCUEIL','CENTRE_MEDICAL','Centre d''Accueil Médical', null,'MODIFICATION', false, '/dashboard-centre-medical/accueil'),
('CENTRE_MEDICAL_ADMINISTRATIF','CENTRE_MEDICAL','Centre Administratif Médical', null,'MODIFICATION', false, '/dashboard-centre-medical/administratif'),

-- SOCIETE_AFFILIEE (4)
('SOCIETE_ASSUREE','SOCIETE_AFFILIEE','Société Assurée (contact principal)', null,'ADMIN', true, '/dashboard-societe/assuree'),
('SOCIETE_COMPTABLE','SOCIETE_AFFILIEE','Société Comptable', null,'MODIFICATION', false, '/dashboard-societe/comptable'),
('SOCIETE_RECEPTION','SOCIETE_AFFILIEE','Société de Réception', null,'LECTURE_SEULE', false, '/dashboard-societe/reception'),
('SOCIETE_ADMINISTRATION','SOCIETE_AFFILIEE','Société d''Administration', null,'MODIFICATION', true, '/dashboard-societe/administration'),

-- ADHERENT (2)
('ADHERENT_TITULAIRE','ADHERENT','Adhérent Principal', null,'MODIFICATION', false, '/dashboard-adherent'),
('SOUSCRIPTEUR_INDIVIDUEL','ADHERENT','Souscripteur Individuel', null,'MODIFICATION', false, '/dashboard-adherent/individuel');
```
**Total : 25 sous-rôles** (pas 24 — corrigé après l'ajout d'ASSUREUR_MEDECIN_SOUSCRIPTEUR, v9 §1.4).

### B. Vérification JWT via JWKS, pas de secret partagé
Le projet utilise les nouvelles clés Supabase (sb_publishable_/sb_secret_) avec signature
JWT asymétrique (ECC P-256). Utiliser SUPABASE_JWKS_URL (https://<project-ref>.supabase.co/auth/v1/jwks),
jamais SUPABASE_JWT_SECRET — cette variable n'existe pas dans ce projet.

### C. Next.js 16, pas 14
Next.js 14 est en fin de vie (EOL) depuis le 26/10/2025, plus aucun correctif de sécurité.
Utiliser Next.js 16 (version stable maintenue) partout où "Next.js 14" apparaît dans les
fichiers de référence plus anciens (v1 à v17).

### D. Connecteur MCP Supabase — configuration sécurisée obligatoire
Ne jamais utiliser l'URL MCP par défaut sans paramètres. Toujours scoper :
```
https://mcp.supabase.com/mcp?project_ref=<votre-project-ref>&read_only=true&features=docs,database,development,functions
```
Repasser en read_only=false uniquement le temps d'une écriture, remettre true immédiatement après.
