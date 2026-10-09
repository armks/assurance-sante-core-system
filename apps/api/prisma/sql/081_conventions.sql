-- 081 — Chantier barème, lot 2 « conventions » (ADR-008).
--
--   1. Libellés d'amorçage des lettres-clés marqués « (fictif) » : ils ne sont pas officiels ; le superadmin
--      les remplace (écran Lettres-clés). Seuls les libellés neutres posés par la migration 080 sont touchés.
--   2. conventions : convention d'un établissement avec l'assureur (numéro, version, période, document signé,
--      circuit PROPOSEE → VALIDEE | REFUSEE, ARCHIVEE, politique de dépassement, saisie / validation tracées).
--      EXCLUDE : jamais deux conventions VALIDEES qui se chevauchent pour le même établissement.
--   3. convention_valeurs : valeur (FCFA) d'une lettre-clé par contexte (AMBULATOIRE | HOSPITALISATION).
--   4. convention_actes : exception par acte — forfait OU valeur de lettre-clé propre à l'acte (un seul des deux).
--   5. Migration des tarifs conventionnés d'établissement : une convention « historique » VALIDEE par
--      établissement, chaque tarif devient une ligne forfaitaire du MÊME identifiant (tarif_conventionne_id
--      des actes déjà calculés reste valide, aucun montant ne change). Les tarifs de pharmacie ne sont pas
--      touchés. `tarifs_conventionnes` reste la table lue par le microservice Java (lot 3) : elle est la
--      projection des forfaits des conventions VALIDEES, alimentée par le service des conventions.
--   6. Bucket privé `conventions` (document signé), écrit et signé par le seul service_role.
--   7. Dépréciation (sans suppression) de etablissements_sante.date_convention / date_fin_convention.
--
-- Idempotente : rejouable sans erreur.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------------ 1. libellés fictifs
UPDATE public.lettres_cles SET libelle = libelle || ' (fictif)', updated_at = now()
 WHERE libelle = 'Lettre-clé ' || code;

