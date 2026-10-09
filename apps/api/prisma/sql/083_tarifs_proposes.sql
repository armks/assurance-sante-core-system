-- 083 — Chantier barème, lot 4 « tarif proposé » (ADR-008).
--
--   1. tarifs_proposes : pour un acte NON TARIFABLE (aucun forfait ni valeur de lettre-clé dans la convention en
--      vigueur), l'établissement propose un montant TOTAL avec une justification obligatoire. Statuts PROPOSE |
--      VALIDE | AJUSTE | REFUSE — les décisions (file du médecin conseil) arrivent au lot 5 ; la table et les statuts
--      sont prévus ici. Le proposant ne décide jamais sur sa propre proposition (CHECK en base).
--   2. lignes_facturation : quantité et tarif unitaire dans l'instantané, lien vers le tarif proposé, drapeau
--      `tarif_provisoire` (calcul provisoire sur un tarif proposé non décidé : la ligne est exclue du paiement
--      via reportee_mois_suivant, mais ENTAME les plafonds personne et famille).
--   3. svc_adjudication : lecture des seules colonnes nécessaires (tarif proposé, quantité de l'acte, drapeau).
--
-- Idempotente : rejouable sans erreur.

-- ------------------------------------------------------------------ 1. tarifs_proposes
CREATE TABLE IF NOT EXISTS public.tarifs_proposes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  etablissement_id     uuid NOT NULL REFERENCES public.etablissements_sante (id) ON DELETE RESTRICT,
  acte_dossier_id      uuid NOT NULL REFERENCES public.actes_dossier (id) ON DELETE RESTRICT,
  ligne_facturation_id uuid REFERENCES public.lignes_facturation (id) ON DELETE RESTRICT,
  -- montant TOTAL de l'acte (quantité comprise) proposé par l'établissement
  montant_propose      numeric(14, 2) NOT NULL CHECK (montant_propose > 0),
  justification        text NOT NULL CHECK (length(btrim(justification)) >= 10),
  statut               text NOT NULL DEFAULT 'PROPOSE' CHECK (statut IN ('PROPOSE', 'VALIDE', 'AJUSTE', 'REFUSE')),
  propose_par          uuid NOT NULL REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_proposition     timestamptz NOT NULL DEFAULT now(),
  decide_par           uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_decision        timestamptz,
  -- montant retenu par la décision (AJUSTE) ; VALIDE retient le montant proposé
  montant_decide       numeric(14, 2) CHECK (montant_decide IS NULL OR montant_decide > 0),
  motif_decision       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT tarifs_proposes_decision_tracee CHECK (
    (statut = 'PROPOSE' AND decide_par IS NULL AND date_decision IS NULL)
    OR (statut <> 'PROPOSE' AND decide_par IS NOT NULL AND date_decision IS NOT NULL)
  ),
  -- le proposant ne décide JAMAIS sur sa propre proposition
  CONSTRAINT tarifs_proposes_pas_d_auto_decision CHECK (decide_par IS NULL OR decide_par <> propose_par),
  CONSTRAINT tarifs_proposes_ajuste_chiffre CHECK (
    statut <> 'AJUSTE' OR (montant_decide IS NOT NULL AND length(btrim(coalesce(motif_decision, ''))) >= 5)
  ),
  CONSTRAINT tarifs_proposes_refus_motive CHECK (
    statut <> 'REFUSE' OR length(btrim(coalesce(motif_decision, ''))) >= 5
  )
);

-- une seule proposition « vivante » (non refusée) par acte ; un refus permet d'en proposer une autre
CREATE UNIQUE INDEX IF NOT EXISTS tarifs_proposes_un_vivant_par_acte
  ON public.tarifs_proposes (acte_dossier_id) WHERE deleted_at IS NULL AND statut <> 'REFUSE';
CREATE INDEX IF NOT EXISTS tarifs_proposes_acte_idx ON public.tarifs_proposes (acte_dossier_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tarifs_proposes_org_statut_idx ON public.tarifs_proposes (organisation_id, statut) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tarifs_proposes_etab_idx ON public.tarifs_proposes (etablissement_id) WHERE deleted_at IS NULL;

-- une proposition décidée ne change plus (montant, justification, auteur) : seule la décision s'y ajoute
CREATE OR REPLACE FUNCTION public.tarifs_proposes_fige()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.statut <> 'PROPOSE'
     AND (NEW.montant_propose, NEW.justification, NEW.propose_par, NEW.acte_dossier_id)
         IS DISTINCT FROM (OLD.montant_propose, OLD.justification, OLD.propose_par, OLD.acte_dossier_id)
  THEN
    RAISE EXCEPTION 'Une proposition de tarif déjà décidée ne se modifie plus' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tarifs_proposes_fige ON public.tarifs_proposes;
CREATE TRIGGER tarifs_proposes_fige BEFORE UPDATE ON public.tarifs_proposes
  FOR EACH ROW EXECUTE FUNCTION public.tarifs_proposes_fige();

ALTER TABLE public.tarifs_proposes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarifs_proposes_lecture ON public.tarifs_proposes;
CREATE POLICY tarifs_proposes_lecture ON public.tarifs_proposes FOR SELECT TO authenticated
  USING (public.profil_a_role(organisation_id,
    ARRAY['CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF', 'ASSUREUR_MEDECIN_CONSEIL',
          'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']));
DROP POLICY IF EXISTS profil_actif_exige ON public.tarifs_proposes;
CREATE POLICY profil_actif_exige ON public.tarifs_proposes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.profil_appelant_actif())) WITH CHECK ((SELECT public.profil_appelant_actif()));

