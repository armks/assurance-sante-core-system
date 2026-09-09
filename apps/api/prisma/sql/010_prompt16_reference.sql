-- ===========================================================================
-- PROMPT 16 — Référentiels médicaux : referentiel_actes + medicaments
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 16 », v9 phase 5
--              (v3 §9 nomenclatures, v8 §10 gouvernance d'homologation
--              PROPOSE → HOMOLOGUE → SUSPENDU/RETIRE).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
--
-- RÈGLE MÉTIER CENTRALE (v8 §10.2) :
--   - proposition / modification en PROPOSE : ASSUREUR_INFORMATIQUE ;
--   - transition vers HOMOLOGUE : EXCLUSIVEMENT ASSUREUR_MEDECIN_CONSEIL pour les
--     actes, EXCLUSIVEMENT ASSUREUR_PHARMACIEN_CONSEIL pour les médicaments ;
--   - aucun autre rôle ne peut homologuer, ni en RLS ni côté NestJS.
-- ===========================================================================

create table if not exists public.referentiel_actes (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id),
  code                 text not null unique,
  libelle              text not null,
  categorie            text,
  version_nomenclature text,
  statut               text not null default 'PROPOSE'
                         check (statut in ('PROPOSE', 'HOMOLOGUE', 'SUSPENDU', 'RETIRE')),
  homologue_par        uuid references public.profils (id),
  date_homologation    timestamptz,
  date_retrait         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists referentiel_actes_organisation_id_idx on public.referentiel_actes (organisation_id);
create index if not exists referentiel_actes_statut_idx          on public.referentiel_actes (statut);

create table if not exists public.medicaments (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id),
  denomination_commune   text not null,
  nom_commercial         text,
  code_ean               text,
  forme                  text,
  dosage                 text,
  conditionnement        text,
  classe_therapeutique   text,
  remboursable           boolean not null default false,
  taux_remboursement_std numeric(5, 2) check (taux_remboursement_std is null or (taux_remboursement_std between 0 and 100)),
  prix_reference_xof     numeric(14, 2) check (prix_reference_xof is null or prix_reference_xof >= 0),
  prix_max_remboursable  numeric(14, 2) check (prix_max_remboursable is null or prix_max_remboursable >= 0),
  medicament_essentiel   boolean not null default false,
  generique_disponible   boolean,
  ordonnance_obligatoire  boolean not null default true,
  medicament_controle    boolean not null default false,
  usage                  text check (usage is null or usage in ('AMBULATOIRE', 'HOSPITALIER', 'LES_DEUX')),
  statut_homologation    text not null default 'PROPOSE'
                           check (statut_homologation in ('PROPOSE', 'HOMOLOGUE', 'SUSPENDU', 'RETIRE')),
  homologue_par          uuid references public.profils (id),
  date_homologation      timestamptz,
  date_retrait           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index if not exists medicaments_organisation_id_idx on public.medicaments (organisation_id);
create index if not exists medicaments_statut_idx          on public.medicaments (statut_homologation);
create index if not exists medicaments_dci_idx             on public.medicaments (lower(denomination_commune));

-- ===========================================================================
-- RLS — lecture ouverte à l'organisation ; écriture (proposition + modifications
-- non-homologantes) réservée à ASSUREUR_INFORMATIQUE ; passage à HOMOLOGUE
-- réservé au rôle conseil correspondant.
--
-- Mécanique : deux policies UPDATE permissives (OR).
--   * policy « informatique »  : WITH CHECK statut <> 'HOMOLOGUE'  → l'Informatique
--     peut tout faire SAUF poser HOMOLOGUE ;
--   * policy « conseil »        : USING/WITH CHECK profil_a_role(rôle conseil)
--     → seul le conseil peut aboutir à un HOMOLOGUE.
-- Aucun autre rôle n'a de policy d'écriture → transition impossible pour lui.
-- NB : NestJS passe par `postgres` (pooler) et contourne la RLS —
-- ClinicalReferenceService applique les mêmes gardes (défense en profondeur).
-- ===========================================================================
alter table public.referentiel_actes enable row level security;
alter table public.medicaments       enable row level security;

