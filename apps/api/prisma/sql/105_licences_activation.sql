-- Module d'activation des licences : type de licence (essai, mensuelle, trimestrielle, semestrielle, annuelle, biennale), statut
-- « en attente d'activation » et codes d'activation temporaires (24 h) générés par le superadmin, stockés hachés + chiffrés.
alter table public.licences_organisation add column if not exists type_licence text not null default 'ANNUELLE';

alter table public.licences_organisation drop constraint if exists licences_organisation_type_licence_check;
alter table public.licences_organisation
  add constraint licences_organisation_type_licence_check
  check (type_licence in ('ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE'));

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.licences_organisation'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'EXPIREE'
  loop
    execute format('alter table public.licences_organisation drop constraint %I', c);
  end loop;
end $$;
alter table public.licences_organisation
  add constraint licences_organisation_statut_check
  check (statut in ('ACTIVE', 'SUSPENDUE', 'EXPIREE', 'EN_ATTENTE_ACTIVATION'));

-- les organisations existantes sans licence reçoivent une licence annuelle active (aucune coupure d'accès à la mise en service du module)
insert into public.licences_organisation (organisation_id, plan, type_licence, date_debut, date_fin, statut)
select o.id, 'BUSINESS', 'ANNUELLE', current_date, (current_date + interval '1 year')::date, 'ACTIVE'
from public.organisations o
where not exists (select 1 from public.licences_organisation l where l.organisation_id = o.id);

create table if not exists public.codes_activation_licence (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  type_licence     text not null check (type_licence in ('ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE')),
  -- empreinte HMAC du code ; la version lisible est chiffrée dans code_chiffre (common/codes-secrets.ts)
  code             text not null unique check (code ~ '^[A-Z0-9]{6,64}$'),
  code_chiffre     text,
  genere_par       uuid not null references public.profils (id),
  date_generation  timestamptz not null default now(),
  date_expiration  timestamptz not null default (now() + interval '24 hours'),
  statut           text not null default 'EMIS' check (statut in ('EMIS', 'ACTIVE', 'EXPIRE', 'ANNULE')),
  active_par       uuid references public.profils (id),
  date_activation  timestamptz,
  created_at       timestamptz not null default now(),
  check ((statut = 'ACTIVE') = (date_activation is not null))
);
create index if not exists codes_activation_licence_org_idx on public.codes_activation_licence (organisation_id, statut);

-- aucune lecture directe via PostgREST : l'accès passe uniquement par l'API (rôle propriétaire)
alter table public.codes_activation_licence enable row level security;
