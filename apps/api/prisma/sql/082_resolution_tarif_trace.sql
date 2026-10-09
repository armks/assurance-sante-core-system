-- 082 — Chantier barème, lot 3 « résolution du tarif dans le Java » (ADR-008, ADR-003).
--
--   1. lignes_facturation : INSTANTANÉ du tarif appliqué, figé à l'émission de la facture — statut du tarif,
--      règle d'origine (FORFAIT | VALEUR_PROPRE | VALEUR_LETTRE_CLE | AUCUNE_CONVENTION), lettre-clé, coefficient,
--      valeur appliquée, convention, politique de dépassement, prix affiché, tarif reconnu, écart. Valeurs
--      COPIÉES (aucune ne se recalcule) : une convention modifiée ensuite ne change pas une facture émise.
--      Trigger : ces colonnes ne se modifient plus une fois posées, sauf au ré-rattachement de la ligne à une
--      NOUVELLE émission (cycle de facturation abandonné puis refait).
--   2. svc_adjudication (principe du moindre privilège, ADR-003) : lecture des SEULES colonnes nécessaires à la
--      résolution (conventions, convention_actes, convention_valeurs, type de visite du dossier, cotation des
--      actes). Plus aucun accès à `tarifs_conventionnes` (le Java lit désormais les conventions) ni aux autres
--      colonnes de `referentiel_actes`. La lecture est filtrée par organisation DANS LES REQUÊTES (le rôle
--      contourne la RLS).
--
-- Idempotente : rejouable sans erreur.

-- ------------------------------------------------------------------ 1. trace sur la ligne de facturation
ALTER TABLE public.lignes_facturation
  ADD COLUMN IF NOT EXISTS tarif_statut          text,
  ADD COLUMN IF NOT EXISTS tarif_regle_origine   text,
  ADD COLUMN IF NOT EXISTS tarif_lettre_cle      text,
  ADD COLUMN IF NOT EXISTS tarif_coefficient     numeric(8, 2),
  ADD COLUMN IF NOT EXISTS tarif_valeur_appliquee numeric(14, 2),
  ADD COLUMN IF NOT EXISTS tarif_convention_id   uuid REFERENCES public.conventions (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tarif_politique_depassement text,
  ADD COLUMN IF NOT EXISTS tarif_prix_affiche    numeric(14, 2),
  ADD COLUMN IF NOT EXISTS tarif_reconnu         numeric(14, 2),
  ADD COLUMN IF NOT EXISTS tarif_ecart           numeric(14, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lignes_facturation_tarif_trace_valide') THEN
    ALTER TABLE public.lignes_facturation
      ADD CONSTRAINT lignes_facturation_tarif_trace_valide CHECK (
        tarif_statut IS NULL
        OR (tarif_statut IN ('TARIFABLE', 'NON_APPLICABLE')
            AND (tarif_regle_origine IS NULL
                 OR tarif_regle_origine IN ('FORFAIT', 'VALEUR_PROPRE', 'VALEUR_LETTRE_CLE', 'AUCUNE_CONVENTION')))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lignes_facturation_tarif_convention_idx
  ON public.lignes_facturation (tarif_convention_id) WHERE tarif_convention_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lignes_facturation_tarif_fige()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tarif_statut IS NOT NULL
     AND NEW.facture_dossier_id IS NOT DISTINCT FROM OLD.facture_dossier_id
     AND (NEW.tarif_statut, NEW.tarif_regle_origine, NEW.tarif_lettre_cle, NEW.tarif_coefficient,
          NEW.tarif_valeur_appliquee, NEW.tarif_convention_id, NEW.tarif_politique_depassement,
          NEW.tarif_prix_affiche, NEW.tarif_reconnu, NEW.tarif_ecart)
         IS DISTINCT FROM
         (OLD.tarif_statut, OLD.tarif_regle_origine, OLD.tarif_lettre_cle, OLD.tarif_coefficient,
          OLD.tarif_valeur_appliquee, OLD.tarif_convention_id, OLD.tarif_politique_depassement,
          OLD.tarif_prix_affiche, OLD.tarif_reconnu, OLD.tarif_ecart)
  THEN
    RAISE EXCEPTION 'Le tarif appliqué à une ligne de facturation est figé à l''émission de la facture'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lignes_facturation_tarif_fige ON public.lignes_facturation;
CREATE TRIGGER lignes_facturation_tarif_fige
  BEFORE UPDATE ON public.lignes_facturation
  FOR EACH ROW EXECUTE FUNCTION public.lignes_facturation_tarif_fige();

COMMENT ON COLUMN public.lignes_facturation.tarif_regle_origine IS
  'Règle ayant fixé le tarif reconnu (ADR-008, lot 3) : FORFAIT | VALEUR_PROPRE | VALEUR_LETTRE_CLE | AUCUNE_CONVENTION. Figé à l''émission.';

-- ------------------------------------------------------------------ 2. droits de svc_adjudication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_adjudication') THEN
    GRANT SELECT (id, organisation_id, etablissement_id, numero, version, statut, date_debut, date_fin,
                  politique_depassement, historique, deleted_at)
      ON public.conventions TO svc_adjudication;
    GRANT SELECT (id, convention_id, referentiel_acte_id, prix_forfaitaire, valeur_lettre_cle, date_debut, date_fin,
                  deleted_at)
      ON public.convention_actes TO svc_adjudication;
    GRANT SELECT (convention_id, lettre_cle_code, contexte, valeur, deleted_at)
      ON public.convention_valeurs TO svc_adjudication;
    -- contexte de l'acte : le type de visite du dossier place l'acte en ambulatoire ou en hospitalisation
    GRANT SELECT (type_visite) ON public.dossiers_soins TO svc_adjudication;
    -- cotation de l'acte (lettre-clé et coefficient) : on remplace l'ancien SELECT sur toute la table
    REVOKE SELECT ON public.referentiel_actes FROM svc_adjudication;
    GRANT SELECT (id, organisation_id, code, lettre_cle_code, coefficient, deleted_at)
      ON public.referentiel_actes TO svc_adjudication;
    -- le Java ne lit plus la projection : les conventions sont sa source
    REVOKE SELECT ON public.tarifs_conventionnes FROM svc_adjudication;
  END IF;
END $$;
