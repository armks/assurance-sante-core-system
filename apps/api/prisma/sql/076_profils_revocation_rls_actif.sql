-- 076 — Chantier suppression / archivage, lot 4 « personnes » (ADR-007).
--
--   1. profils.statut : ACTIF | REVOQUE (+ revoque_le / revoque_par / revoque_motif).
--      Révoquer un compte ne le SUPPRIME jamais : le profil, l'historique et les liens restent ;
--      le compte Supabase Auth est bloqué (ban) et ses sessions supprimées. Réactivation
--      explicite. Distinct de `desactive_le` (075 : désactivation automatique à l'archivage
--      d'une structure) et de `deleted_at` (suppression logique).
--   2. Fonction RLS réutilisable `profil_appelant_actif()` : faux si le profil de l'appelant
--      (auth.uid()) est supprimé, RÉVOQUÉ, DÉSACTIVÉ ou rattaché à un établissement / une
--      pharmacie / une société archivé(e) ou supprimé(e).
--   3. `organisation_appelant_active()` l'exige désormais → toutes les policies bâties sur
--      `profil_a_role`, `peut_creer_role` et `peut_inviter_role` en héritent.
--   4. Policy RESTRICTIVE `profil_actif_exige` sur TOUTES les tables du schéma public qui ont la
--      RLS activée (rôle `authenticated`) : un jeton de compte révoqué est refusé IMMÉDIATEMENT par
--      PostgREST, sans attendre l'expiration du jeton. Les rôles à contournement RLS (service,
--      connexion de l'API) et `anon` ne sont pas concernés.
--   5. invitations : lien vers l'invitation qui en remplace une révoquée ou expirée
--      (`remplacee_par`) — l'ancienne reste dans l'historique, rien n'est supprimé.
--
-- Idempotente : rejouable sans erreur.

ALTER TABLE public.profils
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'ACTIF',
  ADD COLUMN IF NOT EXISTS revoque_le timestamptz,
  ADD COLUMN IF NOT EXISTS revoque_par uuid,
  ADD COLUMN IF NOT EXISTS revoque_motif text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profils_statut_check') THEN
    ALTER TABLE public.profils
      ADD CONSTRAINT profils_statut_check CHECK (statut IN ('ACTIF', 'REVOQUE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS profils_statut_idx ON public.profils (statut) WHERE statut <> 'ACTIF';

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS remplacee_par uuid;

CREATE OR REPLACE FUNCTION public.profil_appelant_actif()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT p.deleted_at IS NULL
       AND p.statut = 'ACTIF'
       AND p.desactive_le IS NULL
       AND (p.etablissement_id IS NULL OR EXISTS (
             SELECT 1 FROM etablissements_sante e
             WHERE e.id = p.etablissement_id AND e.deleted_at IS NULL AND e.statut <> 'RESILIE'))
       AND (p.pharmacie_id IS NULL OR EXISTS (
             SELECT 1 FROM pharmacies ph
             WHERE ph.id = p.pharmacie_id AND ph.deleted_at IS NULL AND ph.statut <> 'RESILIEE'))
       AND (p.societe_id IS NULL OR EXISTS (
             SELECT 1 FROM souscripteurs s
             WHERE s.id = p.societe_id AND s.deleted_at IS NULL AND s.statut <> 'ARCHIVE'))
    FROM profils p
    WHERE p.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.organisation_appelant_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.profil_appelant_actif() AND coalesce((
    SELECT p.organisation_id IS NULL
        OR EXISTS (
          SELECT 1 FROM organisations o
          WHERE o.id = p.organisation_id AND o.statut = 'ACTIVE' AND o.deleted_at IS NULL
        )
    FROM profils p
    WHERE p.id = auth.uid() AND p.deleted_at IS NULL
  ), false);
$$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS profil_actif_exige ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY profil_actif_exige ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.profil_appelant_actif())) '
      || 'WITH CHECK ((SELECT public.profil_appelant_actif()))',
      t.relname
    );
  END LOOP;
END $$;
