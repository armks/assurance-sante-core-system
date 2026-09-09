-- ===========================================================================
-- PROMPT 6 (rattrapage) — Invitations sécurisées
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 6 », v5 §3
--              (flux d'invitation, aucun mot de passe connu de l'admin),
--              01-plan-directeur-v9.md §1.4 / §1.5 (regles_provisioning).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
--
-- Principe : la ligne `invitations` est créée par le module NestJS `invitations/`
-- APRÈS vérification de `regles_provisioning`, puis l'API Admin Supabase
-- (inviteUserByEmail) crée le compte auth et envoie l'e-mail. L'invité définit
-- lui-même son mot de passe sur /accepter-invitation/[token] — il n'est jamais
-- généré ni vu côté serveur.
--
-- mode = 'PROPOSITION'  → statut initial EN_ATTENTE_VALIDATION_INFORMATIQUE,
--                          aucun appel Supabase tant que le validateur n'a pas
--                          tranché (délégation pharmacien → caissière, v9 §1.5).
-- ===========================================================================

create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  telephone        text,
  role_propose     text not null references public.sous_roles (code),
  organisation_id  uuid references public.organisations (id),
  societe_id       uuid,
  etablissement_id uuid,
  pharmacie_id     uuid,
  adherent_id      uuid,
  invite_par       uuid not null references public.profils (id),
  token            text not null unique,
  statut           text not null default 'EN_ATTENTE'
                     check (statut in (
                       'EN_ATTENTE_VALIDATION_INFORMATIQUE',
                       'EN_ATTENTE',
                       'ACCEPTEE',
                       'REJETEE',
                       'EXPIREE',
                       'REVOQUEE'
                     )),
  mode             text not null default 'CREATION_DIRECTE'
                     check (mode in ('CREATION_DIRECTE', 'PROPOSITION')),
  role_validateur  text references public.sous_roles (code),
  -- id du compte auth.users créé par l'API Admin Supabase (null tant que
  -- l'invitation n'a pas été envoyée — cas PROPOSITION en attente)
  auth_user_id     uuid,
  motif_rejet      text,
  expire_le        timestamptz not null default (now() + interval '72 hours'),
  accepte_le       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  -- un validateur est renseigné si et seulement si mode = PROPOSITION
  constraint invitations_validateur_coherent
    check ((mode = 'PROPOSITION') = (role_validateur is not null))
);

create index if not exists invitations_invite_par_idx on public.invitations (invite_par);
create index if not exists invitations_email_idx      on public.invitations (lower(email));
create index if not exists invitations_statut_idx     on public.invitations (statut);

-- ===========================================================================
-- Autorisation d'invitation : même logique que `peut_creer_role` (prisma/sql/003)
-- mais SANS filtrer sur le mode — une PROPOSITION est une invitation légitime,
-- juste soumise à validation ensuite.
-- ===========================================================================
create or replace function public.peut_inviter_role(
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
      )
  );
end;
$$;

-- ===========================================================================
-- RLS — défense en profondeur (le module NestJS passe par le rôle `postgres`
-- du pooler et contourne la RLS ; ces policies protègent un accès direct via
-- le client Supabase avec un JWT utilisateur).
-- ===========================================================================
alter table public.invitations enable row level security;

-- INSERT : uniquement pour soi-même (invite_par = auth.uid()) et seulement un
-- rôle réellement autorisé par regles_provisioning.
drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert
  to authenticated
  with check (
    invite_par = auth.uid()
    and public.peut_inviter_role(role_propose, organisation_id, pharmacie_id)
  );

-- SELECT : l'émetteur, ou le rôle validateur d'une proposition en attente (dans
-- la même organisation, héritage adjoint inclus).
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select
  to authenticated
  using (
    invite_par = auth.uid()
    or (
      statut = 'EN_ATTENTE_VALIDATION_INFORMATIQUE'
      and role_validateur is not null
      and exists (
        select 1
        from profils p
        where p.id = auth.uid()
          and p.deleted_at is null
          and p.organisation_id is not distinct from invitations.organisation_id
          and role_validateur in (
            select p.role
            union
            select role_parent_code from sous_roles
            where code = p.role and role_parent_code is not null
          )
      )
    )
  );

-- UPDATE : le rôle validateur peut faire avancer une proposition.
drop policy if exists invitations_update_validateur on public.invitations;
create policy invitations_update_validateur on public.invitations
  for update
  to authenticated
  using (
    statut = 'EN_ATTENTE_VALIDATION_INFORMATIQUE'
    and role_validateur is not null
    and exists (
      select 1
      from profils p
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id is not distinct from invitations.organisation_id
        and role_validateur in (
          select p.role
          union
          select role_parent_code from sous_roles
          where code = p.role and role_parent_code is not null
        )
    )
  )
  with check (true);

-- ===========================================================================
-- Aiguillage frontend : le superadministrateur pilote l'onboarding des
-- organisations depuis /superadmin (et non un dashboard « métier »).
-- ===========================================================================
update public.sous_roles set dashboard_route = '/superadmin'
where code in ('SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN');
