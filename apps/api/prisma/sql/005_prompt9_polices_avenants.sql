-- ===========================================================================
-- PROMPT 9 — polices (machine à états) + avenants
-- Réf. skill : v9 phase 2.2 / v3 §3.
--
-- Une police référence OBLIGATOIREMENT un produit au statut PUBLIE (jamais
-- BROUILLON ni ARCHIVE) — vérifié par un trigger + par PolicyService.
-- Machine à états stricte (voir PolicyService.TRANSITIONS) : toute transition
-- non listée est refusée.
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================

create sequence if not exists public.polices_numero_seq;

create table if not exists public.polices (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  souscripteur_id uuid not null references public.souscripteurs (id),
  produit_id      uuid not null references public.produits (id),
  numero_police   text not null unique
                    default ('POL-' || to_char(now(), 'YYYY') || '-'
                             || lpad(nextval('public.polices_numero_seq')::text, 6, '0')),
  date_debut      date,
  date_fin        date,
  statut          text not null default 'DEVIS'
                    check (statut in ('DEVIS', 'EN_SOUSCRIPTION', 'ACTIVE',
                                      'SUSPENDUE', 'RENOUVELEE', 'RESILIEE',
                                      'NON_RENOUVELEE')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint polices_periode_coherente
    check (date_debut is null or date_fin is null or date_fin >= date_debut)
);

create index if not exists polices_organisation_id_idx on public.polices (organisation_id);
create index if not exists polices_souscripteur_id_idx on public.polices (souscripteur_id);
create index if not exists polices_produit_id_idx      on public.polices (produit_id);
create index if not exists polices_statut_idx          on public.polices (statut);
create index if not exists polices_deleted_at_idx      on public.polices (deleted_at);

-- Une police doit référencer un produit PUBLIE (défense en profondeur).
create or replace function public.verifier_produit_police_publie()
returns trigger
language plpgsql
as $$
declare
  v_statut text;
begin
  select statut into v_statut from public.produits where id = new.produit_id;
  if v_statut is null then
    raise exception 'Produit % introuvable', new.produit_id using errcode = '23503';
  end if;
  if v_statut <> 'PUBLIE' then
    raise exception 'Une police doit référencer un produit PUBLIE (produit % : statut %)',
      new.produit_id, v_statut using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists polices_produit_publie on public.polices;
create trigger polices_produit_publie
  before insert or update of produit_id on public.polices
  for each row execute function public.verifier_produit_police_publie();

create table if not exists public.avenants (
  id                      uuid primary key default gen_random_uuid(),
  police_id               uuid not null references public.polices (id) on delete cascade,
  type                    text not null
                            check (type in ('AJOUT_ADHERENT', 'RADIATION_ADHERENT',
                                            'CHANGEMENT_FORMULE', 'AJOUT_BENEFICIAIRE',
                                            'MODIFICATION_TARIFAIRE', 'RESILIATION')),
  date_effet              date not null,
  date_creation           timestamptz not null default now(),
  cree_par                uuid references public.profils (id),
  proratisation_appliquee boolean not null default false,
  impact_cotisation       numeric(14, 2),
  statut                  text not null default 'BROUILLON'
                            check (statut in ('BROUILLON', 'APPLIQUE', 'ANNULE')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create index if not exists avenants_police_id_idx on public.avenants (police_id);
create index if not exists avenants_statut_idx    on public.avenants (statut);

-- ===========================================================================
-- RLS — même pattern profil_a_role() que les PROMPTs 5 / 8.
--  - lecture : personnel ASSUREUR de l'organisation OU le souscripteur concerné
--    lui-même (profils.societe_id = polices.souscripteur_id)
--  - écriture : ASSUREUR_DIRECTION / ASSUREUR_EXPLOITATION / ASSUREUR_INFORMATIQUE
-- NB : NestJS passe par le rôle `postgres` (pooler) et contourne la RLS ;
-- PolicyService applique les mêmes règles.
-- ===========================================================================
alter table public.polices  enable row level security;
alter table public.avenants enable row level security;

drop policy if exists polices_lecture on public.polices;
create policy polices_lecture on public.polices
  for select
  using (
    exists (
      select 1 from profils p
      join sous_roles sr on sr.code = p.role
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = polices.organisation_id
        and sr.entite_code = 'ASSUREUR'
    )
    or polices.souscripteur_id = (
      select societe_id from profils where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists polices_ecriture on public.polices;
create policy polices_ecriture on public.polices
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']));

drop policy if exists avenants_lecture on public.avenants;
create policy avenants_lecture on public.avenants
  for select
  using (
    exists (
      select 1 from polices pol
      where pol.id = avenants.police_id
        and (
          exists (
            select 1 from profils p
            join sous_roles sr on sr.code = p.role
            where p.id = auth.uid() and p.deleted_at is null
              and p.organisation_id = pol.organisation_id
              and sr.entite_code = 'ASSUREUR'
          )
          or pol.souscripteur_id = (
            select societe_id from profils where id = auth.uid() and deleted_at is null
          )
        )
    )
  );

drop policy if exists avenants_ecriture on public.avenants;
create policy avenants_ecriture on public.avenants
  for all
  using (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = avenants.police_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']
    )
  )
  with check (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = avenants.police_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']
    )
  );
