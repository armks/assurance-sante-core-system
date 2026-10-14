-- 094 — Logos des partenaires de chaque société d'assurance, affichés en bandeau défilant juste après la bannière de SA page d'accueil
-- (module NestJS `vitrine`). Gestion : ASSUREUR_INFORMATIQUE de l'organisation, EXCLUSIVEMENT (rôle exact) — NestJS vérifie, la RLS double.
-- Lecture publique : logos actifs et non supprimés, soit de l'organisation vitrine (page principale), soit — via l'API qui résout le
-- slug — de la société de la page /{slug}. Images dans le bucket PUBLIC `evenements` (sous `{organisation}/partenaires/…`), écrites
-- uniquement par NestJS (service_role). Idempotente.
create table if not exists public.partenaires_vitrine (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id),
  nom              text not null,
  logo_url         text not null,
  site_url         text,
  ordre_affichage  integer not null default 0,
  actif            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint partenaires_vitrine_nom_longueur check (char_length(nom) between 2 and 120),
  constraint partenaires_vitrine_site_forme check (site_url is null or (char_length(site_url) <= 300 and site_url ~* '^https?://')),
  constraint partenaires_vitrine_ordre_positif check (ordre_affichage >= 0)
);

create index if not exists partenaires_vitrine_organisation_actifs
  on public.partenaires_vitrine (organisation_id, ordre_affichage, created_at)
  where deleted_at is null;

alter table public.partenaires_vitrine enable row level security;

drop policy if exists partenaires_vitrine_lecture_publique on public.partenaires_vitrine;
create policy partenaires_vitrine_lecture_publique on public.partenaires_vitrine
  for select
  to anon, authenticated
  using (actif and deleted_at is null and organisation_id = public.organisation_vitrine());

drop policy if exists partenaires_vitrine_lecture_organisation on public.partenaires_vitrine;
create policy partenaires_vitrine_lecture_organisation on public.partenaires_vitrine
  for select
  to authenticated
  using (
    organisation_id = (
      select organisation_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists partenaires_vitrine_ecriture on public.partenaires_vitrine;
create policy partenaires_vitrine_ecriture on public.partenaires_vitrine
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

grant select on public.partenaires_vitrine to anon;
