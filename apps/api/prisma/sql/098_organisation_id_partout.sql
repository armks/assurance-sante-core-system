-- 098 — `organisation_id` sur TOUTES les tables de données d'une société.
--
--   Audit (097) : 18 tables « enfants » (lignes de dispensation, bénéficiaires, garanties, remboursements, cotisations…) ne
--   portaient pas l'identifiant de la société et n'y étaient reliées que par leur parent. Chacune reçoit maintenant
--   `organisation_id` (NOT NULL, clé étrangère vers `organisations`, index), hérité AUTOMATIQUEMENT de son parent par un
--   déclencheur (le code applicatif n'a rien à renseigner ; une valeur incohérente avec le parent est refusée).
--   Résultat : toute donnée d'une société se filtre par `organisation_id` — donc par `organisations.code_assureur`.
--
--   Restent volontairement SANS société (référentiels partagés de la plateforme) : catégories d'acte, lettres-clés, entités
--   et sous-rôles, règles de provisioning, paramètres, catalogues nationaux (actes, médicaments, CIM-10), newsletter,
--   codes de validation superadmin, imports de catalogue national. `profils`, `invitations`, `audit_log`, `journal_actions`,
--   `demandes_adhesion` gardent une société facultative (comptes et événements de la plateforme).
--
--   Fonctions utilitaires : `organisation_id_du_code_assureur(code)` et la vue `v_organisations_par_code`.
--
-- Idempotente : rejouable sans erreur.

CREATE OR REPLACE FUNCTION public.renseigner_organisation_id() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i int := 0;
  v_fk uuid;
  v_org uuid;
BEGIN
  -- arguments : (table parente, colonne de liaison) par paire, la première liaison renseignée l'emporte
  WHILE i + 1 < TG_NARGS LOOP
    v_fk := (to_jsonb(NEW) ->> TG_ARGV[i + 1])::uuid;
    IF v_fk IS NOT NULL THEN
      EXECUTE format('SELECT organisation_id FROM public.%I WHERE id = $1', TG_ARGV[i]) INTO v_org USING v_fk;
      EXIT;
    END IF;
    i := i + 2;
  END LOOP;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'organisation_id introuvable pour %.% (parent absent)', TG_TABLE_NAME, TG_ARGV[1];
  END IF;
  IF NEW.organisation_id IS NOT NULL AND NEW.organisation_id <> v_org THEN
    RAISE EXCEPTION 'organisation_id % incohérent avec celui du parent (%) sur %', NEW.organisation_id, v_org, TG_TABLE_NAME;
  END IF;
  NEW.organisation_id := v_org;
  RETURN NEW;
END $$;

DO $$
DECLARE
  -- table, parent, colonne de liaison [, parent 2, colonne 2] — ordre : un parent doit être traité avant ses enfants
  liens text[][] := ARRAY[
    ['beneficiaires',                 'adherents',                       'adherent_id',                 NULL, NULL],
    ['avenants',                      'polices',                         'police_id',                   NULL, NULL],
    ['cotisations',                   'polices',                         'police_id',                   NULL, NULL],
    ['tarification_individuelle',     'polices',                         'police_id',                   NULL, NULL],
    ['garanties',                     'produits',                        'produit_id',                  NULL, NULL],
    ['membres_comite_gestion',        'souscripteurs',                   'souscripteur_id',             NULL, NULL],
    ['plan_paiement_collectivite',    'souscripteurs',                   'souscripteur_id',             NULL, NULL],
    ['questionnaires_medicaux',       'souscripteurs',                   'souscripteur_id',             NULL, NULL],
    ['convention_actes',              'conventions',                     'convention_id',               NULL, NULL],
    ['convention_valeurs',            'conventions',                     'convention_id',               NULL, NULL],
    ['consultations_dossier',         'dossiers_soins',                  'dossier_soins_id',            NULL, NULL],
    ['actes_dossier',                 'dossiers_soins',                  'dossier_soins_id',            NULL, NULL],
    ['lignes_ordonnance',             'ordonnances',                     'ordonnance_id',               NULL, NULL],
    ['dispensations_pharmacie',       'pharmacies',                      'pharmacie_id',                NULL, NULL],
    ['stock_medicaments_pharmacie',   'pharmacies',                      'pharmacie_id',                NULL, NULL],
    ['lignes_dispensation',           'dispensations_pharmacie',         'dispensation_id',             NULL, NULL],
    ['remboursements',                'reclamations',                    'reclamation_id',              NULL, NULL],
    ['paiements_groupes_factures',    'paiements_groupes',               'paiement_groupe_id',          NULL, NULL],
    ['verifications_etablissement',   'etablissements_sante',            'etablissement_id',            'pharmacies', 'pharmacie_id']
  ];
  r text[];
  t text;
  args text;
BEGIN
  FOREACH r SLICE 1 IN ARRAY liens LOOP
    t := r[1];
    args := quote_literal(r[2]) || ', ' || quote_literal(r[3]);
    IF r[4] IS NOT NULL THEN
      args := args || ', ' || quote_literal(r[4]) || ', ' || quote_literal(r[5]);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organisation_id uuid', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_organisation_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_organisation_id BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.renseigner_organisation_id(%s)',
      t, args);

    -- rattrapage des lignes existantes (le déclencheur renseigne la valeur) sans réveiller les autres déclencheurs
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER trg_organisation_id', t);
    EXECUTE format('UPDATE public.%I SET organisation_id = NULL WHERE organisation_id IS NULL', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organisation_id SET NOT NULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = t || '_organisation_id_fkey' AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)',
        t, t || '_organisation_id_fkey');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id)', t || '_organisation_id_idx', t);
  END LOOP;
END $$;

-- journal_actions : société facultative mais, quand elle est renseignée, elle doit exister
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_actions_organisation_id_fkey') THEN
    ALTER TABLE public.journal_actions
      ADD CONSTRAINT journal_actions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) NOT VALID;
  END IF;
END $$;

-- Repérage d'une société par son code assureur
CREATE OR REPLACE FUNCTION public.organisation_id_du_code_assureur(p_code text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM public.organisations WHERE code_assureur = p_code $$;

CREATE OR REPLACE VIEW public.v_organisations_par_code AS
  SELECT code_assureur, id AS organisation_id, nom, type, pays, statut FROM public.organisations;

-- Outils d'administration : jamais exposés à l'API publique de Supabase
REVOKE ALL ON public.v_organisations_par_code FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organisation_id_du_code_assureur(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renseigner_organisation_id() FROM PUBLIC, anon, authenticated;
