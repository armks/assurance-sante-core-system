-- 090 — Le référentiel médical de l'assureur est le CATALOGUE NATIONAL (ADR-009).
--
-- Le contenu (code, libellé, catégorie, cotation, dénomination, dosage…) vient UNIQUEMENT du catalogue national ; l'assureur ne fait que
-- l'ACTIVER ou le DÉSACTIVER pour son organisation (ASSUREUR_INFORMATIQUE, ASSUREUR_MEDECIN_CONSEIL, ASSUREUR_PHARMACIEN_CONSEIL).
-- Ligne de l'organisation = « activation » du catalogue national, et point d'ancrage des liens existants (conventions, tarifs, actes,
-- ADR-007) : statut HOMOLOGUE = élément ACTIF, SUSPENDU = DÉSACTIVÉ, aucune ligne = jamais activé.
--
--   1. referentiel_actes.catalogue_national_id / medicaments.catalogue_national_id : l'élément du catalogue national activé.
--   2. Reprise de l'existant : rattachement par code (actes) ou par dénomination + dosage + forme + nom commercial (médicaments).
--   3. Une seule ligne d'activation PAR organisation et par élément du catalogue national.
--
-- Idempotente.

ALTER TABLE public.referentiel_actes
  ADD COLUMN IF NOT EXISTS catalogue_national_id uuid REFERENCES public.referentiel_national_actes (id) ON DELETE RESTRICT;
ALTER TABLE public.medicaments
  ADD COLUMN IF NOT EXISTS catalogue_national_id uuid REFERENCES public.referentiel_national_medicaments (id) ON DELETE RESTRICT;

UPDATE public.referentiel_actes r
   SET catalogue_national_id = n.id
  FROM public.referentiel_national_actes n
 WHERE r.catalogue_national_id IS NULL
   AND r.deleted_at IS NULL
   AND n.deleted_at IS NULL
   AND n.code = r.code;

WITH candidats AS (
  SELECT m.id AS medicament_id,
         n.id AS national_id,
         row_number() OVER (PARTITION BY m.organisation_id, n.id ORDER BY m.created_at, m.id) AS rang
    FROM public.medicaments m
    JOIN public.referentiel_national_medicaments n
      ON lower(n.denomination_commune) = lower(m.denomination_commune)
     AND coalesce(lower(n.dosage), '') = coalesce(lower(m.dosage), '')
     AND coalesce(lower(n.forme), '') = coalesce(lower(m.forme), '')
     AND coalesce(lower(n.nom_commercial), '') = coalesce(lower(m.nom_commercial), '')
   WHERE m.deleted_at IS NULL AND n.deleted_at IS NULL AND m.catalogue_national_id IS NULL
)
UPDATE public.medicaments m
   SET catalogue_national_id = c.national_id
  FROM candidats c
 WHERE c.medicament_id = m.id AND c.rang = 1;

CREATE UNIQUE INDEX IF NOT EXISTS referentiel_actes_org_catalogue_national_unique
  ON public.referentiel_actes (organisation_id, catalogue_national_id)
  WHERE deleted_at IS NULL AND catalogue_national_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS medicaments_org_catalogue_national_unique
  ON public.medicaments (organisation_id, catalogue_national_id)
  WHERE deleted_at IS NULL AND catalogue_national_id IS NOT NULL;
