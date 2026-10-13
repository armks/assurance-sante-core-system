-- 089 — L'accueil du centre médical renseigne les actes effectués par le médecin (« sur information du médecin »).
--
--   • medecin_realisateur_id    : le médecin qui a effectué l'acte (lui-même s'il l'atteste, sinon désigné par l'accueil) ;
--   • realisation_declaree_par  : le compte d'accueil qui a déclaré la réalisation (NULL quand c'est le médecin qui l'atteste) ;
--   • origine_montant           : 'SAISI' (montant tapé) ou 'TARIF_CONVENTION' (montant repris du tarif de la convention, affiché dès l'ajout).
-- La déclaration reste tracée dans l'audit (REALISATION_ACTE_DECLAREE_ACCUEIL).
--
-- Idempotente.

ALTER TABLE public.actes_dossier ADD COLUMN IF NOT EXISTS medecin_realisateur_id uuid REFERENCES public.profils (id) ON DELETE RESTRICT;
ALTER TABLE public.actes_dossier ADD COLUMN IF NOT EXISTS realisation_declaree_par uuid REFERENCES public.profils (id) ON DELETE RESTRICT;
ALTER TABLE public.actes_dossier ADD COLUMN IF NOT EXISTS origine_montant text;
ALTER TABLE public.actes_dossier DROP CONSTRAINT IF EXISTS actes_dossier_origine_montant_check;
ALTER TABLE public.actes_dossier ADD CONSTRAINT actes_dossier_origine_montant_check
  CHECK (origine_montant IS NULL OR origine_montant IN ('SAISI', 'TARIF_CONVENTION'));