-- ------------------------------------------------------------------ 2. ligne de facturation
ALTER TABLE public.lignes_facturation
  ADD COLUMN IF NOT EXISTS tarif_unitaire   numeric(14, 2),
  ADD COLUMN IF NOT EXISTS tarif_quantite   integer,
  ADD COLUMN IF NOT EXISTS tarif_provisoire boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tarif_propose_id uuid REFERENCES public.tarifs_proposes (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS lignes_facturation_tarif_propose_idx
  ON public.lignes_facturation (tarif_propose_id) WHERE tarif_propose_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarifs_proposes_ligne_fkey') THEN
    ALTER TABLE public.tarifs_proposes
      ADD CONSTRAINT tarifs_proposes_ligne_fkey FOREIGN KEY (ligne_facturation_id)
      REFERENCES public.lignes_facturation (id) ON DELETE RESTRICT;
  END IF;
END $$;

-- la règle d'origine TARIF_PROPOSE rejoint les quatre autres
ALTER TABLE public.lignes_facturation DROP CONSTRAINT IF EXISTS lignes_facturation_tarif_trace_valide;
ALTER TABLE public.lignes_facturation
  ADD CONSTRAINT lignes_facturation_tarif_trace_valide CHECK (
    tarif_statut IS NULL
    OR (tarif_statut IN ('TARIFABLE', 'NON_APPLICABLE')
        AND (tarif_regle_origine IS NULL
             OR tarif_regle_origine IN ('FORFAIT', 'VALEUR_PROPRE', 'VALEUR_LETTRE_CLE', 'AUCUNE_CONVENTION', 'TARIF_PROPOSE')))
  );

-- l'instantané reste figé, SAUF la trace PROVISOIRE d'un tarif proposé non décidé : la décision la remplace une fois
CREATE OR REPLACE FUNCTION public.lignes_facturation_tarif_fige()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tarif_statut IS NOT NULL
     AND OLD.tarif_provisoire = false
     AND NEW.facture_dossier_id IS NOT DISTINCT FROM OLD.facture_dossier_id
     AND (NEW.tarif_statut, NEW.tarif_regle_origine, NEW.tarif_lettre_cle, NEW.tarif_coefficient,
          NEW.tarif_valeur_appliquee, NEW.tarif_convention_id, NEW.tarif_politique_depassement,
          NEW.tarif_prix_affiche, NEW.tarif_reconnu, NEW.tarif_ecart, NEW.tarif_unitaire, NEW.tarif_quantite,
          NEW.tarif_propose_id)
         IS DISTINCT FROM
         (OLD.tarif_statut, OLD.tarif_regle_origine, OLD.tarif_lettre_cle, OLD.tarif_coefficient,
          OLD.tarif_valeur_appliquee, OLD.tarif_convention_id, OLD.tarif_politique_depassement,
          OLD.tarif_prix_affiche, OLD.tarif_reconnu, OLD.tarif_ecart, OLD.tarif_unitaire, OLD.tarif_quantite,
          OLD.tarif_propose_id)
  THEN
    RAISE EXCEPTION 'Le tarif appliqué à une ligne de facturation est figé à l''émission de la facture'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------ 3. droits de svc_adjudication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_adjudication') THEN
    GRANT SELECT (id, organisation_id, acte_dossier_id, statut, montant_propose, montant_decide, date_proposition,
                  deleted_at)
      ON public.tarifs_proposes TO svc_adjudication;
    -- quantité de l'acte : tarif reconnu = tarif unitaire × quantité
    GRANT SELECT (quantite) ON public.actes_dossier TO svc_adjudication;
    -- une ligne provisoire ENTAME les plafonds : le cumul la compte même reportée
    GRANT SELECT (tarif_provisoire) ON public.lignes_facturation TO svc_adjudication;
  END IF;
END $$;
