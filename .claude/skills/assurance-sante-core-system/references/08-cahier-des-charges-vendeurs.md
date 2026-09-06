# CAHIER DES CHARGES
## Core System de Gestion d'Assurance / Mutuelle Santé Collective
### Document à l'attention des fournisseurs — Côte d'Ivoire

**Nom provisoire du système :** MUGCM HealthCore *(à adapter selon votre structure)*
**Version du document :** 1.0
**Périmètre géographique :** Côte d'Ivoire (zone CIMA), devise FCFA/XOF

---

## 0. Préambule — à lire avant toute proposition

### 0.1 Objet du document
Ce cahier des charges décrit les exigences fonctionnelles, techniques, réglementaires et
contractuelles d'un **Core System d'administration d'assurance/mutuelle santé** (Benefits
Administration + Claims Adjudication + Pharmacy Benefits Management), destiné à gérer
plusieurs sociétés d'assurance/mutuelles, plusieurs entreprises clientes, plusieurs formules
de couverture et un réseau de prestataires de soins, en environnement multi-tenant SaaS.

### 0.2 Avertissement sur l'adéquation périmètre/budget
Le porteur du projet dispose d'un budget initial de l'ordre de **10 millions FCFA** pour la
Phase 1 (MVP). Ce budget doit être mis en regard du périmètre décrit en §2 et de
l'architecture recommandée en §6. **Toute proposition doit indiquer explicitement** :
- le périmètre fonctionnel réellement livrable dans cette enveloppe ;
- les fonctionnalités reportées à une phase ultérieure et leur coût estimé séparé ;
- si l'architecture microservices complète (§6) est proposée dès la Phase 1, ou si une
  architecture simplifiée équivalente fonctionnellement est proposée pour cette enveloppe,
  avec une trajectoire d'évolution vers l'architecture cible.

Une proposition qui promet l'intégralité du périmètre décrit dans ce document, avec
l'architecture complète de microservices, pour ce budget et ce délai, doit être examinée
avec un scepticisme particulier — demandez une décomposition détaillée des livrables et des
charges avant signature.

