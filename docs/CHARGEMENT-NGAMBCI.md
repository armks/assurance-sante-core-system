# Chargement du catalogue national NGAMBCI — procédure

> **Règle absolue : aucune donnée n'est inventée.** Les codes, libellés, lettres-clés et coefficients viennent
> **exclusivement** du texte officiel (Catalogue national des actes médicaux, décret n° 2016-865) fourni par l'assureur. Le
> fichier de ce dépôt est un **modèle vide** : entêtes seulement.

## Fichiers

| Fichier | Rôle |
|---|---|
| `docs/import/ngambci-catalogue-actes-modele.xlsx` | Modèle **vide** : feuille `Actes` (entêtes) + feuille `Notice` (description des colonnes). |
| `apps/api/scripts/generer-modele-import-ngambci.cjs` | Régénère le modèle vide (`node scripts/generer-modele-import-ngambci.cjs`). |
| `apps/api/scripts/retirer-donnees-fictives.cjs` | Retire les données FICTIVES avant le chargement (simulation par défaut). |

## Colonnes du modèle (format attendu par l'import du superadmin)

| Colonne | Obligatoire | Contenu |
|---|---|---|
| `code` | oui | Code officiel de l'acte (unique dans le catalogue). |
| `libelle` | oui | Libellé officiel. |
| `categorie` | non | Chapitre de la nomenclature (texte libre). |
| `lettre_cle` | non* | Lettre-clé officielle ; doit exister et être **active** (écran « Lettres-clés »). |
| `coefficient` | non* | Coefficient officiel (> 0). *`lettre_cle` et `coefficient` vont toujours ensemble.* |
| `mode` | non | `ISOLE` (défaut) ou `GROUPE` (exige `groupe_code`). |
| `categorie_garantie` | non | Catégorie de garantie (`CONSULTATION`, `ANALYSES`, `IMAGERIE`, `HOSPITALISATION`…). |
| `groupe_code` | non | Code de groupe des actes cotés en groupe. |

Aucune valeur en FCFA : les valeurs des lettres-clés se négocient établissement par établissement, dans les **conventions**.

## Procédure

1. **Retirer les données fictives** (environnement concerné) :
   `cd apps/api && node scripts/retirer-donnees-fictives.cjs` (simulation) puis, après lecture,
   `node scripts/retirer-donnees-fictives.cjs --appliquer`. Le script ne touche qu'aux données `FICT…` / « (fictif) » non référencées par
   des données réelles ; il **signale** les conventions fictives validées (à archiver, jamais supprimer) et les lettres-clés
   « (fictif) » (à remplacer par le superadmin).
2. **Lettres-clés** : le superadmin remplace chaque libellé « (fictif) » par le libellé officiel (écran *Lettres-clés*), et crée
   ou désactive les lettres selon le texte officiel.
3. **Préparer le fichier** : copier le modèle, recopier les lignes du texte officiel, **sans corriger ni compléter** ; en cas de doute
   sur une valeur, laisser la cellule vide et la signaler à l'assureur.
4. **Importer** : superadmin → *Catalogue national* → import Excel. L'import produit un **rapport ligne par ligne** (lettre-clé
   inconnue, coefficient manquant, mode groupé sans groupe…). Corriger le fichier jusqu'à zéro erreur, puis **valider** l'import.
   Un fichier sans colonnes de cotation (ancien format) met à jour libellés et chapitres sans toucher à la cotation existante.
5. **Diffusion** : chaque organisation importe les actes qu'elle utilise (`Référentiel → Importer du catalogue national`) : la cotation
   est copiée dans son référentiel ; son code d'acte reste unique **dans l'organisation**.
6. **Conventions** : l'assurance informatique saisit, par établissement, les valeurs de lettres-clés et les exceptions d'acte ; le
   médecin conseil ou la direction valide (jamais la personne qui a saisi).
7. **Contrôle final** : tableau de bord de l'assurance informatique — indicateur « établissements sans convention validée » ; une
   facture d'essai sur un acte coté doit afficher la règle d'origine « Valeur de la lettre-clé × coefficient ».

## Après le chargement

- Conserver le fichier source et le rapport d'import (preuve de ce qui a été chargé).
- Aucun montant en FCFA n'est stocké dans le catalogue : en cas d'erreur de coefficient, corriger le catalogue ; les lignes déjà
  facturées gardent leur trace figée.
