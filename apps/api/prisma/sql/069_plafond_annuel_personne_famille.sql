-- 069 — Plafond annuel double : par PERSONNE et par FAMILLE (ADR-006).
--
-- 1. garanties.plafond_annuel devient plafond_annuel_personne (RENAME : données et
--    comportement inchangés) ; nouvelle colonne optionnelle plafond_annuel_famille
--    (titulaire + tous ses bénéficiaires). Le plus restrictif des deux s'applique ;
--    un plafond absent (NULL) est ignoré.
-- 2. produits.periode_cumul_plafond : période sur laquelle les plafonds annuels se
--    cumulent — ANNEE_POLICE (année d'anniversaire de la police, défaut des nouveaux
--    produits) ou ANNEE_CIVILE. Les produits EXISTANTS passent en ANNEE_CIVILE :
--    c'était le comportement codé en dur dans le microservice (date_trunc('year')).
-- 3. svc_adjudication : lecture des seules colonnes nécessaires — rattachement d'un
--    bénéficiaire à son titulaire (clé de famille) et période du produit.
--
-- Idempotente : rejouable sans erreur.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'garanties' AND column_name = 'plafond_annuel'
  ) THEN
    ALTER TABLE public.garanties RENAME COLUMN plafond_annuel TO plafond_annuel_personne;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garanties_plafond_annuel_check') THEN
    ALTER TABLE public.garanties
      RENAME CONSTRAINT garanties_plafond_annuel_check TO garanties_plafond_annuel_personne_check;
  END IF;
END $$;

ALTER TABLE public.garanties
  ADD COLUMN IF NOT EXISTS plafond_annuel_famille numeric(14, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garanties_plafond_annuel_famille_check') THEN
    ALTER TABLE public.garanties
      ADD CONSTRAINT garanties_plafond_annuel_famille_check
      CHECK (plafond_annuel_famille IS NULL OR plafond_annuel_famille >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.garanties.plafond_annuel_personne IS
  'Plafond annuel par personne assurée (titulaire ou bénéficiaire), sur la période du produit. NULL = pas de plafond par personne.';
COMMENT ON COLUMN public.garanties.plafond_annuel_famille IS
  'Plafond annuel partagé par la famille (titulaire + tous ses bénéficiaires), sur la période du produit. NULL = pas de plafond familial.';

-- Période de cumul : ajoutée avec ANNEE_CIVILE pour remplir les produits existants
-- (comportement actuel), PUIS défaut ANNEE_POLICE pour les produits créés ensuite.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'produits' AND column_name = 'periode_cumul_plafond'
  ) THEN
    ALTER TABLE public.produits
      ADD COLUMN periode_cumul_plafond text NOT NULL DEFAULT 'ANNEE_CIVILE'
      CONSTRAINT produits_periode_cumul_plafond_check
      CHECK (periode_cumul_plafond IN ('ANNEE_POLICE', 'ANNEE_CIVILE'));
    ALTER TABLE public.produits ALTER COLUMN periode_cumul_plafond SET DEFAULT 'ANNEE_POLICE';
  END IF;
END $$;

COMMENT ON COLUMN public.produits.periode_cumul_plafond IS
  'Période de cumul des plafonds annuels : ANNEE_POLICE (année d''anniversaire de la date de début de la police) ou ANNEE_CIVILE (1er janvier – 31 décembre).';

-- Grants svc_adjudication (ADR-003) : colonnes non médicales uniquement.
GRANT SELECT (id, adherent_id, deleted_at) ON public.beneficiaires TO svc_adjudication;
GRANT SELECT (id, periode_cumul_plafond) ON public.produits TO svc_adjudication;

COMMIT;