### 0.3 Principe directeur
Ce cahier des charges exprime des **exigences fonctionnelles** ("le système doit permettre
de..."). L'architecture technique proposée en §6 est une **recommandation**, pas une
obligation contractuelle absolue — un fournisseur peut proposer une architecture alternative
s'il démontre qu'elle répond de façon équivalente ou supérieure aux exigences fonctionnelles,
notamment en matière de sécurité, d'isolation multi-tenant, et de robustesse des calculs
financiers.

---

## 1. Contexte et objectifs

Le système doit permettre à une société d'assurance, mutuelle, société d'assistance ou
administrateur de régimes de gérer entièrement la chaîne :

> Sociétés d'assurance/mutuelles → sociétés clientes → adhérents → ayants droit → contrats →
> cotisations → couverture → prestataires → prestations → prises en charge → réclamations →
> adjudication → facturation → paiement → contrôle → reporting.

Le système doit fonctionner en Côte d'Ivoire, en FCFA, avec plusieurs sociétés
d'assurance/mutuelles hébergées sur la même plateforme, plusieurs entreprises clientes par
société, plusieurs formules par société, plusieurs réseaux de prestataires, et être capable
de monter en charge de quelques centaines à plusieurs centaines de milliers d'adhérents sans
réécriture complète.

---

## 2. Périmètre fonctionnel

### 2.1 Modèle multi-tenant (exigence fondamentale)
- Isolation complète des données entre sociétés hébergées — une société ne doit **jamais**
  pouvoir accéder, même accidentellement, aux données d'une autre société.
- Chaque société possède : son code assureur unique, ses utilisateurs, ses clients, ses
  adhérents, ses produits, ses prestataires, ses règles de couverture, ses finances, ses
  statistiques, de façon totalement cloisonnée.

### 2.2 Gouvernance des accès — hiérarchie de provisioning (exigence précise du porteur)

Cette section formalise une exigence spécifique et non négociable :

1. **Le Super Administrateur de la plateforme** crée les sociétés d'assurance, leur attribue
   un code assureur unique, et crée le premier compte administrateur de chaque société — lui
   seul a ce pouvoir.
2. **Le compte administrateur "Informatique"** de chaque société d'assurance est le seul
   habilité à créer et activer/désactiver **tous les autres comptes** : autres
   administrateurs, médecins-conseils, pharmaciens-conseils, comptables, gestionnaires,
   comptes des établissements sanitaires partenaires, comptes des pharmacies partenaires, et
   comptes des sociétés clientes.
3. **Chaque société cliente** ne gère que les accès de ses propres employés/adhérents (accès
   scopés à sa propre société, jamais transversal).
4. Toute création de compte doit être **auditée** (qui a créé quel compte, quand, pour quel
   rôle) et **sécurisée** (l'administrateur créateur ne doit jamais connaître le mot de passe
   du compte créé — définition du mot de passe par l'utilisateur lui-même via invitation).

### 2.3 Gestion des sociétés clientes
Pour chaque entreprise cliente : informations légales, contrat, dates de début/fin, formule,
effectif salarié, nombre d'ayants droit, cotisation, réseau de soins applicable, historique.
Portail dédié permettant à l'entreprise cliente de consulter ses employés, ajouter/retirer un
employé, ajouter un ayant droit, consulter les cotisations, télécharger les factures,
consulter des statistiques, et **importer/mettre à jour ses membres en masse**.

### 2.4 Gestion des adhérents et ayants droit
- Création individuelle, import Excel/CSV, import massif (plusieurs milliers d'enregistrements
  en une opération), et **mise à jour en masse** — exigence explicite : les informaticiens de
  la société d'assurance doivent pouvoir mettre à jour en masse la liste des adhérents et
  ayants droit, pas seulement les importer une fois.
- L'import massif doit : valider le fichier, détecter les doublons, détecter les erreurs,
  signaler les lignes incorrectes, importer uniquement les données valides, produire un
  rapport d'import exploitable.
- Gestion des ayants droit (conjoint, enfants, autres personnes couvertes selon contrat), avec
  identifiant unique, numéro d'adhérent, lien de parenté, statut, couverture, historique.
- Cycle de vie complet : création, modification, activation, suspension, résiliation,
  renouvellement.

### 2.5 Carte d'assuré numérique
Carte numérique par membre : nom, prénom, numéro adhérent, numéro contrat, code assureur,
date de validité, QR Code permettant au prestataire de vérifier instantanément l'identité et
les droits du membre.

### 2.6 Produits et moteur de règles de couverture
- Création de formules de santé paramétrables par l'administrateur (taux de couverture par
  catégorie d'acte, plafonds, franchises, exclusions, délais de carence, fréquences
  autorisées, quantités maximales, réseau de prestataires autorisé).
- Moteur de règles calculant automatiquement la part assurance / part patient à partir de ces
  paramètres, sans intervention technique pour créer une nouvelle formule.

### 2.7 Réseau de prestataires
Gestion des établissements sanitaires (cliniques, hôpitaux, centres de santé, laboratoires),
pharmacies, médecins, spécialistes, dentistes, opticiens — avec pour chacun : code, nom,
localisation géographique, contacts, contrat, tarifs négociés, services couverts, statut,
coordonnées bancaires/Mobile Money, documents administratifs.

### 2.8 Portails prestataires (établissement sanitaire et pharmacie)
Chaque prestataire dispose de son propre portail lui permettant de : rechercher un adhérent,
scanner son QR Code, vérifier son éligibilité en temps réel, demander une prise en charge,
saisir une prestation, joindre des documents justificatifs, suivre l'état de sa demande,
soumettre une facture, suivre le statut de son paiement.

### 2.9 Prise en charge en temps réel — workflow détaillé
```
Patient → Prestataire → Scan QR Code → Vérification automatique
  (membre actif ? cotisation à jour ? formule ? prestation couverte ?
   plafond disponible ? délai de carence ? exclusion ?)
→ Autorisation automatique OU contrôle médical
→ Médecin-conseil si nécessaire
→ Décision : Accepté / Accepté partiellement / Refusé
```

### 2.10 Contrôle médical et pharmaceutique interne (exigence précise du porteur)
- **Le médecin-conseil de la société d'assurance vérifie et valide les prestations avant
  tout traitement/paiement** — portail dédié avec accès au diagnostic, à l'acte demandé, à la
  prescription, au rapport médical, à l'historique, au plafond disponible, aux règles de
  couverture applicables. Décisions : approuver, refuser, demander des informations
  complémentaires. Chaque décision est auditée (qui, quand, quelle décision, quel motif).
- **Le pharmacien-conseil de la société d'assurance vérifie les prescriptions de médicaments
  servies en pharmacie, en amont de la consolidation des factures** — contrôle de
  l'ordonnance, des médicaments prescrits, de la quantité, de la posologie, de la conformité,
  de la couverture, des plafonds. Décisions : valider, refuser, demander une modification.

### 2.11 Code de référence et de vérification (exigence précise du porteur)
Pour **chaque** opération sensible — prestation, acte médical, prescription d'ordonnance, et
paiement de facture — un **code de référence et de vérification unique** est généré et
transmis :
- par SMS ;
- par WhatsApp ;
- dans la plateforme (espace client ou espace adhérent, selon l'opération).

Ce code permet de confirmer l'authenticité de l'opération et la présence réelle du
bénéficiaire — c'est le mécanisme central de prévention de la fraude (facturation d'actes
fictifs, complicité entre un établissement et un adhérent).

### 2.12 Réclamations et adjudication
Gestion complète : soumission, réception, contrôle, validation, adjudication automatique,
rejet motivé, demande d'information complémentaire, paiement — chaque réclamation possède un
identifiant unique traçable. Le moteur d'adjudication calcule automatiquement, à partir du
contrat, de la formule, du tarif, de la couverture, du plafond, des exclusions et de
l'historique, la répartition exacte entre part assurance et part patient.

### 2.13 Pharmacy Benefit Management
Gestion des médicaments couverts/exclus, des génériques, des prix négociés, des plafonds, des
fréquences autorisées, des prescriptions, des règles d'incompatibilité, et des pharmacies
autorisées à délivrer.

### 2.14 Facturation, cotisations et paiements
- Facturation prestataire, facturation client, cotisation, remboursement, paiement
  prestataire, avoir, rejet, rapprochement.
- Cotisations mensuelles/trimestrielles/annuelles, par adhérent ou par famille, gestion des
  échéances, des impayés, des relances, des pénalités contractuelles.
- Intégration des moyens de paiement effectivement disponibles et autorisés en Côte d'Ivoire :
  Orange Money, MTN MoMo, Moov Money, Wave, virement bancaire, et à terme carte bancaire —
  chaque intégration doit être traitée séparément dans la proposition du fournisseur, avec
  confirmation de sa disponibilité réelle et de son coût.

### 2.15 Application mobile / portail adhérent
Dashboard (statut de couverture, formule, date d'expiration, plafond disponible), carte
digitale et QR Code, recherche géolocalisée de cliniques/pharmacies, demande de prise en
charge, historique, réclamations, cotisations, notifications, documents, gestion du profil.

### 2.16 Notifications multicanales
SMS, WhatsApp, email, notifications push mobile — déclenchées par les événements clés (prise
en charge, réclamation, paiement, échéance de cotisation).

### 2.17 Portails de pilotage
- Portail administrateur assurance/mutuelle : nombre d'adhérents actifs/suspendus,
  cotisations, impayés, prestations, réclamations, dépenses, remboursements, prestataires,
  sinistralité.
- Dashboard direction avec indicateurs clés : ratio sinistres/cotisations, coût moyen par
  adhérent, top prestataires, top prestations, top médicaments, réclamations, alertes de
  fraude/anomalies.

### 2.18 Détection de fraude
Identification d'anomalies : même prestation facturée plusieurs fois, facturation excessive,
prestations inhabituelles, utilisation anormale, dépassement de plafond, ordonnance
suspecte, prestataire avec fréquence anormale, utilisation simultanée impossible (même membre
à deux endroits en même temps). Une première version à règles déterministes est acceptable ;
l'intégration d'IA peut venir en phase ultérieure.

### 2.19 Gestion documentaire
Stockage sécurisé (type objet, compatible S3) des ordonnances, factures, rapports médicaux,
contrats, pièces d'identité, justificatifs, documents prestataires.

### 2.20 Audit
Toutes les opérations sensibles doivent être tracées de façon immuable et exploitable par les
administrateurs autorisés : qui a modifié un plafond, qui a validé une prise en charge, qui a
modifié un adhérent, qui a changé un taux de couverture, qui a validé une facture, qui a créé
un prestataire, qui a créé un compte utilisateur.

### 2.21 Import/Export
Formats Excel, CSV, API, PDF — import massif pour adhérents, ayants droit, prestataires,
médicaments, tarifs, contrats ; export pour adhérents, contrats, prestations, réclamations,
factures, paiements, prestataires, historique, documents.

---

## 3. Rôles et permissions (RBAC)

Rôles minimums attendus, avec permissions granulaires (pas de rôle "administrateur" fourre-
tout) :

```
SUPER_ADMIN               — plateforme, hors périmètre d'une société
TENANT_ADMIN               — direction de la société d'assurance
IT_ADMIN                   — provisioning de tous les comptes de la société (§2.2)
MEDICAL_ADVISOR             — médecin-conseil (validation prestations, §2.10)
PHARMACY_ADVISOR            — pharmacien-conseil (validation prescriptions, §2.10)
CLAIMS_MANAGER              — gestion des réclamations
ACCOUNTANT                  — comptabilité, consolidation des factures
CLIENT_ADMIN                — administrateur de la société cliente
PROVIDER_ADMIN               — administrateur d'un établissement/pharmacie partenaire
DOCTOR                       — médecin traitant au sein d'un établissement partenaire
PHARMACIST                   — pharmacien au sein d'une pharmacie partenaire
MEMBER                       — adhérent
```

Exigence explicite : le fournisseur doit démontrer une **séparation de fonction** entre le
médecin qui valide une prestation en tant que médecin-conseil et tout médecin qui exercerait
par ailleurs dans un établissement partenaire — aucune personne ne doit pouvoir valider une
prestation qu'elle a elle-même prescrite sous une autre casquette.

---

## 4. Modèle de données principal (indicatif, à affiner par le fournisseur)

```
Tenant / Organization / User / Role / Permission
Member / Dependent / Beneficiary
Product / Plan / Coverage / CoverageRule / Exclusion / WaitingPeriod / Limit
Policy / Contract / Enrollment
Contribution / Invoice / Payment
Provider / Facility / Pharmacy / Doctor / Pharmacist
Preauthorization / MedicalReview
Claim / ClaimLine / Prescription / MedicalAct / Medication
Adjudication / Settlement
VerificationCode (couvre §2.11 — consultation, ordonnance, prestation, facture)
Notification / Document / AuditLog
```

---

## 5. Exigences techniques et architecture recommandée

### 5.1 Stack recommandée
Backend en microservices (Java/Spring Boot ou équivalent justifié), frontend Next.js/React,
PostgreSQL, API REST documentée OpenAPI/Swagger, authentification OAuth2/OpenID Connect avec
MFA, cache Redis, stockage documentaire compatible S3, notifications SMS/WhatsApp/Email/Push,
conteneurisation Docker, CI/CD automatisé, monitoring (type Prometheus/Grafana), logs
centralisés.

### 5.2 Démarrage progressif du découpage en microservices
Ne pas exiger 30 microservices dès la Phase 1. Un socle de 10 à 14 services métier bien
délimités est un point de départ raisonnable (identité/accès, tenant/organisation,
membres, produits/plans, contrats, cotisations/facturation, prestataires, éligibilité,
préautorisation, réclamations, adjudication, paiements, notifications, reporting/audit) —
pharmacie, revue médicale, détection de fraude, gestion documentaire avancée et intégrations
peuvent suivre en phases ultérieures.

### 5.3 Environnements
Développement, Test, Staging, Production strictement séparés — aucun développement direct en
production.

### 5.4 Tests
Tests unitaires, tests d'intégration, tests d'API, tests de sécurité par microservice. Le
parcours critique (adhérent → éligibilité → prestation → adjudication → facture → paiement)
doit être couvert par un scénario de test automatisé, exécuté à chaque livraison.

### 5.5 Performance et disponibilité
Capacité de démarrer à quelques centaines d'adhérents et de monter architecturalement à
plusieurs dizaines/centaines de milliers sans réécriture complète. Objectif de disponibilité
initial 99,5 %, cible à terme 99,9 %, avec sauvegardes, réplication, monitoring, alertes, et
plan de reprise après sinistre documenté.

---

## 6. Sécurité et conformité réglementaire

- Chiffrement en transit (HTTPS/TLS) et au repos.
- Contrôle d'accès strict, MFA obligatoire sur les comptes à privilège.
- Journalisation immuable des actions sensibles (voir §2.20).
- Isolation stricte entre tenants (voir §2.1).
- Politique de rétention et d'archivage des données définie contractuellement.
- Anonymisation des données pour les statistiques agrégées.
- **Conformité aux exigences réglementaires ivoiriennes** applicables aux données
  personnelles (APDCI), à la santé, à l'assurance/mutualité (réglementation CIMA), et aux
  moyens de paiement — le fournisseur doit démontrer sa connaissance de ce cadre, pas
  seulement des principes génériques de cybersécurité.

---

## 7. Portabilité des données et réversibilité (clause obligatoire)

Le porteur du projet ne doit jamais être prisonnier de son fournisseur. Le contrat doit
garantir :
- l'export complet, à tout moment et sans frais prohibitifs, des adhérents, contrats,
  prestations, réclamations, factures, paiements, prestataires, historique et documents ;
- ces exports dans des formats ouverts (CSV, Excel, JSON, PDF) et, si possible, via une API
  d'export documentée ;
- la restitution du code source développé spécifiquement pour le projet en fin de contrat ou
  en cas de résiliation (clause d'entiercement/escrow du code source à prévoir explicitement).

---

## 8. Roadmap et budget

| Phase | Contenu | Durée indicative | Point de vigilance |
|---|---|---|---|
| Phase 1 — MVP | Authentification, multi-tenant, utilisateurs/rôles, sociétés clientes, adhérents, ayants droit, plans, contrats, cotisations, prestataires, carte QR, éligibilité, prise en charge, dashboard de base | 3-4 mois | **Vérifier l'adéquation avec le budget disponible (§0.2) avant signature** |
| Phase 2 | Réclamations, adjudication, médecin-conseil, pharmacie, pharmacien-conseil, facturation, paiements, notifications | 2-3 mois | Financée idéalement par les revenus de la Phase 1 en production |
| Phase 3 | Application mobile, portail clinique, portail pharmacie, WhatsApp, Mobile Money, reporting avancé, import massif | 2-3 mois | — |
| Phase 4 | IA (fraude, analyse), analytics avancé, interopérabilité FHIR/HL7 si nécessaire, intégrations bancaires étendues | Après lancement | Ne pas anticiper sans historique de données réel |

---

## 9. Critères d'évaluation des propositions fournisseurs

| Critère | Pondération indicative |
|---|---|
| Couverture fonctionnelle du périmètre §2, avec décomposition claire par phase | 25 % |
| Réponses précises et vérifiables au questionnaire (Annexe A) | 20 % |
| Références vérifiables sur des projets similaires (assurance, santé, ou SaaS multi-tenant réglementé) | 15 % |
| Réalisme du chiffrage au regard du budget et du délai annoncés (§0.2, §8) | 15 % |
| Clarté des clauses de réversibilité, propriété du code, et maintenance post-livraison | 15 % |
| Démonstration de connaissance du cadre réglementaire ivoirien/CIMA | 10 % |

---

## 10. Clauses contractuelles à exiger (souvent omises, à ne pas négliger)

- Propriété intellectuelle du code développé spécifiquement pour le projet, clairement
  attribuée au porteur du projet.
- Clause d'entiercement (escrow) du code source, activable en cas de défaillance du
  fournisseur.
- Niveau de service (SLA) pour le support et la maintenance post-livraison, avec pénalités en
  cas de non-respect.
- Durée de garantie post-livraison sur les anomalies (bugs) découvertes après recette.
- Modalités précises de recette (jeux de tests, critères d'acceptation par module).
- Modalités de sortie de contrat et transfert de connaissance vers une autre équipe si
  nécessaire (documentation technique à livrer, pas seulement le code).

---

## Annexe A — Questionnaire fournisseur (20 questions)

1. Peut-on utiliser la plateforme en Côte d'Ivoire, avec hébergement conforme aux exigences
   locales applicables ?
2. Peut-on utiliser le FCFA comme devise native, avec gestion multi-devises si nécessaire ?
3. Peut-on créer nos propres plans de santé sans développement spécifique ?
4. Peut-on créer plusieurs formules par société ?
5. Peut-on gérer conjoint/enfants et autres ayants droit selon des règles de contrat variables ?
6. Peut-on gérer les cotisations mensuelles, trimestrielles et annuelles ?
7. Peut-on gérer les impayés, les relances et les pénalités contractuelles ?
8. Peut-on définir des plafonds annuels par acte et par bénéficiaire ?
9. Peut-on définir des taux de couverture différenciés par catégorie d'acte et par formule ?
10. Peut-on gérer les délais de carence par garantie ?
11. Peut-on gérer les exclusions par contrat et par formule ?
12. Peut-on créer et administrer un réseau de cliniques avec tarifs négociés ?
13. Peut-on créer et administrer un réseau de pharmacies avec tarifs négociés ?
14. Peut-on effectuer une prise en charge en temps réel, avec vérification d'éligibilité
    instantanée ?
15. Peut-on effectuer du pay-direct (règlement direct au prestataire, sans avance de fonds par
    l'adhérent) ?
16. Existe-t-il une API REST documentée (OpenAPI/Swagger), et est-elle incluse dans le
    périmètre contractuel ?
17. Existe-t-il une application mobile native ou un portail mobile responsive ? Sous quelle
    licence et avec quelle maintenance ?
18. Peut-on intégrer les moyens de paiement ivoiriens (Orange Money, MTN MoMo, Moov Money,
    Wave) — lesquels sont réellement opérationnels à la livraison, lesquels sont en option
    payante ?
19. Peut-on exporter l'intégralité des données en cas de changement de fournisseur, sans
    frais prohibitifs et dans des formats ouverts (voir §7) ?
20. Quel est le chiffrage détaillé, phase par phase, avec un périmètre exact livré pour le
    budget de Phase 1 annoncé — et quelles fonctionnalités du présent cahier des charges
    seraient explicitement exclues de ce budget ?

---

## Annexe B — Note pour le porteur du projet (usage interne, à ne pas transmettre aux fournisseurs)

Vous disposez déjà, en interne, d'une spécification technique détaillée pour une variante de
ce système conçue pour un développement en solo avec des outils d'IA agentique (architecture
Next.js + Supabase + microservice Java isolé pour l'adjudication) — notamment sur les points
suivants, traités avec un luxe de détail que ce cahier des charges générique ne couvre pas :
la hiérarchie exacte de provisioning des comptes avec policies de sécurité au niveau base de
données, la séparation stricte entre médecin traitant/médecin conseil/médecin souscripteur
avec contrainte d'unicité sur le numéro d'ordre médical, et le système à quatre codes de
vérification (consultation, ordonnance, ticket de soins, facturation) avec leur cycle de vie
complet.

**Utilité pratique immédiate** : servez-vous de cette spécification interne comme grille de
lecture pour évaluer si un fournisseur comprend réellement la profondeur métier du sujet, ou
s'il reste au niveau générique de ce cahier des charges — posez-lui des questions précises
tirées de ces points lors des soutenances de proposition. Un bon fournisseur doit pouvoir
répondre avec autant de précision que ce qui a été détaillé en interne, pas seulement
reformuler les 51 points du cahier des charges reçu.
