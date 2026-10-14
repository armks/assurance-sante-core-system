-- 095 — Référentiel des maladies CIM-10 (Classification internationale des maladies, 10e révision).
--
--   Table GLOBALE (commune à toutes les organisations), alimentée par le SUPERADMIN_PRINCIPAL (écran + import CSV).
--   Les médecins la consultent pour choisir le diagnostic d'une consultation : seul le CODE est conservé dans
--   `consultations_dossier.code_cim10` (texte, sans clé étrangère : un code retiré du référentiel n'altère pas l'historique).
--
-- Idempotente : rejouable sans erreur.

CREATE TABLE IF NOT EXISTS public.maladies_cim10 (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Z][0-9]{2}([.][0-9A-Z]{1,4})?$'),
  libelle     text NOT NULL CHECK (char_length(libelle) BETWEEN 2 AND 300),
  actif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS maladies_cim10_code_uniq ON public.maladies_cim10 (code);
CREATE INDEX IF NOT EXISTS maladies_cim10_libelle_idx ON public.maladies_cim10 (lower(libelle));

ALTER TABLE public.maladies_cim10 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maladies_cim10_lecture ON public.maladies_cim10;
CREATE POLICY maladies_cim10_lecture ON public.maladies_cim10
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS maladies_cim10_ecriture_superadmin ON public.maladies_cim10;
CREATE POLICY maladies_cim10_ecriture_superadmin ON public.maladies_cim10
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profils p
                  WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND p.role = 'SUPERADMIN_PRINCIPAL'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profils p
                       WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND p.role = 'SUPERADMIN_PRINCIPAL'));

DROP POLICY IF EXISTS profil_actif_exige ON public.maladies_cim10;
CREATE POLICY profil_actif_exige ON public.maladies_cim10 AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.profil_appelant_actif()))
  WITH CHECK ((SELECT public.profil_appelant_actif()));
