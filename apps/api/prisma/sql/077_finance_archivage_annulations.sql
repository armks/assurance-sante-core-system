-- 077 — Chantier suppression / archivage, lot 5 « finance » (ADR-007).
--
--   1. comptes_financiers.statut : ACTIF | ARCHIVE (archivage RÉVERSIBLE, distinct de `deleted_at`).
--      Un compte archivé ne reçoit ni ne sert plus aucun mouvement ; son historique reste lisible.
--      Le solde n'est JAMAIS modifiable directement (aucune route) : il ne bouge que par mouvement.
--   2. Annulations avec motif obligatoire, sans suppression :
--        cotisations.motif_annulation / annulee_le / annulee_par   (statut ANNULEE existant)
--        avenants.motif_annulation / annule_le / annule_par        (statut ANNULE existant)
--   3. imports_adherents.deleted_at : suppression LOGIQUE d'un brouillon de propositions d'import.
--
-- Idempotente : rejouable sans erreur.

ALTER TABLE public.comptes_financiers
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'ACTIF';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comptes_financiers_statut_check') THEN
    ALTER TABLE public.comptes_financiers
      ADD CONSTRAINT comptes_financiers_statut_check CHECK (statut IN ('ACTIF', 'ARCHIVE'));
  END IF;
END $$;

ALTER TABLE public.cotisations
  ADD COLUMN IF NOT EXISTS motif_annulation text,
  ADD COLUMN IF NOT EXISTS annulee_le timestamptz,
  ADD COLUMN IF NOT EXISTS annulee_par uuid;

ALTER TABLE public.avenants
  ADD COLUMN IF NOT EXISTS motif_annulation text,
  ADD COLUMN IF NOT EXISTS annule_le timestamptz,
  ADD COLUMN IF NOT EXISTS annule_par uuid;

ALTER TABLE public.imports_adherents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
