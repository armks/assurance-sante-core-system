-- ===========================================================================
-- PROMPT 14 — Réseau de soins : etablissements_sante + pharmacies
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 14 », v9 phase 4.1
--              (v1 §9), §1.1 (le nom de table physique reste `etablissements_sante`,
--              entité d'affichage = CENTRE_MEDICAL), §2.2 (l'Informatique gère
--              aussi le réseau de prestataires).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
--
-- Géolocalisation : latitude / longitude en double precision, recherche par
-- rayon calculée côté NestJS (Haversine) — pas de PostGIS à ce stade.
-- ===========================================================================

create table if not exists public.etablissements_sante (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id),
  nom                 text not null,
  code                text not null unique,
  type_etablissement  text not null check (type_etablissement in (
                        'HOPITAL_PUBLIC', 'CLINIQUE_PRIVEE', 'CABINET_MEDICAL',
                        'CENTRE_SANTE', 'LABORATOIRE', 'CENTRE_IMAGERIE',
                        'OPTICIEN', 'DENTISTE', 'MATERNITE')),
  pays                text not null default 'Côte d''Ivoire',
  ville               text,
  commune             text,
  quartier            text,
  adresse_complete    text,
  latitude            double precision check (latitude  is null or (latitude  between -90  and 90)),
  longitude           double precision check (longitude is null or (longitude between -180 and 180)),
  telephone           text,
  telephone_urgence   text,
  email               text,
  statut              text not null default 'EN_ATTENTE_VALIDATION'
                        check (statut in ('ACTIF', 'SUSPENDU', 'EN_ATTENTE_VALIDATION', 'RESILIE')),
  date_convention     date,
  date_fin_convention date,
  garde_weekend       boolean not null default false,
  horaires_garde      jsonb,
  horaires_semaine    jsonb,
  tiers_payant        boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists etablissements_sante_organisation_id_idx on public.etablissements_sante (organisation_id);
create index if not exists etablissements_sante_statut_idx          on public.etablissements_sante (statut);
create index if not exists etablissements_sante_type_idx            on public.etablissements_sante (type_etablissement);
create index if not exists etablissements_sante_ville_idx           on public.etablissements_sante (lower(ville));
create index if not exists etablissements_sante_geo_idx             on public.etablissements_sante (latitude, longitude);

create table if not exists public.pharmacies (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id),
  nom                 text not null,
  code                text not null unique,
  pays                text not null default 'Côte d''Ivoire',
  ville               text,
  commune             text,
  quartier            text,
  adresse_complete    text,
  latitude            double precision check (latitude  is null or (latitude  between -90  and 90)),
  longitude           double precision check (longitude is null or (longitude between -180 and 180)),
  telephone           text,
  email               text,
  statut              text not null default 'ACTIVE'
                        check (statut in ('ACTIVE', 'SUSPENDUE', 'RESILIEE')),
  garde_weekend       boolean not null default false,
  horaires_garde      jsonb,
  tiers_payant        boolean not null default true,
  date_convention     date,
  date_fin_convention date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists pharmacies_organisation_id_idx on public.pharmacies (organisation_id);
create index if not exists pharmacies_statut_idx          on public.pharmacies (statut);
create index if not exists pharmacies_ville_idx           on public.pharmacies (lower(ville));
create index if not exists pharmacies_geo_idx             on public.pharmacies (latitude, longitude);

-- ===========================================================================
-- RLS — même pattern que le PROMPT 8 (profil_a_role, prisma/sql/004) :
--  - écriture réservée à ASSUREUR_INFORMATIQUE (v9 §2.2 — l'Informatique gère
--    aussi le réseau de prestataires ; cohérent avec regles_provisioning) ;
--  - lecture ouverte à toute personne de l'organisation.
-- Lecture publique LIMITÉE : via des vues dédiées (colonnes réduites, seuls les
-- établissements/pharmacies actifs), pour la future recherche par les adhérents.
-- NB : NestJS passe par le rôle `postgres` (pooler) et contourne la RLS —
-- ProviderService applique la même règle (défense en profondeur).
-- ===========================================================================
alter table public.etablissements_sante enable row level security;
alter table public.pharmacies           enable row level security;

drop policy if exists etablissements_sante_lecture on public.etablissements_sante;
create policy etablissements_sante_lecture on public.etablissements_sante
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists etablissements_sante_ecriture on public.etablissements_sante;
create policy etablissements_sante_ecriture on public.etablissements_sante
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

drop policy if exists pharmacies_lecture on public.pharmacies;
create policy pharmacies_lecture on public.pharmacies
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists pharmacies_ecriture on public.pharmacies;
create policy pharmacies_ecriture on public.pharmacies
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

-- --- Vues publiques limitées (recherche adhérent, PROMPT ultérieur) ----------
-- SECURITY INVOKER par défaut à false → la vue s'exécute avec les droits du
-- propriétaire (postgres) : elle contourne la RLS de la table de base mais
-- n'expose QUE les colonnes ci-dessous, et seulement les lignes actives.
create or replace view public.etablissements_sante_public as
  select id, nom, ville, commune, type_etablissement, statut, garde_weekend,
         latitude, longitude
  from public.etablissements_sante
  where statut = 'ACTIF' and deleted_at is null;

create or replace view public.pharmacies_public as
  select id, nom, ville, commune, statut, garde_weekend, latitude, longitude
  from public.pharmacies
  where statut = 'ACTIVE' and deleted_at is null;

grant select on public.etablissements_sante_public to anon, authenticated;
grant select on public.pharmacies_public           to anon, authenticated;
