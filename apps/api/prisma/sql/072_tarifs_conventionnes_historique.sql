-- 072 — Historique des tarifs conventionnés : périodes SUCCESSIVES sans chevauchement
-- (ADR-006, amendement « tarif en vigueur à la date des soins »).
--
-- Avant : un seul tarif non supprimé par (établissement | pharmacie, acte) — index uniques
-- partiels — et l'application imposait de MODIFIER le tarif en place pour en changer :
-- l'ancien montant disparaissait, impossible de retrouver le tarif en vigueur à la date
-- des soins d'une réclamation tardive.
--
-- Désormais : plusieurs tarifs par couple, à condition que leurs périodes de validité
-- [date_debut, date_fin] (date_fin NULL = sans fin) NE SE CHEVAUCHENT PAS. Changer de
-- tarif = fixer la date de fin de l'ancien, puis créer le nouveau. Les données existantes
-- (au plus un tarif actif par couple) respectent déjà la contrainte.
--
-- Idempotente : rejouable sans erreur.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS public.tarifs_conventionnes_etablissement_acte_actif_idx;
DROP INDEX IF EXISTS public.tarifs_conventionnes_pharmacie_acte_actif_idx;

DO $$
BEGIN
  -- (date_fin >= date_debut déjà garanti par tarifs_conventionnes_periode_coherente)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarifs_conventionnes_etablissement_sans_chevauchement') THEN
    ALTER TABLE public.tarifs_conventionnes
      ADD CONSTRAINT tarifs_conventionnes_etablissement_sans_chevauchement
      EXCLUDE USING gist (
        etablissement_id WITH =,
        referentiel_acte_id WITH =,
        daterange(date_debut, date_fin, '[]') WITH &&
      ) WHERE (deleted_at IS NULL AND etablissement_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarifs_conventionnes_pharmacie_sans_chevauchement') THEN
    ALTER TABLE public.tarifs_conventionnes
      ADD CONSTRAINT tarifs_conventionnes_pharmacie_sans_chevauchement
      EXCLUDE USING gist (
        pharmacie_id WITH =,
        referentiel_acte_id WITH =,
        daterange(date_debut, date_fin, '[]') WITH &&
      ) WHERE (deleted_at IS NULL AND pharmacie_id IS NOT NULL);
  END IF;
END $$;

COMMIT;
