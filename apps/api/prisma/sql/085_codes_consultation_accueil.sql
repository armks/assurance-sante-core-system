-- 085 — Code de consultation émis depuis l'accueil de l'établissement
-- Le type d'acte (catégorie du superadmin) déclenche l'émission ; le canal choisi (e-mail ou SMS) vise un contact ENREGISTRÉ.
-- Idempotent.
ALTER TABLE public.codes_consultation
  ADD COLUMN IF NOT EXISTS categorie_acte text REFERENCES public.categories_acte (code) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS canal_choisi text,
  ADD COLUMN IF NOT EXISTS envoi_statut text,
  ADD COLUMN IF NOT EXISTS envoi_detail text,
  ADD COLUMN IF NOT EXISTS emis_par uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codes_consultation_canal_choisi_valide') THEN
    ALTER TABLE public.codes_consultation
      ADD CONSTRAINT codes_consultation_canal_choisi_valide
      CHECK (canal_choisi IS NULL OR canal_choisi IN ('EMAIL', 'SMS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codes_consultation_envoi_statut_valide') THEN
    ALTER TABLE public.codes_consultation
      ADD CONSTRAINT codes_consultation_envoi_statut_valide
      CHECK (envoi_statut IS NULL OR envoi_statut IN ('ENVOYE', 'NON_ENVOYE_DESACTIVE', 'ECHEC'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS codes_consultation_emission_accueil_idx
  ON public.codes_consultation (etablissement_id, adherent_id, beneficiaire_id, created_at)
  WHERE emis_par IS NOT NULL;
