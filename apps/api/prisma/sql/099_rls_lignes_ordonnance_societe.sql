-- 099 — Isolation par société des lignes d'ordonnance (RLS).
--
--   Audit d'isolation : `lignes_ordonnance_ecriture` (ALL) autorisait tout compte pharmacie ou médecin à lire ET écrire les
--   lignes d'ordonnance de N'IMPORTE QUELLE société en accès direct (PostgREST), sans contrôle de société. Grâce à la colonne
--   `organisation_id` (098), la politique exige maintenant la même société que le compte appelant.
--
-- Idempotente : rejouable sans erreur.

DROP POLICY IF EXISTS lignes_ordonnance_ecriture ON public.lignes_ordonnance;
CREATE POLICY lignes_ordonnance_ecriture ON public.lignes_ordonnance
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profils p
     WHERE p.id = auth.uid() AND p.deleted_at IS NULL
       AND p.organisation_id = lignes_ordonnance.organisation_id
       AND (p.pharmacie_id IS NOT NULL OR p.role = 'CENTRE_MEDICAL_MEDECIN')))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profils p
     WHERE p.id = auth.uid() AND p.deleted_at IS NULL
       AND p.organisation_id = lignes_ordonnance.organisation_id
       AND (p.pharmacie_id IS NOT NULL OR p.role = 'CENTRE_MEDICAL_MEDECIN')));
