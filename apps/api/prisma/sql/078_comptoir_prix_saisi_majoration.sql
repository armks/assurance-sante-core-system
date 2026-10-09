-- 078 — Comptoir de pharmacie : prix SAISI par le caissier + alerte de majoration (ADR-007, lot « comptoir »).
--
-- Le prix de référence est UNIQUE pour toute la Côte d'Ivoire (référentiel national des médicaments,
-- `prix_reference_xof`). Chaque pharmacie applique sa propre majoration, saisie au comptoir : il n'existe
-- plus de base de tarifs par pharmacie. Chaque ligne de dispensation garde le prix de référence du jour,
-- la majoration en pourcentage et un indicateur d'alerte (majoration au-delà du seuil de la plateforme).
-- Le prix du stock de la pharmacie (stock_medicaments_pharmacie.prix_pharmacie) n'est plus utilisé.
--
-- Paramètre plateforme `majoration_maximale_pharmacie_pourcent` (défaut 20) : seuil de l'alerte.
-- Idempotente.

ALTER TABLE public.lignes_dispensation
  ADD COLUMN IF NOT EXISTS prix_reference numeric(14, 2),
  ADD COLUMN IF NOT EXISTS majoration_pourcent numeric(8, 2),
  ADD COLUMN IF NOT EXISTS majoration_anormale boolean NOT NULL DEFAULT false;

INSERT INTO public.parametres_plateforme (cle, valeur, description)
VALUES (
  'majoration_maximale_pharmacie_pourcent',
  '20'::jsonb,
  'Seuil (en %) de majoration d''une pharmacie par rapport au prix national du médicament, au-delà duquel le comptoir signale une majoration anormale (alerte seule, vente permise).'
)
ON CONFLICT (cle) DO NOTHING;
