-- 087 — Entrants : une proposition d'adhérent peut porter un MOIS D'EFFET (1er du mois). À la validation, la date de validation de
-- l'adhérent est posée la veille du 1er de ce mois (coupure de facturation), comme pour l'import d'entrants. NULL = effet immédiat.
-- Idempotente.
ALTER TABLE public.propositions_membres ADD COLUMN IF NOT EXISTS mois_effet date;
ALTER TABLE public.propositions_membres DROP CONSTRAINT IF EXISTS propositions_membres_mois_effet_adherent;
ALTER TABLE public.propositions_membres ADD CONSTRAINT propositions_membres_mois_effet_adherent
  CHECK (mois_effet IS NULL OR (type = 'ADHERENT' AND extract(day FROM mois_effet) = 1));
