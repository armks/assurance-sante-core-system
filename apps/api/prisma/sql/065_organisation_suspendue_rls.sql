-- ===========================================================================
-- Correctif de sécurité : un utilisateur d'une organisation SUSPENDUE (ou
-- ARCHIVEE / supprimée) ne doit plus rien pouvoir lire ni écrire.
--
-- Côté API, IdentityService.getMe refuse désormais toute requête authentifiée
-- d'un tel compte (403 ORGANISATION_SUSPENDUE). Ce fichier couvre l'accès
-- DIRECT à Postgres avec le JWT de l'utilisateur (PostgREST / supabase-js) :
-- les policies RLS ne donnent effectivement accès qu'au travers de ces trois
-- fonctions SECURITY DEFINER (la table `profils` n'a aucune policy SELECT, les
-- sous-requêtes « exists (… from profils where id = auth.uid()) » des autres
-- policies ne voient donc aucune ligne pour un client). Elles renvoient
-- maintenant `false` dès que l'organisation de l'appelant n'est pas ACTIVE.
-- Corps inchangés par ailleurs (repris de leur dernière définition en base).
-- ===========================================================================

-- Vrai si l'appelant n'est rattaché à aucune organisation (superadmin), ou si
-- son organisation est ACTIVE et non supprimée.
create or replace function public.organisation_appelant_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.organisation_id is null
        or exists (
          select 1 from organisations o
          where o.id = p.organisation_id and o.statut = 'ACTIVE' and o.deleted_at is null
        )
    from profils p
    where p.id = auth.uid() and p.deleted_at is null
  ), false);
$$;

create or replace function public.profil_a_role(p_organisation_id uuid, p_roles text[])
returns boolean
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
  if not public.organisation_appelant_active() then
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

create or replace function public.peut_creer_role(p_role_cree text, p_organisation_id uuid, p_pharmacie_id uuid)
returns boolean
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

  if v_role is null or not public.organisation_appelant_active() then
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

create or replace function public.peut_inviter_role(p_role_cree text, p_organisation_id uuid, p_pharmacie_id uuid, p_societe_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role            text;
  v_organisation_id uuid;
  v_pharmacie_id    uuid;
  v_societe_id      uuid;
begin
  select role, organisation_id, pharmacie_id, societe_id
    into v_role, v_organisation_id, v_pharmacie_id, v_societe_id
  from profils
  where id = auth.uid() and deleted_at is null;

  if v_role is null or not public.organisation_appelant_active() then
    return false;
  end if;

  return exists (
    select 1
    from regles_provisioning rp
    where rp.deleted_at is null
      and rp.role_cree = p_role_cree
      and rp.role_createur in (
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
        or (rp.scope_verifie = 'societe_id'
            and p_societe_id is not null and p_societe_id = v_societe_id)
      )
  );
end;
$$;
