-- 074 — Chantier suppression / archivage, lot 2 (ADR-007) :
--   1. Unicité limitée aux lignes NON supprimées (index uniques partiels
--      `WHERE deleted_at IS NULL`) pour les codes, noms et slugs SAISIS par un
--      utilisateur : un code, un nom ou un slug supprimé peut être recréé.
--   2. Traces des liens de calcul (écart n° 9 de l'audit) :
--      - cotisations.grille_tarifaire_id et tarification_individuelle.grille_tarifaire_id :
--        grille ayant servi au calcul de la prime ;
--      - actes_dossier.tarif_conventionne_id : tarif conventionné appliqué au calcul de
--        l'acte (facture, simulation, adjudication) ;
--      - lignes_dispensation.tarif_pharmacie_id : tarif conventionné de la pharmacie
--        appliqué à la ligne. Le comptoir calcule aujourd'hui au prix du STOCK : la colonne
--        reste vide tant qu'un tarif de pharmacie n'est pas rattaché à un médicament
--        (décision du 2026-10-08, lot ultérieur).
--      Clés étrangères ON DELETE RESTRICT : un tarif ou une grille ayant servi ne
--      disparaît jamais de la base.
--   3. Rattachement de l'existant (même règle que le calcul) ; les lignes impossibles à
--      rattacher sont listées par NOTICE.
--
-- Identifiants GÉNÉRÉS conservés uniques sur toute la table (jamais réattribués, même
-- après suppression — traçabilité) : numéros de carte, d'adhérent, de police, de
-- traitement, de consultation, codes de facturation, jetons d'invitation.
--
-- Idempotente : rejouable sans erreur.

BEGIN;

-- 1. Unicité des lignes non supprimées --------------------------------------------------
ALTER TABLE public.etablissements_sante DROP CONSTRAINT IF EXISTS etablissements_sante_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS etablissements_sante_code_actif_key
  ON public.etablissements_sante (code) WHERE deleted_at IS NULL;

ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_code_actif_key
  ON public.pharmacies (code) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.organisations_slug_unique;
CREATE UNIQUE INDEX IF NOT EXISTS organisations_slug_actif_key
  ON public.organisations (slug) WHERE deleted_at IS NULL;

ALTER TABLE public.produits DROP CONSTRAINT IF EXISTS produits_org_nom_version_unique;
CREATE UNIQUE INDEX IF NOT EXISTS produits_org_nom_version_actif_key
  ON public.produits (organisation_id, nom, version) WHERE deleted_at IS NULL;

ALTER TABLE public.referentiel_actes DROP CONSTRAINT IF EXISTS referentiel_actes_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS referentiel_actes_code_actif_key
  ON public.referentiel_actes (code) WHERE deleted_at IS NULL;

ALTER TABLE public.referentiel_national_actes DROP CONSTRAINT IF EXISTS referentiel_national_actes_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS referentiel_national_actes_code_actif_key
  ON public.referentiel_national_actes (code) WHERE deleted_at IS NULL;

-- 2. Colonnes de trace -------------------------------------------------------------------
ALTER TABLE public.cotisations
  ADD COLUMN IF NOT EXISTS grille_tarifaire_id uuid;
ALTER TABLE public.tarification_individuelle
  ADD COLUMN IF NOT EXISTS grille_tarifaire_id uuid;
ALTER TABLE public.actes_dossier
  ADD COLUMN IF NOT EXISTS tarif_conventionne_id uuid;
ALTER TABLE public.lignes_dispensation
  ADD COLUMN IF NOT EXISTS tarif_pharmacie_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cotisations_grille_tarifaire_id_fkey') THEN
    ALTER TABLE public.cotisations ADD CONSTRAINT cotisations_grille_tarifaire_id_fkey
      FOREIGN KEY (grille_tarifaire_id) REFERENCES public.grilles_tarifaires (id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarification_individuelle_grille_tarifaire_id_fkey') THEN
    ALTER TABLE public.tarification_individuelle ADD CONSTRAINT tarification_individuelle_grille_tarifaire_id_fkey
      FOREIGN KEY (grille_tarifaire_id) REFERENCES public.grilles_tarifaires (id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actes_dossier_tarif_conventionne_id_fkey') THEN
    ALTER TABLE public.actes_dossier ADD CONSTRAINT actes_dossier_tarif_conventionne_id_fkey
      FOREIGN KEY (tarif_conventionne_id) REFERENCES public.tarifs_conventionnes (id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lignes_dispensation_tarif_pharmacie_id_fkey') THEN
    ALTER TABLE public.lignes_dispensation ADD CONSTRAINT lignes_dispensation_tarif_pharmacie_id_fkey
      FOREIGN KEY (tarif_pharmacie_id) REFERENCES public.tarifs_conventionnes (id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cotisations_grille_tarifaire_idx ON public.cotisations (grille_tarifaire_id);
CREATE INDEX IF NOT EXISTS tarification_individuelle_grille_tarifaire_idx ON public.tarification_individuelle (grille_tarifaire_id);
CREATE INDEX IF NOT EXISTS actes_dossier_tarif_conventionne_idx ON public.actes_dossier (tarif_conventionne_id);
CREATE INDEX IF NOT EXISTS lignes_dispensation_tarif_pharmacie_idx ON public.lignes_dispensation (tarif_pharmacie_id);

-- Le microservice d'adjudication trace le tarif appliqué à l'acte qu'il adjuge (seule
-- colonne de la table qu'il peut écrire).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_adjudication') THEN
    GRANT UPDATE (tarif_conventionne_id) ON public.actes_dossier TO svc_adjudication;
  END IF;
END $$;

-- 3. Rattachement de l'existant ----------------------------------------------------------
-- Cotisations INDIVIDUELLES : même règle que BillingService.calculer — grille négociée
-- du souscripteur de la police, sinon grille standard du produit, par âge de l'adhérent
-- au premier jour de la période. Les cotisations CONSOLIDÉES (société) sont une somme,
-- jamais calculées sur une grille : elles restent sans grille, par construction.
WITH cible AS (
  SELECT c.id,
         date_part('year', age(c.periode, a.date_naissance))::int AS age,
         p.produit_id, p.souscripteur_id
  FROM public.cotisations c
  JOIN public.polices p ON p.id = c.police_id
  JOIN public.adherents a ON a.id = c.adherent_id
  WHERE c.adherent_id IS NOT NULL AND c.grille_tarifaire_id IS NULL
)
UPDATE public.cotisations c
SET grille_tarifaire_id = COALESCE(
  (SELECT g.id FROM public.grilles_tarifaires g
    WHERE g.produit_id = cible.produit_id AND g.souscripteur_id = cible.souscripteur_id
      AND g.deleted_at IS NULL AND cible.age BETWEEN g.tranche_age_min AND g.tranche_age_max
    LIMIT 1),
  (SELECT g.id FROM public.grilles_tarifaires g
    WHERE g.produit_id = cible.produit_id AND g.souscripteur_id IS NULL
      AND g.deleted_at IS NULL AND cible.age BETWEEN g.tranche_age_min AND g.tranche_age_max
    LIMIT 1))
FROM cible
WHERE c.id = cible.id;

-- Tarifications individuelles : grille STANDARD par âge à la souscription
-- (UnderwritingService.calculerPrime).
UPDATE public.tarification_individuelle t
SET grille_tarifaire_id = (
  SELECT g.id FROM public.grilles_tarifaires g
  JOIN public.polices p ON p.produit_id = g.produit_id
  WHERE p.id = t.police_id AND g.souscripteur_id IS NULL AND g.deleted_at IS NULL
    AND t.age_a_souscription BETWEEN g.tranche_age_min AND g.tranche_age_max
  LIMIT 1)
WHERE t.grille_tarifaire_id IS NULL;

-- Actes : tarif de l'établissement du dossier, pour le code de l'acte, en vigueur à la
-- date des soins (réalisation, à défaut prescription) — même jointure que le calcul.
UPDATE public.actes_dossier ad
SET tarif_conventionne_id = (
  SELECT tc.id
  FROM public.dossiers_soins ds
  JOIN public.referentiel_actes ra ON ra.code = ad.code_acte AND ra.deleted_at IS NULL
  JOIN public.tarifs_conventionnes tc
    ON tc.etablissement_id = ds.etablissement_id AND tc.referentiel_acte_id = ra.id
   AND tc.deleted_at IS NULL
   AND tc.date_debut <= (COALESCE(ad.date_realisation, ad.date_prescription) AT TIME ZONE 'UTC')::date
   AND (tc.date_fin IS NULL OR tc.date_fin >= (COALESCE(ad.date_realisation, ad.date_prescription) AT TIME ZONE 'UTC')::date)
  WHERE ds.id = ad.dossier_soins_id
  LIMIT 1)
WHERE ad.tarif_conventionne_id IS NULL AND ad.code_acte IS NOT NULL;

-- Ce qui n'a pas pu être rattaché (à examiner, rien n'est inventé).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'cotisation individuelle sans grille applicable' AS quoi, c.id
      FROM public.cotisations c WHERE c.adherent_id IS NOT NULL AND c.grille_tarifaire_id IS NULL
    UNION ALL
    SELECT 'tarification individuelle sans grille standard applicable', t.id
      FROM public.tarification_individuelle t WHERE t.grille_tarifaire_id IS NULL
    UNION ALL
    SELECT 'acte codé sans tarif conventionné en vigueur (calculé au montant facturé)', ad.id
      FROM public.actes_dossier ad WHERE ad.code_acte IS NOT NULL AND ad.tarif_conventionne_id IS NULL
  LOOP
    RAISE NOTICE 'Non rattaché : % (%)', r.quoi, r.id;
  END LOOP;
END $$;

COMMIT;
