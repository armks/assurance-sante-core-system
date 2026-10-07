-- 071 — Délai de déclaration après la fin de la police, par produit (ADR-006, amendement).
--
-- L'éligibilité d'un soin s'apprécie désormais à la DATE DES SOINS : des soins reçus
-- pendant la couverture restent pris en charge après la fin de la police, s'ils sont
-- déclarés (réclamation, ou facture tiers payant) au plus `delai_declaration_jours`
-- jours après cette fin. Au-delà : rejet E014.
--
-- Valeur par défaut : 90 jours (3 mois), délai de forclusion usuel d'une demande de
-- remboursement ; s'applique aussi aux produits existants (qui refusaient jusqu'ici tout
-- soin déclaré après la fin de la police). 0 = aucun délai après la fin.
--
-- Idempotente : rejouable sans erreur.

BEGIN;

ALTER TABLE public.produits
  ADD COLUMN IF NOT EXISTS delai_declaration_jours integer NOT NULL DEFAULT 90;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produits_delai_declaration_jours_check') THEN
    ALTER TABLE public.produits
      ADD CONSTRAINT produits_delai_declaration_jours_check
      CHECK (delai_declaration_jours BETWEEN 0 AND 3650);
  END IF;
END $$;

COMMENT ON COLUMN public.produits.delai_declaration_jours IS
  'Nombre de jours après la fin de la police pendant lesquels des soins reçus pendant la couverture peuvent encore être déclarés (réclamation ou facture). Défaut 90 ; 0 = aucun délai.';

GRANT SELECT (delai_declaration_jours) ON public.produits TO svc_adjudication;

COMMIT;
