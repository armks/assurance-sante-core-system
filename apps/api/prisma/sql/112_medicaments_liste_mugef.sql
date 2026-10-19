-- 112 — Catalogue national des médicaments : structure de la liste officielle MUGEF-CI (édition septembre 2026).
--
--   type_medicament   G (générique) | S (spécialité) — colonne « TYPE » de la liste
--   code_produit      désormais de 6 à 7 chiffres (9 dans l'édition 2022) : aucune contrainte de longueur
--   categorie_remboursement   R | EP | EPF | TPC | libre — codes de la colonne « CATEG. » (signification : à confirmer auprès de la MUGEF-CI)
--   regime_remboursement      RCO | IVSPL — colonne « REGIME »
--
-- Idempotente.

ALTER TABLE public.referentiel_national_medicaments
  ADD COLUMN IF NOT EXISTS type_medicament text;

ALTER TABLE public.referentiel_national_medicaments
  DROP CONSTRAINT IF EXISTS referentiel_national_medicaments_type_medicament_check;
ALTER TABLE public.referentiel_national_medicaments
  ADD CONSTRAINT referentiel_national_medicaments_type_medicament_check
  CHECK (type_medicament IS NULL OR type_medicament IN ('G', 'S'));

CREATE INDEX IF NOT EXISTS referentiel_national_medicaments_dci_idx
  ON public.referentiel_national_medicaments (lower(denomination_commune));
