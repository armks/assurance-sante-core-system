-- ===========================================================================
-- PROMPT 8 — produits (versionnés) + garanties
-- Réf. skill : v9 phase 2.1 / v3 §2 — une police référence toujours une VERSION
-- FIGÉE d'un produit, jamais « la version courante ». Une version PUBLIE est
-- immuable : toute évolution crée une nouvelle version (BROUILLON).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================

create table if not exists public.produits (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  nom              text not null,
  version          integer not null default 1 check (version >= 1),
  statut           text not null default 'BROUILLON'
                     check (statut in ('BROUILLON', 'PUBLIE', 'ARCHIVE')),
  date_publication timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint produits_org_nom_version_unique unique (organisation_id, nom, version),
  -- BROUILLON => pas de date ; PUBLIE => date obligatoire ; ARCHIVE => libre
  -- (un produit archivé conserve la date_publication qu'il avait)
  constraint produits_statut_date_coherente check (
    (statut = 'BROUILLON' and date_publication is null)
    or (statut = 'PUBLIE' and date_publication is not null)
    or statut = 'ARCHIVE'
  )
);

create index if not exists produits_organisation_id_idx on public.produits (organisation_id);
create index if not exists produits_org_nom_idx         on public.produits (organisation_id, nom);
create index if not exists produits_statut_idx          on public.produits (statut);
create index if not exists produits_deleted_at_idx      on public.produits (deleted_at);

create table if not exists public.garanties (
  id                  uuid primary key default gen_random_uuid(),
  produit_id          uuid not null references public.produits (id) on delete cascade,
  categorie_acte      text not null,   -- CONSULTATION, HOSPITALISATION, PHARMACIE, OPTIQUE, DENTAIRE...
  taux_couverture     numeric(5, 2)  check (taux_couverture   is null or (taux_couverture   >= 0 and taux_couverture   <= 100)),
  plafond_par_acte    numeric(14, 2) check (plafond_par_acte  is null or plafond_par_acte  >= 0),
  plafond_annuel      numeric(14, 2) check (plafond_annuel    is null or plafond_annuel    >= 0),
  franchise           numeric(14, 2) check (franchise         is null or franchise         >= 0),
  ticket_moderateur   numeric(5, 2)  check (ticket_moderateur is null or (ticket_moderateur >= 0 and ticket_moderateur <= 100)),
  delai_carence_jours integer        check (delai_carence_jours is null or delai_carence_jours >= 0),
  reseau_soins        text not null default 'TOUT_RESEAU'
                        check (reseau_soins in ('CONVENTIONNE_SEUL', 'TOUT_RESEAU')),
  exclusions          text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists garanties_produit_id_idx on public.garanties (produit_id);

-- ===========================================================================
-- Autorisation : même pattern que PROMPT 5 (peut_creer_role) — une fonction
-- SECURITY DEFINER qui résout le rôle de auth.uid() + son parent (héritage
-- adjoint, v6 §3) et teste l'appartenance à une liste, dans la même organisation.
-- ===========================================================================
create or replace function public.profil_a_role(
  p_organisation_id uuid,
  p_roles           text[]
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_org  uuid;
begin
  select role, organisation_id into v_role, v_org
  from profils
  where id = auth.uid() and deleted_at is null;

  if v_role is null or p_organisation_id is null or p_organisation_id <> v_org then
    return false;
  end if;

  return exists (
    select 1
    from (
      select v_role as code
      union
      select role_parent_code from sous_roles
      where code = v_role and role_parent_code is not null
    ) mes_roles
    where mes_roles.code = any (p_roles)
  );
end;
$$;

-- ===========================================================================
-- RLS
--  - produits/garanties : lecture par TOUTE personne de l'organisation
--    (les produits PUBLIE doivent être largement visibles pour la souscription)
--  - écriture réservée à ASSUREUR_DIRECTION / ASSUREUR_INFORMATIQUE
--  - garanties : écriture bloquée si le produit n'est plus BROUILLON
--    (défense en profondeur ; PlanService applique aussi la règle)
-- NB : NestJS passe par le rôle `postgres` (pooler) et contourne la RLS.
-- ===========================================================================
alter table public.produits  enable row level security;
alter table public.garanties enable row level security;

drop policy if exists produits_lecture on public.produits;
create policy produits_lecture on public.produits
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists produits_ecriture on public.produits;
create policy produits_ecriture on public.produits
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']));

drop policy if exists garanties_lecture on public.garanties;
create policy garanties_lecture on public.garanties
  for select
  using (
    exists (
      select 1 from produits p
      where p.id = garanties.produit_id
        and p.organisation_id = (
          select organisation_id from profils
          where id = auth.uid() and deleted_at is null
        )
    )
  );

drop policy if exists garanties_ecriture on public.garanties;
create policy garanties_ecriture on public.garanties
  for all
  using (
    public.profil_a_role(
      (select organisation_id from produits p where p.id = garanties.produit_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']
    )
    and (select statut from produits p where p.id = garanties.produit_id) = 'BROUILLON'
  )
  with check (
    public.profil_a_role(
      (select organisation_id from produits p where p.id = garanties.produit_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE']
    )
    and (select statut from produits p where p.id = garanties.produit_id) = 'BROUILLON'
  );