-- --- referentiel_actes ------------------------------------------------------
drop policy if exists referentiel_actes_lecture on public.referentiel_actes;
create policy referentiel_actes_lecture on public.referentiel_actes
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists referentiel_actes_insert on public.referentiel_actes;
create policy referentiel_actes_insert on public.referentiel_actes
  for insert
  to authenticated
  with check (
    statut = 'PROPOSE'
    and public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists referentiel_actes_update_informatique on public.referentiel_actes;
create policy referentiel_actes_update_informatique on public.referentiel_actes
  for update
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (
    statut <> 'HOMOLOGUE'
    and public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists referentiel_actes_update_conseil on public.referentiel_actes;
create policy referentiel_actes_update_conseil on public.referentiel_actes
  for update
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']));

-- --- medicaments -----------------------------------------------------------
drop policy if exists medicaments_lecture on public.medicaments;
create policy medicaments_lecture on public.medicaments
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists medicaments_insert on public.medicaments;
create policy medicaments_insert on public.medicaments
  for insert
  to authenticated
  with check (
    statut_homologation = 'PROPOSE'
    and public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists medicaments_update_informatique on public.medicaments;
create policy medicaments_update_informatique on public.medicaments
  for update
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (
    statut_homologation <> 'HOMOLOGUE'
    and public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists medicaments_update_conseil on public.medicaments;
create policy medicaments_update_conseil on public.medicaments
  for update
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL']));

-- ===========================================================================
-- Pré-remplissage : médicaments essentiels de Côte d'Ivoire, au statut PROPOSE
-- (liste réduite — antipaludéens, antibiotiques, antihypertenseurs, analgésiques).
-- organisation_id = tenant de démonstration (aaaaaaaa-…-0001).
-- ===========================================================================
insert into public.medicaments
  (organisation_id, denomination_commune, forme, dosage, classe_therapeutique,
   medicament_essentiel, generique_disponible, ordonnance_obligatoire,
   medicament_controle, usage, statut_homologation)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Artéméther + Luméfantrine', 'Comprimé', '20 mg / 120 mg', 'Antipaludéen',        true,  true,  true,  false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Artésunate',                'Poudre pour injection', '60 mg', 'Antipaludéen',      true,  true,  true,  false, 'HOSPITALIER', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Sulfadoxine + Pyriméthamine','Comprimé', '500 mg / 25 mg', 'Antipaludéen',        true,  true,  true,  false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Amoxicilline',              'Gélule',   '500 mg',        'Antibiotique (bêta-lactamine)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Amoxicilline + Acide clavulanique', 'Comprimé', '500 mg / 125 mg', 'Antibiotique (bêta-lactamine)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ceftriaxone',               'Poudre pour injection', '1 g', 'Antibiotique (céphalosporine)', true, true, true, false, 'HOSPITALIER', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Métronidazole',             'Comprimé', '250 mg',        'Antibactérien / antiparasitaire', true, true, true, false, 'LES_DEUX', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Cotrimoxazole (Sulfaméthoxazole + Triméthoprime)', 'Comprimé', '400 mg / 80 mg', 'Antibiotique (sulfamide)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Amlodipine',                'Comprimé', '5 mg',          'Antihypertenseur (inhibiteur calcique)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Nifédipine',                'Comprimé à libération prolongée', '20 mg', 'Antihypertenseur (inhibiteur calcique)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Hydrochlorothiazide',       'Comprimé', '25 mg',         'Antihypertenseur (diurétique thiazidique)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Énalapril',                 'Comprimé', '10 mg',         'Antihypertenseur (IEC)', true, true, true, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Paracétamol',               'Comprimé', '500 mg',        'Analgésique / antipyrétique', true, true, false, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ibuprofène',                'Comprimé', '400 mg',        'Analgésique / AINS', true, true, false, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Acide acétylsalicylique',   'Comprimé', '500 mg',        'Analgésique / antiagrégant', true, true, false, false, 'AMBULATOIRE', 'PROPOSE'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tramadol',                  'Gélule',   '50 mg',         'Analgésique opioïde', true, true, true, true, 'LES_DEUX', 'PROPOSE')
on conflict do nothing;
