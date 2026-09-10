-- ===========================================================================
-- PROMPT 23 — Panneau de configuration Super Admin
--   1. parametres_plateforme  (devises, pays/villes, taux de taxe, langues)
--   2. tableau de bord santé système (agrégations, pas de table)
--   3. catalogue national partagé  (v1 §10.4) :
--        referentiel_national_actes / referentiel_national_medicaments
--        — mêmes colonnes que referentiel_actes / medicaments SANS organisation_id,
--          maintenu EXCLUSIVEMENT par SUPERADMIN_PRINCIPAL.
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- L'import vers le référentiel d'une organisation (ASSUREUR_INFORMATIQUE) crée
-- une copie au statut PROPOSE — la règle d'homologation existante est INCHANGÉE :
-- seuls ASSUREUR_MEDECIN_CONSEIL / ASSUREUR_PHARMACIEN_CONSEIL de cette
-- organisation peuvent ensuite homologuer (v8 §10.2).
-- ===========================================================================

-- --- 1. parametres_plateforme ---------------------------------------------
create table if not exists public.parametres_plateforme (
  id          uuid primary key default gen_random_uuid(),
  cle         text not null unique,
  valeur      jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.parametres_plateforme enable row level security;

-- lecture ET écriture EXCLUSIVEMENT SUPERADMIN_PRINCIPAL
drop policy if exists parametres_plateforme_superadmin_only on public.parametres_plateforme;
create policy parametres_plateforme_superadmin_only on public.parametres_plateforme
  for all
  to authenticated
  using (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role = 'SUPERADMIN_PRINCIPAL')
  )
  with check (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role = 'SUPERADMIN_PRINCIPAL')
  );

-- --- 3. catalogue national partagé ---------------------------------------
create table if not exists public.referentiel_national_actes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  libelle              text not null,
  categorie            text,
  version_nomenclature text,
  statut               text not null default 'HOMOLOGUE'
                         check (statut in ('PROPOSE', 'HOMOLOGUE', 'SUSPENDU', 'RETIRE')),
  homologue_par        uuid,
  date_homologation    timestamptz,
  date_retrait         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index if not exists referentiel_national_actes_statut_idx on public.referentiel_national_actes (statut);

