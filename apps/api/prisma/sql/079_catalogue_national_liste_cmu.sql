-- 079 — Catalogue national des médicaments : colonnes de la liste des médicaments remboursables (CMU / MUGEF-CI).
--
--   code_produit              code produit de la liste (9 chiffres) — clé d'import idempotent
--   categorie_remboursement   R (remboursable) | EP (remboursable après entente préalable)
--   regime_remboursement      régime de la liste (CMU)
--   source_liste              édition de la liste d'origine
--
-- Un même DCI porte plusieurs produits commerciaux à prix différents : unicité sur le seul code produit.
-- Idempotente.

ALTER TABLE public.referentiel_national_medicaments
  ADD COLUMN IF NOT EXISTS code_produit text,
  ADD COLUMN IF NOT EXISTS categorie_remboursement text,
  ADD COLUMN IF NOT EXISTS regime_remboursement text,
  ADD COLUMN IF NOT EXISTS source_liste text;

CREATE UNIQUE INDEX IF NOT EXISTS referentiel_national_medicaments_code_produit_uniq
  ON public.referentiel_national_medicaments (code_produit)
  WHERE code_produit IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS referentiel_national_medicaments_nom_commercial_idx
  ON public.referentiel_national_medicaments (lower(nom_commercial));
