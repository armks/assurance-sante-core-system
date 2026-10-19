# Liste des médicaments remboursables par la MUGEF-CI — édition septembre 2026

Source : PDF officiel « Liste des médicaments remboursables », édition de septembre 2026 (08/09/2026), 185 pages.
Colonnes : CODE PRODUIT · NOM COMMERCIAL · GROUPE THÉRAPEUTIQUE · DCI · CATÉG. · TYPE · PRIX · RÉGIME.

## Résultat

| | |
|---|---|
| Lignes lues dans le PDF | 4 786 |
| Doublons écartés | 9 (`doublons-ecartes.csv`) |
| **Médicaments chargés** | **4 777** (1 165 DCI) |
| Catégories | R, TPC, EPF, EP, LIBRE (2 lignes « libre » du PDF) |
| Types | G (générique), S (spécialité) |
| Régimes | RCO, IVSPL |

Remplace l'édition de novembre 2022 (742 lignes, table vidée avant le chargement).

## Correspondance avec le catalogue national

| PDF | Colonne `referentiel_national_medicaments` |
|---|---|
| Code produit (6-7 chiffres) | `code_produit` (clé unique) |
| Nom commercial (forme, dosage, conditionnement inclus) | `nom_commercial` |
| Groupe thérapeutique | `classe_therapeutique` |
| DCI | `denomination_commune` |
| Catég. | `categorie_remboursement` |
| Type G / S | `type_medicament` (migration 112) |
| Prix | `prix_reference_xof` (sert aux alertes de majoration, pas de plafond) |
| Régime | `regime_remboursement` |

Forme, dosage et conditionnement ne sont pas séparés dans le PDF : ils restent dans le nom commercial (champs facultatifs dans le formulaire).

## Règles et anomalies

- **Doublon** = deux codes pour le même nom, DCI, groupe, catégorie, type, prix et régime : la première occurrence est gardée. Les produits de même nom mais de prix différent sont conservés (produits distincts).
- 9 lignes dont la DCI, trop longue, déborde sur la colonne CATÉG. dans le PDF : lues à la main (`corrections-manuelles.csv`, catégorie R, type G).
- Caractères corrigés : `−` → `-`, `’` → `'`, `¿G` → `µG`. Certaines DCI du PDF sont tronquées par l'éditeur du PDF (ex. « …PHENYLEPHR ») : conservées telles quelles.
- Un code produit à 6 chiffres (TELMICLAR, 897539) est conservé tel qu'imprimé.
- **À confirmer auprès de la MUGEF-CI** : la signification des catégories EPF, TPC et « libre », et des régimes RCO / IVSPL. Seule EP (entente préalable) était documentée. Les codes sont stockés tels quels.

## Reprise

`python apps/api/scripts/medicaments/extraire-liste-mugef.py <pdf> docs/import/medicaments-mugef-2026-09` (pdfplumber), copier `medicaments.json` dans `apps/api/prisma/data/mugef-medicaments-2026-09.json`, puis `node apps/api/scripts/charger-liste-mugef.js [--simuler]` (idempotent, clé = code produit).
