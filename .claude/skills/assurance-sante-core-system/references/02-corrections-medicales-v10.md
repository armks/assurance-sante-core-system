---
name: saas-assurance-sante-afrique
version: 10.0
description: >
  Extension v10 — corrige un point de vigilance signalé sur la séparation entre les
  différents types de médecins du système. Ferme deux trous réels : (1) le médecin traitant
  était référencé en texte libre, sans lien avec son compte réel ; (2) rien n'empêchait
  structurellement qu'une même personne cumule un rôle de médecin traitant externe et de
  médecin interne à l'assureur sur le même dossier.
---

# Extension v10 — Séparation structurelle des trois types de médecins

## 0. Les trois types de médecins du système — clarification définitive

| Type | Rôle | Rattachement | Fonction |
|---|---|---|---|
| **Médecin traitant** | `CENTRE_MEDICAL_MEDECIN` | Établissement sanitaire partenaire (externe à l'assureur) | Reçoit le patient, propose les actes et prescriptions |
| **Médecin conseil** | `ASSUREUR_MEDECIN_CONSEIL` | Compagnie d'assurance (interne) | Valide/liquide les actes proposés, contre-vérifie, peut annuler (v8 §6) |
| **Médecin souscripteur** | `ASSUREUR_MEDECIN_SOUSCRIPTEUR` | Compagnie d'assurance (interne) | Évalue le questionnaire médical à la souscription individuelle (v9 §1.4) |

Ces trois rôles ne doivent **jamais** pouvoir agir l'un pour l'autre, ni être détenus par la
même personne sur un même dossier. C'est un principe de séparation des tâches, pas une simple
question d'étiquette de rôle.

---

## 1. Correction 1 — Le médecin traitant devient un compte réel, pas du texte libre

### 1.1 Problème

```sql
-- Modèle v1 §15.2 (ConsultationDossier) — problématique :
medecin_nom     text  -- champ texte libre, aucune vérification, aucun compte réel derrière
```

Un champ texte libre signifie qu'un établissement peut inscrire n'importe quel nom de
médecin — y compris un médecin fictif, ou un vrai médecin qui n'était pas présent ce jour-là.
Incompatible avec l'objectif anti-fraude posé en v8.

### 1.2 Correction

```sql
alter table consultations_dossier add column medecin_id uuid references profils(id);
alter table consultations_dossier add column medecin_nom_legacy text; -- conservé pour l'historique, non réutilisé

alter table actes_dossier add column medecin_prescripteur_id uuid references profils(id);
```

**Contrainte d'intégrité** : `medecin_id` doit obligatoirement référencer un `profils` de
rôle `CENTRE_MEDICAL_MEDECIN`, rattaché au **même** `etablissement_id` que la
`ConsultationDossier` — vérifié par une policy RLS d'insertion, pas seulement par un contrôle
applicatif :

```sql
create policy medecin_traitant_valide on consultations_dossier
  for insert
  with check (
    exists (
      select 1 from profils p
      where p.id = medecin_id
        and p.role = 'CENTRE_MEDICAL_MEDECIN'
        and p.etablissement_id = consultations_dossier.etablissement_id
    )
  );
```

**Conséquence directe pour le système de codes (v8)** : le `code_consultation` validé par le
patient (v8 §2) est désormais lié à un `medecin_id` réel et identifiable — en cas de
contestation ou d'audit, on sait exactement quel compte médecin a traité le patient, pas
seulement quel nom a été saisi.

---

## 2. Correction 2 — Empêcher le cumul médecin traitant / médecin conseil sur un même dossier

### 2.1 Le vrai risque

Rien n'empêchait, avant v10, qu'une personne ayant un compte `CENTRE_MEDICAL_MEDECIN` dans un
établissement partenaire obtienne **aussi** un compte `ASSUREUR_MEDECIN_CONSEIL` chez
l'assureur — et se retrouve à valider/liquider les actes qu'elle a elle-même prescrits dans
son autre casquette. C'est exactement le conflit d'intérêt que la séparation de rôle était
censée fermer, mais la séparation de **rôle** ne suffit pas si elle ne s'accompagne pas d'une
séparation d'**identité physique vérifiée**.

### 2.2 Correction — identifiant médical national unique, partagé entre les comptes

```sql
alter table profils add column numero_ordre_medecin text;  -- numéro national unique du médecin (Ordre des Médecins CI)

-- Contrainte : un même numéro d'ordre ne peut détenir qu'UN SEUL type de rôle médical actif à la fois
create unique index un_seul_role_medical_actif
  on profils (numero_ordre_medecin)
  where role in ('CENTRE_MEDICAL_MEDECIN','ASSUREUR_MEDECIN_CONSEIL','ASSUREUR_MEDECIN_SOUSCRIPTEUR')
    and deleted_at is null;
```

**Effet** : à la saisie du `numero_ordre_medecin` lors de la création de compte (workflow
d'invitation, v5 §3), le système refuse de créer un second compte médical actif avec le même
numéro d'ordre, quel que soit le rôle demandé. Un médecin ne peut être **que** médecin
traitant, **ou** médecin conseil, **ou** médecin souscripteur — jamais deux à la fois dans le
système.

### 2.3 Garde-fou complémentaire au niveau de la validation (défense en profondeur)

Même avec la contrainte d'unicité ci-dessus (qui empêche le cumul de comptes), une seconde
vérification protège contre le cas où deux comptes distincts appartiendraient, par erreur ou
fraude documentaire, à la même personne réelle non détectée par le numéro d'ordre :

```sql
create or replace function verifier_absence_conflit_medical(p_acte_id uuid, p_medecin_conseil_id uuid)
returns boolean language plpgsql as $$
declare
  v_medecin_traitant_numero_ordre text;
  v_medecin_conseil_numero_ordre text;
begin
  select p.numero_ordre_medecin into v_medecin_traitant_numero_ordre
  from actes_dossier a join consultations_dossier c on c.id = a.consultation_id
  join profils p on p.id = c.medecin_id
  where a.id = p_acte_id;

  select numero_ordre_medecin into v_medecin_conseil_numero_ordre
  from profils where id = p_medecin_conseil_id;

  if v_medecin_traitant_numero_ordre is not null
     and v_medecin_traitant_numero_ordre = v_medecin_conseil_numero_ordre then
    return false;   -- conflit détecté : le médecin conseil ne peut pas valider son propre acte
  end if;
  return true;
end;
$$;
```

Cette fonction doit être appelée **avant** toute exécution de
`MedecinConseilService.repondre_contre_verification` (v3 §14.5) ou de `annuler_acte` (v8
§6.2) — si elle retourne `false`, la validation est automatiquement réassignée à un autre
`ASSUREUR_MEDECIN_CONSEIL` de l'organisation, avec notification du motif de réassignation
(traçable dans `audit_log` via `log_audit()`, v9 §1.6).

---

## 3. Vérification que les deux médecins internes (conseil / souscripteur) restent bien séparés

Ce point avait déjà été corrigé en v9 §1.4 : `ASSUREUR_MEDECIN_SOUSCRIPTEUR` n'a accès qu'à
`questionnaires_medicaux`, et `ASSUREUR_MEDECIN_CONSEIL` n'a accès qu'à
`reclamations`/`actes_dossier`. La v10 ne change rien ici — elle confirme simplement que
cette séparation, une fois combinée à la contrainte d'unicité du §2.2, empêche aussi qu'une
même personne cumule médecin souscripteur **et** médecin conseil, ce qui aurait pu créer un
biais différent (sous-évaluer un risque à la souscription pour ensuite valider largement les
sinistres du même adhérent).

---

## 4. Audit final

| Question | Réponse après v10 |
|---|---|
| Le médecin traitant est-il un compte réel et vérifiable, ou du texte libre ? | Compte réel (`medecin_id`), rattaché à son établissement, vérifié par RLS |
| Une même personne peut-elle cumuler médecin traitant et médecin conseil ? | Non — contrainte d'unicité sur `numero_ordre_medecin` (§2.2) |
| Un médecin conseil peut-il valider un acte qu'il a lui-même prescrit sous une autre casquette ? | Non — garde-fou applicatif supplémentaire avant toute validation (§2.3) |
| Le médecin souscripteur et le médecin conseil restent-ils cloisonnés ? | Oui, confirmé (§3), et désormais renforcé par la même contrainte d'unicité |

**Limite honnête** : la contrainte repose sur la fiabilité du `numero_ordre_medecin` déclaré
à la création de compte — si ce numéro n'est jamais vérifié auprès de l'Ordre des Médecins de
Côte d'Ivoire (aucune API publique connue à ce jour pour une vérification automatique), la
protection reste déclarative. Il faut prévoir une **vérification manuelle** de ce numéro par
`ASSUREUR_INFORMATIQUE` avant activation de tout compte médical (déjà cohérent avec le
principe de validation centrale posé en v6/v7), tant qu'une vérification automatisée n'est
pas disponible.
