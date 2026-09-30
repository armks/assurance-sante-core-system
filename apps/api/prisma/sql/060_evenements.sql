-- ===========================================================================
-- Événements de l'assureur, affichés en carrousel dans le bloc « Qui
-- sommes-nous » de la page d'accueil publique (module NestJS `vitrine`).
--
-- Gestion : ASSUREUR_INFORMATIQUE de l'organisation, EXCLUSIVEMENT (rôle exact,
-- pas ASSUREUR_INFORMATIQUE_ADJOINT) — NestJS vérifie, la RLS double.
--
-- Statut PASSE / A_VENIR : CALCULÉ à la lecture (date_evenement vs date du
-- jour), jamais stocké — une colonne stockée deviendrait fausse le lendemain.
--
-- Lecture publique : événements actifs, non supprimés, de L'organisation
-- vitrine uniquement. Côté API, cette organisation vient de la variable
-- d'environnement VITRINE_ORGANISATION_ID ; côté RLS (accès direct `anon`
-- via l'API de données Supabase), de parametres_plateforme
-- cle = 'vitrine_organisation_id' (valeur JSON : "uuid"). Les deux doivent
-- désigner la même organisation. Absente ou invalide → aucune ligne publique
-- (pas de fuite multi-tenant par défaut).
-- ===========================================================================

create table if not exists public.evenements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id),
  titre            text not null,
  description      text,
  image_url        text not null,
  date_evenement   date not null,
  ordre_affichage  integer not null default 0,
  actif            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint evenements_titre_longueur check (char_length(titre) between 2 and 150),
  constraint evenements_description_longueur check (description is null or char_length(description) <= 1000),
  constraint evenements_ordre_positif check (ordre_affichage >= 0)
);

create index if not exists evenements_organisation_actifs
  on public.evenements (organisation_id, ordre_affichage, date_evenement)
  where deleted_at is null;

alter table public.evenements enable row level security;

-- Organisation vitrine, lisible par la policy publique sans ouvrir
-- parametres_plateforme (réservé SUPERADMIN_PRINCIPAL) : SECURITY DEFINER.
create or replace function public.organisation_vitrine()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
           when valeur #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (valeur #>> '{}')::uuid
         end
  from public.parametres_plateforme
  where cle = 'vitrine_organisation_id'
$$;

revoke all on function public.organisation_vitrine() from public;
grant execute on function public.organisation_vitrine() to anon, authenticated;

drop policy if exists evenements_lecture_publique on public.evenements;
create policy evenements_lecture_publique on public.evenements
  for select
  to anon, authenticated
  using (
    actif
    and deleted_at is null
    and organisation_id = public.organisation_vitrine()
  );

drop policy if exists evenements_lecture_organisation on public.evenements;
create policy evenements_lecture_organisation on public.evenements
  for select
  to authenticated
  using (
    organisation_id = (
      select organisation_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists evenements_ecriture on public.evenements;
create policy evenements_ecriture on public.evenements
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

grant select on public.evenements to anon;

-- Bucket PUBLIC en lecture (images affichées sur la page d'accueil). Écriture
-- uniquement par NestJS (service_role) : aucune policy d'écriture storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evenements', 'evenements', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