create table if not exists public.referentiel_national_medicaments (
  id                     uuid primary key default gen_random_uuid(),
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
  ordonnance_obligatoire boolean not null default true,
  medicament_controle    boolean not null default false,
  usage                  text check (usage is null or usage in ('AMBULATOIRE', 'HOSPITALIER', 'LES_DEUX')),
  statut_homologation    text not null default 'HOMOLOGUE'
                           check (statut_homologation in ('PROPOSE', 'HOMOLOGUE', 'SUSPENDU', 'RETIRE')),
  homologue_par          uuid,
  date_homologation      timestamptz,
  date_retrait           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create index if not exists referentiel_national_medicaments_statut_idx on public.referentiel_national_medicaments (statut_homologation);
create index if not exists referentiel_national_medicaments_dci_idx    on public.referentiel_national_medicaments (lower(denomination_commune));

alter table public.referentiel_national_actes       enable row level security;
alter table public.referentiel_national_medicaments enable row level security;

-- lecture : tout compte authentifié (catalogue partagé, consulté avant import) ;
-- écriture : EXCLUSIVEMENT SUPERADMIN_PRINCIPAL.
drop policy if exists referentiel_national_actes_lecture on public.referentiel_national_actes;
create policy referentiel_national_actes_lecture on public.referentiel_national_actes
  for select to authenticated using (true);

drop policy if exists referentiel_national_actes_ecriture_superadmin on public.referentiel_national_actes;
create policy referentiel_national_actes_ecriture_superadmin on public.referentiel_national_actes
  for all to authenticated
  using (exists (select 1 from public.profils p
                 where p.id = auth.uid() and p.deleted_at is null
                   and p.role = 'SUPERADMIN_PRINCIPAL'))
  with check (exists (select 1 from public.profils p
                      where p.id = auth.uid() and p.deleted_at is null
                        and p.role = 'SUPERADMIN_PRINCIPAL'));

drop policy if exists referentiel_national_medicaments_lecture on public.referentiel_national_medicaments;
create policy referentiel_national_medicaments_lecture on public.referentiel_national_medicaments
  for select to authenticated using (true);

drop policy if exists referentiel_national_medicaments_ecriture_superadmin on public.referentiel_national_medicaments;
create policy referentiel_national_medicaments_ecriture_superadmin on public.referentiel_national_medicaments
  for all to authenticated
  using (exists (select 1 from public.profils p
                 where p.id = auth.uid() and p.deleted_at is null
                   and p.role = 'SUPERADMIN_PRINCIPAL'))
  with check (exists (select 1 from public.profils p
                      where p.id = auth.uid() and p.deleted_at is null
                        and p.role = 'SUPERADMIN_PRINCIPAL'));

-- ===========================================================================
-- Pré-remplissage
-- ===========================================================================
insert into public.parametres_plateforme (cle, valeur, description) values
  ('devises_supportees',
   '["XOF","EUR","USD","GHS","NGN"]'::jsonb,
   'Codes ISO 4217 des devises acceptées à la création d''une organisation'),
  ('pays_villes',
   '{"Côte d''Ivoire":["Abidjan","Bouaké","Yamoussoukro","San-Pédro","Korhogo","Daloa"],"Sénégal":["Dakar","Thiès","Saint-Louis"],"Bénin":["Cotonou","Porto-Novo","Parakou"],"Togo":["Lomé","Sokodé"]}'::jsonb,
   'Villes disponibles par pays (adresses établissements / pharmacies)'),
  ('taux_taxe_par_pays',
   '{"Côte d''Ivoire":0.18,"Sénégal":0.18,"Bénin":0.18,"Togo":0.18,"Ghana":0.15,"Nigeria":0.075}'::jsonb,
   'Taux de taxe sur les primes d''assurance, par pays'),
  ('langues',
   '["fr","en"]'::jsonb,
   'Langues d''interface supportées')
on conflict (cle) do nothing;

insert into public.referentiel_national_actes (code, libelle, categorie, version_nomenclature, statut) values
  ('CI-CONS-GEN',  'Consultation de médecine générale',        'CONSULTATION',    'CI-2026', 'HOMOLOGUE'),
  ('CI-CONS-SPE',  'Consultation de médecine spécialisée',      'CONSULTATION',    'CI-2026', 'HOMOLOGUE'),
  ('CI-ECHO-ABD',  'Échographie abdominale',                    'IMAGERIE',        'CI-2026', 'HOMOLOGUE'),
  ('CI-RADIO-THX', 'Radiographie thoracique',                   'IMAGERIE',        'CI-2026', 'HOMOLOGUE'),
  ('CI-NFS',       'Numération formule sanguine',               'ANALYSES',        'CI-2026', 'HOMOLOGUE'),
  ('CI-GLYC',      'Glycémie à jeun',                           'ANALYSES',        'CI-2026', 'HOMOLOGUE'),
  ('CI-ACCT-NORM', 'Accouchement par voie basse sans complication', 'MATERNITE',   'CI-2026', 'HOMOLOGUE'),
  ('CI-EXTR-DENT', 'Extraction dentaire simple',                'DENTAIRE',        'CI-2026', 'HOMOLOGUE')
on conflict (code) do nothing;

insert into public.referentiel_national_medicaments
  (denomination_commune, forme, dosage, classe_therapeutique, medicament_essentiel,
   generique_disponible, ordonnance_obligatoire, medicament_controle, usage, statut_homologation)
values
  ('Artéméther + Luméfantrine', 'Comprimé', '20 mg / 120 mg', 'Antipaludéen',                 true, true, true,  false, 'AMBULATOIRE', 'HOMOLOGUE'),
  ('Amoxicilline',              'Gélule',   '500 mg',         'Antibiotique (bêta-lactamine)', true, true, true,  false, 'AMBULATOIRE', 'HOMOLOGUE'),
  ('Paracétamol',               'Comprimé', '500 mg',         'Analgésique / antipyrétique',   true, true, false, false, 'AMBULATOIRE', 'HOMOLOGUE'),
  ('Métformine',                'Comprimé', '500 mg',         'Antidiabétique (biguanide)',    true, true, true,  false, 'AMBULATOIRE', 'HOMOLOGUE'),
  ('Amlodipine',                'Comprimé', '5 mg',           'Antihypertenseur (inhibiteur calcique)', true, true, true, false, 'AMBULATOIRE', 'HOMOLOGUE'),
  ('Oméprazole',                'Gélule',   '20 mg',          'Antiulcéreux (IPP)',            true, true, false, false, 'AMBULATOIRE', 'HOMOLOGUE')
on conflict do nothing;
