-- ===========================================================================
-- PROMPT 5 — regles_provisioning + policies RLS INSERT sur profils
-- Réf. skill : 01-plan-directeur-v9.md §1.4 (rôle ASSUREUR_MEDECIN_SOUSCRIPTEUR
--              + règle de provisioning) et §1.5 (délégation pharmacien → caissière
--              avec scope pharmacie_id, PAS etablissement_id), v6 §4.
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
--
-- Interprétation retenue pour "ASSUREUR_INFORMATIQUE crée tous les autres comptes
-- PHARMACIE" : PHARMACIE_PHARMACIEN et PHARMACIE_COMPTABLE en création directe ;
-- PHARMACIE_CAISSIERE UNIQUEMENT par la voie PROPOSITION + validation (c'est la
-- raison d'être de la délégation, v7 / v9 §1.5). Ajouter une règle directe
-- ASSUREUR_INFORMATIQUE → PHARMACIE_CAISSIERE si un besoin apparaît.
-- ===========================================================================

create table if not exists public.regles_provisioning (
  id              uuid primary key default gen_random_uuid(),
  role_createur   text not null references public.sous_roles (code),
  role_cree       text not null references public.sous_roles (code),
  scope_verifie   text
                    check (scope_verifie is null
                           or scope_verifie in ('organisation_id', 'pharmacie_id', 'etablissement_id')),
  mode            text not null default 'CREATION_DIRECTE'
                    check (mode in ('CREATION_DIRECTE', 'PROPOSITION')),
  role_validateur text references public.sous_roles (code),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint regles_provisioning_unique unique (role_createur, role_cree),
  -- un validateur est requis si et seulement si mode = PROPOSITION
  constraint regles_provisioning_validateur_coherent
    check ((mode = 'PROPOSITION') = (role_validateur is not null))
);

create index if not exists regles_provisioning_role_createur_idx on public.regles_provisioning (role_createur);
create index if not exists regles_provisioning_role_cree_idx     on public.regles_provisioning (role_cree);

-- --- Données exactes (v9 §1.4 / §1.5) -----------------------------------------
insert into public.regles_provisioning (role_createur, role_cree, scope_verifie, mode, role_validateur) values
  -- SUPERADMIN_PRINCIPAL : création directe, AUCUN scope (cross-organisation)
  ('SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN', null, 'CREATION_DIRECTE', null),
  ('SUPERADMIN_PRINCIPAL', 'ASSUREUR_DIRECTION',           null, 'CREATION_DIRECTE', null),
  ('SUPERADMIN_PRINCIPAL', 'ASSUREUR_INFORMATIQUE',        null, 'CREATION_DIRECTE', null),

  -- ASSUREUR_INFORMATIQUE : création directe, scope organisation_id
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_INFORMATIQUE_ADJOINT',   'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE',              'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE_ADJOINT',      'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION',           'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION_CONJOINTE', 'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL',        'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_SOUSCRIPTEUR',   'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_PHARMACIEN_CONSEIL',     'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'PHARMACIE_PHARMACIEN',            'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'PHARMACIE_COMPTABLE',             'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'CENTRE_MEDICAL_MEDECIN',          'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'CENTRE_MEDICAL_COMPTABLE',        'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'CENTRE_MEDICAL_ACCUEIL',          'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'CENTRE_MEDICAL_ADMINISTRATIF',    'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'SOCIETE_ASSUREE',                 'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'SOCIETE_COMPTABLE',               'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'SOCIETE_RECEPTION',               'organisation_id', 'CREATION_DIRECTE', null),
  ('ASSUREUR_INFORMATIQUE', 'SOCIETE_ADMINISTRATION',          'organisation_id', 'CREATION_DIRECTE', null),

  -- Délégation contrôlée pharmacien → caissière : PROPOSITION, scope pharmacie_id,
  -- validée par ASSUREUR_INFORMATIQUE (v9 §1.5 — pharmacie_id, PAS etablissement_id)
  ('PHARMACIE_PHARMACIEN', 'PHARMACIE_CAISSIERE', 'pharmacie_id', 'PROPOSITION', 'ASSUREUR_INFORMATIQUE')
on conflict (role_createur, role_cree) do nothing;

-- --- RLS sur regles_provisioning : lecture publique (règles non sensibles),
--     écriture réservée à postgres / service_role -----------------------------
alter table public.regles_provisioning enable row level security;
drop policy if exists regles_provisioning_lecture on public.regles_provisioning;
create policy regles_provisioning_lecture on public.regles_provisioning
  for select using (true);

-- ===========================================================================
-- Fonction d'autorisation de provisioning + policy RLS INSERT sur profils.
-- La policy applique regles_provisioning DYNAMIQUEMENT : le formulaire de
-- création (alimenté par GET /identity/roles-proposables) ne proposera jamais
-- un rôle que cette policy refuserait ensuite.
--
-- SECURITY DEFINER : la fonction lit profils / regles_provisioning / sous_roles
-- indépendamment de la RLS du chemin appelant.
-- ===========================================================================
create or replace function public.peut_creer_role(
  p_role_cree       text,
  p_organisation_id uuid,
  p_pharmacie_id    uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role            text;
  v_organisation_id uuid;
  v_pharmacie_id    uuid;
begin
  select role, organisation_id, pharmacie_id
    into v_role, v_organisation_id, v_pharmacie_id
  from profils
  where id = auth.uid() and deleted_at is null;

  if v_role is null then
    return false;
  end if;

  return exists (
    select 1
    from regles_provisioning rp
    where rp.deleted_at is null
      and rp.mode = 'CREATION_DIRECTE'
      and rp.role_cree = p_role_cree
      and rp.role_createur in (
        -- rôle propre + rôle parent (héritage adjoint, v6 §3)
        select v_role
        union
        select role_parent_code from sous_roles
        where code = v_role and role_parent_code is not null
      )
      and (
        rp.scope_verifie is null
        or (rp.scope_verifie = 'organisation_id'
            and p_organisation_id is not null and p_organisation_id = v_organisation_id)
        or (rp.scope_verifie = 'pharmacie_id'
            and p_pharmacie_id is not null and p_pharmacie_id = v_pharmacie_id)
      )
  );
end;
$$;

alter table public.profils enable row level security;

drop policy if exists profils_insert_provisioning on public.profils;
create policy profils_insert_provisioning on public.profils
  for insert
  to authenticated
  with check (
    role is not null
    and public.peut_creer_role(role, organisation_id, pharmacie_id)
  );
