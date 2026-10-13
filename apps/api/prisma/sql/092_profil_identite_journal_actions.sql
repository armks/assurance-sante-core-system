-- 092 — Profil utilisateur enrichi (pseudo, photo) + journal des actions (qui a créé / modifié / supprimé quoi).
-- Idempotente.

-- 1. Pseudo et photo du compte (photo : chemin dans le bucket privé « photos », URL signée à la demande).
ALTER TABLE public.profils ADD COLUMN IF NOT EXISTS pseudo text;
ALTER TABLE public.profils ADD COLUMN IF NOT EXISTS photo_url text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profils_pseudo_longueur') THEN
    ALTER TABLE public.profils ADD CONSTRAINT profils_pseudo_longueur CHECK (pseudo IS NULL OR char_length(pseudo) BETWEEN 2 AND 30);
  END IF;
END $$;

-- 2. Journal des actions : une ligne par écriture (création, modification, suppression) faite par un utilisateur authentifié,
--    avec son identité et son périmètre AU MOMENT de l'action (le rôle et le rattachement peuvent changer ensuite).
--    Pas de clés étrangères (le journal survit aux suppressions) ; seuls les NOMS des champs modifiés sont conservés,
--    jamais leurs valeurs (données de santé / personnelles).
CREATE TABLE IF NOT EXISTS public.journal_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid NOT NULL,
  role             text,
  organisation_id  uuid,
  etablissement_id uuid,
  pharmacie_id     uuid,
  societe_id       uuid,
  table_cible      text NOT NULL,
  enregistrement_id text,
  operation        text NOT NULL CHECK (operation IN ('CREATION', 'MODIFICATION', 'SUPPRESSION')),
  champs_modifies  text[],
  requete          text
);
CREATE INDEX IF NOT EXISTS journal_actions_user_idx ON public.journal_actions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journal_actions_cible_idx ON public.journal_actions (table_cible, enregistrement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journal_actions_org_idx ON public.journal_actions (organisation_id, created_at DESC);

-- Lecture / écriture exclusivement par l'API (rôle propriétaire) : aucune politique pour les rôles PostgREST.
ALTER TABLE public.journal_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_actions FROM anon, authenticated;

-- Le journal est en ajout seul : ni modification ni suppression, même par l'API.
CREATE OR REPLACE FUNCTION public.journal_actions_immuable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal des actions est en ajout seul (aucune modification ni suppression).';
END $$;
DROP TRIGGER IF EXISTS journal_actions_immuable ON public.journal_actions;
CREATE TRIGGER journal_actions_immuable BEFORE UPDATE OR DELETE ON public.journal_actions
  FOR EACH ROW EXECUTE FUNCTION public.journal_actions_immuable();
