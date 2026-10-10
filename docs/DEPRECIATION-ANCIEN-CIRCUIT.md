# Ancien circuit des tarifs d'établissement — inventaire et plan de retrait

> **Rien n'est supprimé par ce document.** Il liste ce qui reste de l'ancien circuit (tarifs d'établissement saisis un par un,
> lus directement par le Java) depuis l'arrivée des conventions (ADR-008, lots 2 à 5), et propose un retrait en étapes
> réversibles. Chaque étape suppose la précédente validée et un test de non-régression vert.

## 1. Ce qui reste (état au lot 6)

| Élément | Où | État | Qui s'en sert encore |
|---|---|---|---|
| Routes de tarifs d'**établissement** : `POST/GET/PATCH/DELETE etablissements/:id/tarifs`, `…/changer`, `…/fermer`, `…/rouvrir` | `provider.controller.ts` / `provider.service.ts` (`assertTarifsPharmacieSeulement`) | **409** « Les tarifs d'un établissement se gèrent dans sa convention » (lot 2) | Personne : l'écran de l'établissement n'a plus que la carte « Conventions ». Les routes existent pour répondre 409 aux anciens clients. |
| Table `tarifs_conventionnes` (lignes d'établissement) | base | **Projection** : les forfaits d'une convention VALIDEE y sont recopiés (même identifiant que la ligne `convention_actes`) et fermés avec elle | `actes_dossier.tarif_conventionne_id` (clé étrangère de trace, « un tarif ayant servi ne se supprime plus », prisma/sql/074) ; le registre des dépendances (entité `tarif`). Le Java **ne la lit plus** (droit retiré, migration 082). |
| Table `tarifs_conventionnes` (lignes de **pharmacie**) | base, écran `tarifs-conventionnes-panneau.tsx` (fiche pharmacie) | Actif | Écran de la fiche pharmacie, routes `pharmacies/:id/tarifs…` ; le comptoir n'utilise plus ces tarifs (prix national unique + alerte de majoration, prisma/sql/078). |
| Colonnes `etablissements_sante.date_convention`, `date_fin_convention` | base, Prisma, DTO `provider.dto.ts`, `provider.service.ts` | **Dépréciées** (commentaires SQL et Prisma, lot 2) ; encore acceptées en écriture | Aucun calcul. Le DTO de création / modification d'établissement les accepte toujours. |
| Colonnes `stock_medicaments_pharmacie.prix_pharmacie`, `lignes_dispensation.tarif_pharmacie_id` | base, Prisma, registre (`tarifPharmacieId`) | Plus utilisées par le comptoir (lot comptoir, prisma/sql/078) ; question de suppression restée **sans réponse** | Registre des dépendances (comptage), historique des dispensations. |
| Mode de transition « AUCUNE_CONVENTION » (prix affiché reconnu) | Java `ResolveurTarif` | **Voulu** et permanent tant qu'un établissement n'a pas de convention validée (indicateur du tableau de bord) | Tous les établissements sans convention. Ce n'est pas de la dette : c'est la règle de repli. |
| Convention « historique » (`conventions.historique = true`) | base | Conventions issues de la migration des anciens tarifs ; un acte non listé garde le prix affiché | Établissements migrés (aucun dans la base de développement : 0 tarif à migrer). |

## 2. Plan de retrait proposé (aucune étape n'est faite ici)

1. **Mesurer (avant tout).** Pendant au moins un cycle de facturation mensuel en production : compter les appels aux routes
   `etablissements/:id/tarifs…` (réponses 409 dans les journaux) et les écritures de `date_convention` /
   `date_fin_convention`. Objectif : zéro appel.
2. **Retirer les routes 409** (`etablissements/:id/tarifs…`) et `assertTarifsPharmacieSeulement` pour la cible
   « établissement » ; garder les routes `pharmacies/:id/tarifs…`. Test : le 409 devient un 404, aucun écran ne les appelle
   (recherche dans `apps/web`).
3. **Retirer `date_convention` / `date_fin_convention` des DTO** d'établissement (lecture seule d'abord : la colonne reste
   en base, l'API cesse de l'écrire), puis les retirer des formulaires d'établissement.
4. **Figer la projection.** Décider si `tarifs_conventionnes` (établissement) reste une projection pour la trace
   (`actes_dossier.tarif_conventionne_id`) ou si la trace pointe désormais vers `convention_actes`. Recommandation : migrer la
   trace vers `convention_actes` (même identifiant, donc **sans réécriture des données**), puis arrêter la projection à la
   validation. À faire en deux migrations : (a) nouvelle clé étrangère vers `convention_actes`, (b) retrait de la projection.
5. **Supprimer les colonnes dépréciées** (`date_convention`, `date_fin_convention`) par une migration dédiée, **après**
   sauvegarde, et seulement quand l'étape 3 est en production depuis un cycle complet.
6. **Pharmacie** : trancher la question restée ouverte (suppression de `prix_pharmacie` et `tarif_pharmacie_id`) avec
   l'ancien historique des dispensations ; si on les supprime, archiver d'abord les valeurs dans une table d'historique.

## 3. Garde-fous pendant le retrait

- Chaque étape : migration idempotente numérotée, test d'état des migrations (`migrations-etat.int-spec.ts`) mis à jour, ADR-003
  (droits du rôle `svc_adjudication`) rechecké.
- Aucun retrait sans **test de contre-épreuve** : la suite doit échouer si l'ancien comportement revient.
- Les conventions historiques et la trace des actes déjà calculés **ne se modifient jamais** (montants déjà facturés inchangés).
