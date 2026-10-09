-- 080 — Chantier barème, lot 1 « nomenclature » (ADR-008).
--
--   1. lettres_cles : référentiel PARAMÉTRABLE des lettres-clés (B, Z, K, D, KA, KC, KE, P, AMI, AMK),
--      géré par le superadmin. AUCUNE valeur chiffrée ici : les valeurs en FCFA sont négociées
--      établissement par établissement (lots suivants). Libellés d'amorçage neutres, à compléter.
--   2. Cotation sur `referentiel_national_actes` ET `referentiel_actes` : lettre-clé (FK), coefficient,
--      mode (ISOLE | GROUPE), catégorie de GARANTIE (FK categories_acte, distincte du chapitre `categorie`),
--      code de groupe. Cohérence garantie par CHECK.
--   3. `referentiel_actes.code` unique PAR ORGANISATION (et non plus globalement) : deux organisations
--      peuvent avoir le même code d'acte.
--   4. `actes_dossier.referentiel_acte_id` (FK) remplace la jointure par code en texte libre ; rattachement
--      de l'existant dans l'organisation du dossier.
--
-- Idempotente : rejouable sans erreur.

-- ------------------------------------------------------------------ 1. lettres-clés
CREATE TABLE IF NOT EXISTS public.lettres_cles (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z]{1,4}$'),
  libelle     text NOT NULL,
  actif       boolean NOT NULL DEFAULT true,
  ordre       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- identifiant technique (écrans, registre des dépendances) ; `code` reste la clé étrangère des actes
ALTER TABLE public.lettres_cles ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS lettres_cles_id_uniq ON public.lettres_cles (id);

CREATE UNIQUE INDEX IF NOT EXISTS lettres_cles_libelle_uniq ON public.lettres_cles (lower(libelle));

INSERT INTO public.lettres_cles (code, libelle, ordre) VALUES
  ('B',   'Lettre-clé B',   10),
  ('Z',   'Lettre-clé Z',   20),
  ('K',   'Lettre-clé K',   30),
  ('D',   'Lettre-clé D',   40),
  ('KA',  'Lettre-clé KA',  50),
  ('KC',  'Lettre-clé KC',  60),
  ('KE',  'Lettre-clé KE',  70),
  ('P',   'Lettre-clé P',   80),
  ('AMI', 'Lettre-clé AMI', 90),
  ('AMK', 'Lettre-clé AMK', 100)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.lettres_cles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lettres_cles_lecture ON public.lettres_cles;
CREATE POLICY lettres_cles_lecture ON public.lettres_cles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lettres_cles_ecriture_superadmin ON public.lettres_cles;
CREATE POLICY lettres_cles_ecriture_superadmin ON public.lettres_cles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profils p
                  WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND p.role = 'SUPERADMIN_PRINCIPAL'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profils p
                       WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND p.role = 'SUPERADMIN_PRINCIPAL'));

-- même garde que toutes les tables à RLS (076) : profil actif exigé
DROP POLICY IF EXISTS profil_actif_exige ON public.lettres_cles;
CREATE POLICY profil_actif_exige ON public.lettres_cles AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.profil_appelant_actif()))
  WITH CHECK ((SELECT public.profil_appelant_actif()));

-- ------------------------------------------------------------------ 2. cotation des actes
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['referentiel_national_actes', 'referentiel_actes'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS lettre_cle_code text REFERENCES public.lettres_cles (code) ON UPDATE CASCADE ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS coefficient numeric(8, 2),
      ADD COLUMN IF NOT EXISTS mode_cotation text NOT NULL DEFAULT ''ISOLE'',
      ADD COLUMN IF NOT EXISTS categorie_garantie text REFERENCES public.categories_acte (code) ON UPDATE CASCADE ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS groupe_code text', t);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_cotation_coherente') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        mode_cotation IN (''ISOLE'', ''GROUPE'')
        AND (lettre_cle_code IS NULL) = (coefficient IS NULL)
        AND (coefficient IS NULL OR coefficient > 0)
        AND ((mode_cotation = ''GROUPE'') = (groupe_code IS NOT NULL))
      )', t, t || '_cotation_coherente');
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (lettre_cle_code) WHERE lettre_cle_code IS NOT NULL AND deleted_at IS NULL',
                   t || '_lettre_cle_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (categorie_garantie) WHERE categorie_garantie IS NOT NULL AND deleted_at IS NULL',
                   t || '_categorie_garantie_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (groupe_code) WHERE groupe_code IS NOT NULL AND deleted_at IS NULL',
                   t || '_groupe_idx', t);

    -- l'existant : `categorie` contenait déjà un code de categories_acte (prisma/sql/067)
    EXECUTE format('UPDATE public.%I x SET categorie_garantie = x.categorie
                      WHERE x.categorie_garantie IS NULL
                        AND x.categorie IN (SELECT code FROM public.categories_acte)', t);
  END LOOP;
END $$;

-- le CHAPITRE (`categorie`) devient un texte libre : la clé étrangère vers categories_acte (067) passe sur
-- `categorie_garantie` (copiée ci-dessus à partir de l'existant)
ALTER TABLE public.referentiel_actes DROP CONSTRAINT IF EXISTS referentiel_actes_categorie_fkey;
ALTER TABLE public.referentiel_national_actes DROP CONSTRAINT IF EXISTS referentiel_national_actes_categorie_fkey;

-- ------------------------------------------------------------------ 3. code d'acte unique PAR ORGANISATION
DROP INDEX IF EXISTS public.referentiel_actes_code_actif_key;
CREATE UNIQUE INDEX IF NOT EXISTS referentiel_actes_organisation_code_actif_key
  ON public.referentiel_actes (organisation_id, code) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------ 4. acte de dossier -> acte du référentiel
ALTER TABLE public.actes_dossier
  ADD COLUMN IF NOT EXISTS referentiel_acte_id uuid REFERENCES public.referentiel_actes (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS actes_dossier_referentiel_acte_idx
  ON public.actes_dossier (referentiel_acte_id) WHERE referentiel_acte_id IS NOT NULL;

-- rattachement de l'existant : même code, dans l'organisation du dossier, acte du référentiel non supprimé
UPDATE public.actes_dossier ad
   SET referentiel_acte_id = ra.id
  FROM public.dossiers_soins ds, public.referentiel_actes ra
 WHERE ds.id = ad.dossier_soins_id
   AND ra.organisation_id = ds.organisation_id
   AND ra.code = ad.code_acte
   AND ra.deleted_at IS NULL
   AND ad.referentiel_acte_id IS NULL
   AND ad.code_acte IS NOT NULL;

-- ------------------------------------------------------------------ 5. droits du microservice d'adjudication
-- svc_adjudication ne lit que des COLONNES de actes_dossier (aucune donnée médicale, prisma/sql/070) : la
-- jointure par clé étrangère exige la nouvelle colonne, et le filtre par organisation celle du référentiel.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_adjudication') THEN
    GRANT SELECT (referentiel_acte_id) ON public.actes_dossier TO svc_adjudication;
    GRANT SELECT (organisation_id) ON public.referentiel_actes TO svc_adjudication;
  END IF;
END $$;