-- ------------------------------------------------------------------ 2. conventions
CREATE TABLE IF NOT EXISTS public.conventions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  etablissement_id        uuid NOT NULL REFERENCES public.etablissements_sante (id) ON DELETE RESTRICT,
  numero                  text NOT NULL CHECK (length(btrim(numero)) BETWEEN 1 AND 60),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  convention_precedente_id uuid REFERENCES public.conventions (id) ON DELETE RESTRICT,
  date_debut              date NOT NULL,
  date_fin                date,
  statut                  text NOT NULL DEFAULT 'PROPOSEE'
                          CHECK (statut IN ('PROPOSEE', 'VALIDEE', 'REFUSEE', 'ARCHIVEE')),
  politique_depassement   text NOT NULL DEFAULT 'PATIENT' CHECK (politique_depassement IN ('PATIENT', 'REJET')),
  document_chemin         text,
  document_nom            text,
  document_type           text,
  historique              boolean NOT NULL DEFAULT false,
  saisi_par               uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_saisie             timestamptz NOT NULL DEFAULT now(),
  modifie_par             uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  valide_par              uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_validation         timestamptz,
  refuse_par              uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_refus              timestamptz,
  motif_refus             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT conventions_periode_coherente CHECK (date_fin IS NULL OR date_fin >= date_debut),
  CONSTRAINT conventions_saisie_tracee CHECK (historique OR saisi_par IS NOT NULL),
  -- circuit : validée = validateur ET date ; JAMAIS validée par la personne qui l'a saisie ou modifiée
  CONSTRAINT conventions_validation_tracee CHECK (
    statut <> 'VALIDEE' OR historique
    OR (valide_par IS NOT NULL AND date_validation IS NOT NULL
        AND valide_par IS DISTINCT FROM saisi_par AND valide_par IS DISTINCT FROM modifie_par)
  ),
  CONSTRAINT conventions_refus_motive CHECK (
    statut <> 'REFUSEE' OR (motif_refus IS NOT NULL AND length(btrim(motif_refus)) >= 5 AND refuse_par IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conventions_numero_version_uniq
  ON public.conventions (organisation_id, numero, version) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conventions_etablissement_idx
  ON public.conventions (etablissement_id, statut) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conventions_organisation_statut_idx
  ON public.conventions (organisation_id, statut) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conventions_validees_sans_chevauchement') THEN
    ALTER TABLE public.conventions
      ADD CONSTRAINT conventions_validees_sans_chevauchement
      EXCLUDE USING gist (
        etablissement_id WITH =,
        daterange(date_debut, date_fin, '[]') WITH &&
      ) WHERE (statut = 'VALIDEE' AND deleted_at IS NULL);
  END IF;
END $$;

-- ------------------------------------------------------------------ 3. valeurs par lettre-clé et par contexte
CREATE TABLE IF NOT EXISTS public.convention_valeurs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convention_id     uuid NOT NULL REFERENCES public.conventions (id) ON DELETE RESTRICT,
  lettre_cle_code   text NOT NULL REFERENCES public.lettres_cles (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  contexte          text NOT NULL CHECK (contexte IN ('AMBULATOIRE', 'HOSPITALISATION')),
  valeur            numeric(14, 2) NOT NULL CHECK (valeur > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS convention_valeurs_uniq
  ON public.convention_valeurs (convention_id, lettre_cle_code, contexte) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS convention_valeurs_convention_idx
  ON public.convention_valeurs (convention_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------ 4. exceptions par acte
CREATE TABLE IF NOT EXISTS public.convention_actes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convention_id        uuid NOT NULL REFERENCES public.conventions (id) ON DELETE RESTRICT,
  referentiel_acte_id  uuid NOT NULL REFERENCES public.referentiel_actes (id) ON DELETE RESTRICT,
  prix_forfaitaire     numeric(14, 2) CHECK (prix_forfaitaire IS NULL OR prix_forfaitaire > 0),
  valeur_lettre_cle    numeric(14, 2) CHECK (valeur_lettre_cle IS NULL OR valeur_lettre_cle > 0),
  -- période propre (migration de l'historique) ; NULL = période de la convention
  date_debut           date,
  date_fin             date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  -- forfait OU valeur de lettre-clé propre à l'acte : exactement un des deux
  CONSTRAINT convention_actes_un_seul_prix CHECK (num_nonnulls(prix_forfaitaire, valeur_lettre_cle) = 1),
  CONSTRAINT convention_actes_periode_coherente CHECK (date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut)
);
CREATE INDEX IF NOT EXISTS convention_actes_convention_idx
  ON public.convention_actes (convention_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS convention_actes_acte_idx
  ON public.convention_actes (referentiel_acte_id) WHERE deleted_at IS NULL;

DO $$
BEGIN
  -- un même acte peut avoir plusieurs lignes dans une convention (historique) à condition que leurs périodes
  -- ne se chevauchent pas ; une période NULL est sans borne
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'convention_actes_sans_chevauchement') THEN
    ALTER TABLE public.convention_actes
      ADD CONSTRAINT convention_actes_sans_chevauchement
      EXCLUDE USING gist (
        convention_id WITH =,
        referentiel_acte_id WITH =,
        daterange(date_debut, date_fin, '[]') WITH &&
      ) WHERE (deleted_at IS NULL);
  END IF;
END $$;

-- ------------------------------------------------------------------ RLS (les écritures passent par l'API)
ALTER TABLE public.conventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convention_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convention_actes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conventions_lecture ON public.conventions;
CREATE POLICY conventions_lecture ON public.conventions FOR SELECT TO authenticated
  USING (public.profil_a_role(organisation_id,
    ARRAY['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION']));
DROP POLICY IF EXISTS convention_valeurs_lecture ON public.convention_valeurs;
CREATE POLICY convention_valeurs_lecture ON public.convention_valeurs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conventions c WHERE c.id = convention_id
    AND public.profil_a_role(c.organisation_id,
      ARRAY['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION'])));
DROP POLICY IF EXISTS convention_actes_lecture ON public.convention_actes;
CREATE POLICY convention_actes_lecture ON public.convention_actes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conventions c WHERE c.id = convention_id
    AND public.profil_a_role(c.organisation_id,
      ARRAY['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION'])));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conventions', 'convention_valeurs', 'convention_actes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS profil_actif_exige ON public.%I', t);
    EXECUTE format('CREATE POLICY profil_actif_exige ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.profil_appelant_actif())) WITH CHECK ((SELECT public.profil_appelant_actif()))', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ 5. migration des tarifs d'établissement
-- Une convention HISTORIQUE par établissement ayant des tarifs non supprimés ; période = du plus ancien tarif
-- à la fin du dernier si TOUS sont clos (sinon sans fin). Les identifiants des tarifs sont repris tels quels.
INSERT INTO public.conventions
  (organisation_id, etablissement_id, numero, version, date_debut, date_fin, statut, historique,
   politique_depassement, date_validation)
SELECT t.organisation_id,
       t.etablissement_id,
       'HISTORIQUE-' || e.code,
       1,
       min(t.date_debut),
       CASE WHEN bool_and(t.date_fin IS NOT NULL) THEN max(t.date_fin) END,
       'VALIDEE',
       true,
       'PATIENT',
       now()
  FROM public.tarifs_conventionnes t
  JOIN public.etablissements_sante e ON e.id = t.etablissement_id
 WHERE t.etablissement_id IS NOT NULL AND t.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.conventions c
                    WHERE c.etablissement_id = t.etablissement_id AND c.historique AND c.deleted_at IS NULL)
 GROUP BY t.organisation_id, t.etablissement_id, e.code;

INSERT INTO public.convention_actes (id, convention_id, referentiel_acte_id, prix_forfaitaire, date_debut, date_fin)
SELECT t.id, c.id, t.referentiel_acte_id, t.tarif_convention, t.date_debut, t.date_fin
  FROM public.tarifs_conventionnes t
  JOIN public.conventions c ON c.etablissement_id = t.etablissement_id AND c.historique AND c.deleted_at IS NULL
 WHERE t.etablissement_id IS NOT NULL AND t.deleted_at IS NULL AND t.tarif_convention > 0
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ 6. bucket des documents signés
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('conventions', 'conventions', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------ 7. dépréciation
COMMENT ON COLUMN public.etablissements_sante.date_convention IS
  'DÉPRÉCIÉ (prisma/sql/081) : la période de validité vient désormais de la table conventions. Conservé, non supprimé.';
COMMENT ON COLUMN public.etablissements_sante.date_fin_convention IS
  'DÉPRÉCIÉ (prisma/sql/081) : la période de validité vient désormais de la table conventions. Conservé, non supprimé.';
