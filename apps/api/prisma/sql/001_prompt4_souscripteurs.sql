-- ===========================================================================
-- PROMPT 4 — souscripteurs + membres_comite_gestion
-- Réf. skill : 01-plan-directeur-v9.md §1.2 (table souscripteurs unifiée,
--              societes_clientes abandonnée) et §1.3 (gouvernance des
--              collectivités par comité, plusieurs SOCIETE_ADMINISTRATION
--              possibles par souscripteur).
--
-- Ce projet n'utilise pas `prisma migrate` (schéma synchronisé par `db pull`).
-- Ce fichier est le TRACE de ce qui a été appliqué en base, à conserver.
-- Appliqué le 2026-09-06 via `prisma db execute`.
-- ===========================================================================

-- --- Table souscripteurs ---------------------------------------------------
create table if not exists public.souscripteurs (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id),
  type                     text not null
                             check (type in ('ENTREPRISE', 'COLLECTIVITE', 'INDIVIDUEL')),
  nom                      text not null,

  -- segment ENTREPRISE
  secteur_activite         text,
  effectif_declare         integer check (effectif_declare is null or effectif_declare >= 0),

  -- segment COLLECTIVITE
  type_collectivite        text,
  organe_gouvernance       text,
  subvention_externe       boolean not null default false,
  bailleur_subvention      text,

  -- segment INDIVIDUEL
  numero_piece_identite    text,
  questionnaire_medical_id uuid,   -- FK logique vers questionnaires_medicaux (PROMPT 10)

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);

comment on column public.souscripteurs.questionnaire_medical_id is
  'FK logique vers questionnaires_medicaux (table créée au PROMPT 10). Pas de contrainte FK tant que la table cible n''existe pas.';

create index if not exists souscripteurs_organisation_id_idx on public.souscripteurs (organisation_id);
create index if not exists souscripteurs_type_idx            on public.souscripteurs (type);
create index if not exists souscripteurs_deleted_at_idx      on public.souscripteurs (deleted_at);

-- --- Table membres_comite_gestion ----------------------------------------
create table if not exists public.membres_comite_gestion (
  id                uuid primary key default gen_random_uuid(),
  souscripteur_id   uuid not null references public.souscripteurs (id) on delete cascade,
  user_id           uuid not null references public.profils (id),
  fonction          text not null,   -- Président, Trésorier, Secrétaire, ...
  date_debut_mandat date not null default current_date,
  date_fin_mandat   date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint membres_comite_gestion_mandat_coherent
    check (date_fin_mandat is null or date_fin_mandat >= date_debut_mandat)
);

create index if not exists membres_comite_gestion_souscripteur_id_idx on public.membres_comite_gestion (souscripteur_id);
create index if not exists membres_comite_gestion_user_id_idx         on public.membres_comite_gestion (user_id);

-- un même user ne peut détenir qu'un seul mandat actif sur le même souscripteur
create unique index if not exists membres_comite_gestion_actif_unique
  on public.membres_comite_gestion (souscripteur_id, user_id)
  where deleted_at is null and date_fin_mandat is null;

-- ===========================================================================
-- RLS — défense en profondeur (v9 règles transverses ; le guard NestJS + la
-- vérification applicative restent en place, jamais l'un sans l'autre).
-- NB : NestJS se connecte via le rôle `postgres` (pooler) et CONTOURNE la RLS ;
-- ces policies protègent l'accès direct au client Supabase (frontend, JWT
-- `authenticated`). L'enforcement pour le chemin NestJS est dans TenantService.
-- ===========================================================================
alter table public.souscripteurs           enable row level security;
alter table public.membres_comite_gestion  enable row level security;

-- Lecture : tout profil de l'entité ASSUREUR, dans la même organisation.
drop policy if exists souscripteurs_select on public.souscripteurs;
create policy souscripteurs_select on public.souscripteurs
  for select
  using (
    exists (
      select 1
      from public.profils p
      join public.sous_roles sr on sr.code = p.role
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id = souscripteurs.organisation_id
        and sr.entite_code = 'ASSUREUR'
    )
  );

-- Écriture : rôles de gestion (direction / exploitation / informatique), même
-- organisation. coalesce(role_parent_code, code) => le rôle adjoint hérite.
drop policy if exists souscripteurs_modif on public.souscripteurs;
create policy souscripteurs_modif on public.souscripteurs
  for all
  using (
    exists (
      select 1
      from public.profils p
      join public.sous_roles sr on sr.code = p.role
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id = souscripteurs.organisation_id
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE')
    )
  )
  with check (
    exists (
      select 1
      from public.profils p
      join public.sous_roles sr on sr.code = p.role
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id = souscripteurs.organisation_id
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE')
    )
  );

-- membres_comite_gestion : accès aligné sur la visibilité du souscripteur parent.
drop policy if exists membres_comite_select on public.membres_comite_gestion;
create policy membres_comite_select on public.membres_comite_gestion
  for select
  using (
    exists (
      select 1
      from public.souscripteurs s
      join public.profils p    on p.organisation_id = s.organisation_id
      join public.sous_roles sr on sr.code = p.role
      where s.id = membres_comite_gestion.souscripteur_id
        and p.id = auth.uid()
        and p.deleted_at is null
        and sr.entite_code = 'ASSUREUR'
    )
  );

drop policy if exists membres_comite_modif on public.membres_comite_gestion;
create policy membres_comite_modif on public.membres_comite_gestion
  for all
  using (
    exists (
      select 1
      from public.souscripteurs s
      join public.profils p    on p.organisation_id = s.organisation_id
      join public.sous_roles sr on sr.code = p.role
      where s.id = membres_comite_gestion.souscripteur_id
        and p.id = auth.uid()
        and p.deleted_at is null
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE')
    )
  )
  with check (
    exists (
      select 1
      from public.souscripteurs s
      join public.profils p    on p.organisation_id = s.organisation_id
      join public.sous_roles sr on sr.code = p.role
      where s.id = membres_comite_gestion.souscripteur_id
        and p.id = auth.uid()
        and p.deleted_at is null
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE')
    )
  );
