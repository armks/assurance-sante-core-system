-- ===========================================================================
-- PROMPT 11 — tarification collective : grilles_tarifaires,
-- plan_paiement_collectivite, cotisations.
-- Réf. skill : v9 phase 2.5 / 2.6, v9 §2.2, v14 §7 (pénalités).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================

create table if not exists public.grilles_tarifaires (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  produit_id      uuid not null references public.produits (id) on delete cascade,
  tranche_age_min integer not null check (tranche_age_min >= 0),
  tranche_age_max integer not null check (tranche_age_max >= tranche_age_min),
  -- null = tarif STANDARD du produit ; renseigné = tarif NÉGOCIÉ pour ce souscripteur
  souscripteur_id uuid references public.souscripteurs (id) on delete cascade,
  montant_mensuel numeric(14, 2) not null check (montant_mensuel >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- un seul tarif standard par (produit, tranche) et un seul tarif négocié par
-- (produit, souscripteur, tranche)
create unique index if not exists grilles_standard_unique
  on public.grilles_tarifaires (produit_id, tranche_age_min, tranche_age_max)
  where souscripteur_id is null and deleted_at is null;
create unique index if not exists grilles_negocie_unique
  on public.grilles_tarifaires (produit_id, souscripteur_id, tranche_age_min, tranche_age_max)
  where souscripteur_id is not null and deleted_at is null;
create index if not exists grilles_tarifaires_produit_id_idx      on public.grilles_tarifaires (produit_id);
create index if not exists grilles_tarifaires_souscripteur_id_idx on public.grilles_tarifaires (souscripteur_id);

create table if not exists public.plan_paiement_collectivite (
  id                       uuid primary key default gen_random_uuid(),
  souscripteur_id          uuid not null references public.souscripteurs (id) on delete cascade,
  periodicite              text not null
                             check (periodicite in ('MENSUELLE', 'TRIMESTRIELLE', 'SAISONNIERE', 'ANNUELLE')),
  part_membre_pourcent     numeric(5, 2) not null default 100
                             check (part_membre_pourcent >= 0 and part_membre_pourcent <= 100),
  part_subvention_pourcent numeric(5, 2) not null default 0
                             check (part_subvention_pourcent >= 0 and part_subvention_pourcent <= 100),
  echeances                jsonb,   -- dates personnalisées si SAISONNIERE
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint plan_collectivite_parts_completes
    check (part_membre_pourcent + part_subvention_pourcent = 100)
);

create unique index if not exists plan_collectivite_souscripteur_unique
  on public.plan_paiement_collectivite (souscripteur_id)
  where deleted_at is null;

-- Réservé aux souscripteurs de type COLLECTIVITE (v9 §2.2).
create or replace function public.verifier_souscripteur_collectivite()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type from public.souscripteurs where id = new.souscripteur_id;
  if v_type is distinct from 'COLLECTIVITE' then
    raise exception 'plan_paiement_collectivite : le souscripteur % n''est pas de type COLLECTIVITE (type %)',
      new.souscripteur_id, v_type using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_collectivite_type on public.plan_paiement_collectivite;
create trigger plan_collectivite_type
  before insert or update of souscripteur_id on public.plan_paiement_collectivite
  for each row execute function public.verifier_souscripteur_collectivite();

create table if not exists public.cotisations (
  id                 uuid primary key default gen_random_uuid(),
  police_id          uuid not null references public.polices (id) on delete cascade,
  adherent_id        uuid,   -- cotisation individuelle (FK adherents créée au PROMPT 12)
  societe_id         uuid references public.souscripteurs (id),   -- cotisation collective globale
  periode            date not null,
  montant_du         numeric(14, 2) not null check (montant_du >= 0),
  montant_paye       numeric(14, 2) not null default 0 check (montant_paye >= 0),
  date_echeance      date not null,
  statut             text not null default 'A_PAYER'
                       check (statut in ('A_PAYER', 'PAYEE', 'EN_RETARD', 'ANNULEE')),
  penalite_appliquee numeric(14, 2) not null default 0 check (penalite_appliquee >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  -- exactement une cible : soit un adhérent, soit la société (cotisation globale)
  constraint cotisations_cible_unique
    check ((adherent_id is not null)::int + (societe_id is not null)::int = 1)
);

create index if not exists cotisations_police_id_idx     on public.cotisations (police_id);
create index if not exists cotisations_statut_idx        on public.cotisations (statut);
create index if not exists cotisations_date_echeance_idx on public.cotisations (date_echeance);
create unique index if not exists cotisations_adherent_periode_unique
  on public.cotisations (police_id, adherent_id, periode)
  where adherent_id is not null and deleted_at is null;
create unique index if not exists cotisations_societe_periode_unique
  on public.cotisations (police_id, societe_id, periode)
  where societe_id is not null and deleted_at is null;

-- ===========================================================================
-- RLS — même `profil_a_role()` que les PROMPTs 5 / 8 / 9.
--  - écriture : ASSUREUR_COMPTABLE / ASSUREUR_INFORMATIQUE
--  - lecture : personnel ASSUREUR de l'org OU le souscripteur concerné
-- ===========================================================================
alter table public.grilles_tarifaires        enable row level security;
alter table public.plan_paiement_collectivite enable row level security;
alter table public.cotisations               enable row level security;

-- grilles_tarifaires : tarification interne — lecture = personnel ASSUREUR de l'org
drop policy if exists grilles_tarifaires_lecture on public.grilles_tarifaires;
create policy grilles_tarifaires_lecture on public.grilles_tarifaires
  for select
  using (
    exists (
      select 1 from profils p join sous_roles sr on sr.code = p.role
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = grilles_tarifaires.organisation_id
        and sr.entite_code = 'ASSUREUR'
    )
  );

drop policy if exists grilles_tarifaires_ecriture on public.grilles_tarifaires;
create policy grilles_tarifaires_ecriture on public.grilles_tarifaires
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']));

-- plan_paiement_collectivite : lecture = ASSUREUR de l'org du souscripteur OU le souscripteur lui-même
drop policy if exists plan_collectivite_lecture on public.plan_paiement_collectivite;
create policy plan_collectivite_lecture on public.plan_paiement_collectivite
  for select
  using (
    exists (
      select 1 from souscripteurs s
      join profils p on p.organisation_id = s.organisation_id
      join sous_roles sr on sr.code = p.role
      where s.id = plan_paiement_collectivite.souscripteur_id
        and p.id = auth.uid() and p.deleted_at is null
        and sr.entite_code = 'ASSUREUR'
    )
    or plan_paiement_collectivite.souscripteur_id = (
      select societe_id from profils where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists plan_collectivite_ecriture on public.plan_paiement_collectivite;
create policy plan_collectivite_ecriture on public.plan_paiement_collectivite
  for all
  using (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = plan_paiement_collectivite.souscripteur_id),
      array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']
    )
  )
  with check (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = plan_paiement_collectivite.souscripteur_id),
      array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']
    )
  );

-- cotisations : lecture élargie au souscripteur concerné (comme les polices)
drop policy if exists cotisations_lecture on public.cotisations;
create policy cotisations_lecture on public.cotisations
  for select
  using (
    exists (
      select 1 from polices pol
      where pol.id = cotisations.police_id
        and (
          exists (
            select 1 from profils p join sous_roles sr on sr.code = p.role
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

drop policy if exists cotisations_ecriture on public.cotisations;
create policy cotisations_ecriture on public.cotisations
  for all
  using (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = cotisations.police_id),
      array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']
    )
  )
  with check (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = cotisations.police_id),
      array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']
    )
  );
