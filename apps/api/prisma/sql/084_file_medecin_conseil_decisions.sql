-- 084 — Chantier barème, lot 5 « file du médecin conseil et décisions » (ADR-008).
--
--   1. tarifs_proposes : catégorie de l'acte, alertes (montant renforcé / récurrence / plafond), suivi des rappels et de
--      l'escalade, option « ajouter à la convention », information de l'établissement.
--   2. factures_dossier : facture COMPLÉMENTAIRE de la part patient d'un acte décidé (lien unique vers la proposition).
--   3. Paramètres de plateforme : seuil d'alerte (écart à la médiane), récurrence, rappel et escalade.
--   4. svc_adjudication : inchangé (il ne lit pas ces colonnes).
--
-- Idempotente : rejouable sans erreur. NE redéfinit aucune fonction partagée (voir docs/DEPLOIEMENT.md).

ALTER TABLE public.tarifs_proposes
  ADD COLUMN IF NOT EXISTS categorie_acte text,
  ADD COLUMN IF NOT EXISTS alerte_renforcee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerte_recurrence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerte_details jsonb,
  ADD COLUMN IF NOT EXISTS alerte_plafond boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerte_plafond_message text,
  ADD COLUMN IF NOT EXISTS rappel_envoye_le timestamptz,
  ADD COLUMN IF NOT EXISTS escalade_envoyee_le timestamptz,
  ADD COLUMN IF NOT EXISTS etablissement_prevenu_le timestamptz,
  ADD COLUMN IF NOT EXISTS ajout_convention_id uuid REFERENCES public.conventions (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ajout_convention_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarifs_proposes_ajout_convention_type_valide') THEN
    ALTER TABLE public.tarifs_proposes
      ADD CONSTRAINT tarifs_proposes_ajout_convention_type_valide
      CHECK (ajout_convention_type IS NULL OR ajout_convention_type IN ('FORFAIT', 'VALEUR_LETTRE_CLE'));
  END IF;
  -- l'ajout à la convention n'a de sens qu'après une validation ou un ajustement
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarifs_proposes_ajout_convention_apres_decision') THEN
    ALTER TABLE public.tarifs_proposes
      ADD CONSTRAINT tarifs_proposes_ajout_convention_apres_decision
      CHECK (ajout_convention_id IS NULL OR statut IN ('VALIDE', 'AJUSTE'));
  END IF;
END $$;

-- file triée : alerte renforcée d'abord, puis ancienneté
CREATE INDEX IF NOT EXISTS tarifs_proposes_file_idx
  ON public.tarifs_proposes (organisation_id, statut, alerte_renforcee DESC, date_proposition)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------ facture complémentaire
ALTER TABLE public.factures_dossier
  ADD COLUMN IF NOT EXISTS tarif_propose_id uuid REFERENCES public.tarifs_proposes (id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS factures_dossier_une_complementaire_par_proposition
  ON public.factures_dossier (tarif_propose_id) WHERE tarif_propose_id IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------------ paramètres de plateforme
INSERT INTO public.parametres_plateforme (cle, valeur, description) VALUES
  ('tarif_propose_alerte_ecart_mediane_pourcent', '50'::jsonb,
   'Alerte renforcée sur un tarif proposé dont le montant (par unité) dépasse de ce pourcentage la médiane des tarifs reconnus de la même catégorie de garantie sur 12 mois (alerte systématique sans historique).'),
  ('tarif_propose_recurrence_nombre', '5'::jsonb,
   'Nombre de propositions de tarif d''un même établissement, sur la période ci-dessous, à partir duquel une alerte de récurrence est levée.'),
  ('tarif_propose_recurrence_jours', '30'::jsonb,
   'Période (en jours) de l''alerte de récurrence des propositions de tarif d''un établissement.'),
  ('tarif_propose_rappel_jours', '2'::jsonb,
   'Délai (en jours) après lequel une proposition de tarif non décidée fait l''objet d''un rappel au médecin conseil.'),
  ('tarif_propose_escalade_jours', '5'::jsonb,
   'Délai (en jours) après lequel une proposition de tarif non décidée est escaladée à la direction.')
ON CONFLICT (cle) DO NOTHING;
