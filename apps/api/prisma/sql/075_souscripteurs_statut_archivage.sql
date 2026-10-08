-- 075 — Chantier suppression / archivage, lot 3 (ADR-007) : statut d'archivage des
-- souscripteurs (sociétés clientes).
--
--   souscripteurs.statut : ACTIF | ARCHIVE
--
-- L'archivage est un STATUT MÉTIER réversible, distinct de `deleted_at` (suppression
-- logique, sans retour, seulement sans dépendance). Établissements et pharmacies ont déjà
-- leur statut d'archive (RESILIE / RESILIEE) ; seuls les souscripteurs en manquaient.
--
-- Unicité : `souscripteurs` ne porte AUCUN index unique hors la clé primaire (ni nom, ni
-- code) — rien à rendre partiel. Les index uniques de `etablissements_sante.code` et
-- `pharmacies.code` sont déjà partiels (`WHERE deleted_at IS NULL`, prisma/sql/074).
--
-- Désactivation des comptes à l'archivage :
--   profils.desactive_le / desactive_motif
-- Archiver un établissement, une pharmacie ou une société DÉSACTIVE les comptes qui y sont
-- rattachés (ils ne peuvent plus agir). Le DÉSARCHIVAGE NE LES RÉACTIVE PAS : chaque compte
-- est rétabli explicitement par le service informatique (POST /identity/comptes/:id/reactiver).
-- Distinct de `deleted_at` (suppression) : un compte désactivé garde son profil et son
-- historique et peut être rétabli.
--
-- Idempotente : rejouable sans erreur.

BEGIN;

ALTER TABLE public.souscripteurs
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'ACTIF';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'souscripteurs_statut_check') THEN
    ALTER TABLE public.souscripteurs
      ADD CONSTRAINT souscripteurs_statut_check CHECK (statut IN ('ACTIF', 'ARCHIVE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS souscripteurs_statut_idx ON public.souscripteurs (statut);

ALTER TABLE public.profils
  ADD COLUMN IF NOT EXISTS desactive_le timestamptz,
  ADD COLUMN IF NOT EXISTS desactive_motif text;

CREATE INDEX IF NOT EXISTS profils_desactive_le_idx ON public.profils (desactive_le) WHERE desactive_le IS NOT NULL;

COMMIT;
