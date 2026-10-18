# Chargement de la NGAMBCI (décembre 2019) dans le catalogue national

Source : *Nomenclature générale des actes de médecine et de biologie de Côte d'Ivoire*, Ministère de la Santé et de l'Hygiène publique,
Comité technique CMU, décembre 2019 (569 pages). Le PDF est conservé dans le stockage privé (bucket `nomenclature`) et consultable depuis
les pages « Catalogue national » (bouton « Nomenclature officielle (PDF) »).

## Résultat

| | |
|---|---|
| Actes importés et homologués | **9 222** (8 516 avec cotation, 706 sans cotation) |
| Actes généraux (consultations, visites) | 17 |
| Actes infirmiers | 68 |
| Actes de médecine (19 chapitres) | 8 012 |
| Actes de biologie (21 chapitres) | 1 125 |
| Version de nomenclature | `NGAMBCI-2019-12` |

Les valeurs (codes, libellés, lettres-clés, coefficients) sont celles du texte officiel, recopiées sans correction. Aucune valeur en FCFA :
elles se négocient par établissement dans les conventions.

## Fichiers

| Fichier | Contenu |
|---|---|
| `ngambci-catalogue-actes.xlsx` | Fichier d'import (format `CatalogueImportService`), tel que chargé. |
| `rapport-anomalies.csv` | Ce que le texte officiel contient de douteux (voir ci-dessous). |
| `variantes-non-stockees.csv` | Actes à deux cotations (« avec anesthésie ») : seule la cotation principale est stockée. |
| `actes-non-tarifes-cotation-0.csv` | Actes cotés « 0 » dans la nomenclature : importés sans lettre-clé ni coefficient. |
| `../../../apps/api/scripts/ngambci/` | Scripts d'extraction du PDF (Python + pdfplumber) : `1-extraire-tableaux.py`, `2-analyser-actes.py`, `3-generer-fichiers.py`. |

## Règles appliquées

- **Cotation** : lettre-clé + coefficient de la colonne « Cotation ». Pour un acte à deux lignes (principal puis « anesthésie »), la
  première ligne est retenue. Pour « AMI ou SFI » (actes infirmiers), la lettre retenue est AMI.
- **Cotation 0** : le système exige un coefficient strictement positif ; ces actes sont importés sans cotation (à tarifer par convention).
- **Chapitre** (`categorie`) : numéro et intitulé du chapitre du sommaire (médecine), intitulé du chapitre (biologie).
- **Catégorie de garantie** (déduite du regroupement officiel, **à valider par l'assureur** car elle détermine la couverture) :
  consultations et visites → `CONSULTATION` ; actes infirmiers → `SOINS_INFIRMIERS` ; regroupements ADI, ADE → `IMAGERIE` ; ACO →
  `MATERNITE` ; lettres D / DC ou regroupements dentaires (AXI, DEN, END, ICO, IMP, INO, PAM, PAR, PDT, PFC, PFM, RPN, TDS, SDE) →
  `DENTAIRE` ; biologie → `ANALYSES` ; autres actes de médecine (ATM, ADC, ADA) → `ACTE_TECHNIQUE`. Modifiable acte par acte (écran
  catalogue national).
- **Lettres-clés** : 21 lettres ajoutées avec leurs libellés officiels (migration `110_lettres_cles_ngambci.sql`). Le code d'une lettre-clé
  passe de 1-4 à 1-6 lettres (CNPSY, VNPSY, VNINF, VFINF). Le système met les codes en majuscules (CInf → `CINF`).

## Anomalies du texte officiel (détail : `rapport-anomalies.csv`)

- 9 codes imprimés deux fois (METB334, METB335, MJTE006, MLTZ001, MZTZ014, RADY002, MZDY002, BHDA066, BHDA067) : la **première**
  occurrence est importée, la seconde est ignorée — pour METB334 et METB335 les deux occurrences sont des actes différents.
- `TPTYOO2` (deux lettres « O ») : conservé tel qu'imprimé (probablement « TPTY002 »).
- `MJTC 123` (espace) : importé sous `MJTC123`.
- `MZTA031`, `MZTA032` : lettre-clé imprimée « ADC » (regroupement répété par erreur) : importés sans cotation.
- `BHDA074` (VIH : TDR) : cotation absente : importé sans cotation.

## Reprise

`python 1-extraire-tableaux.py` → `dump.json`, puis `2-analyser-actes.py` → `actes.json`, puis `3-generer-fichiers.py` → xlsx et rapports
(chemins du PDF à adapter en tête de `1-extraire-tableaux.py`). Import : superadmin → *Catalogue national* → import Excel → rapport → valider
→ homologuer. La validation traite un acte par transaction : plusieurs dizaines de minutes pour 9 000 actes ; ne pas redémarrer l'API pendant
ce temps (le mode surveillance `nest start --watch` redémarre à chaque modification de fichier).
