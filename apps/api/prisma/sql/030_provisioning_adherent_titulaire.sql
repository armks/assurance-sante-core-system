-- ===========================================================================
-- 030 — Provisioning réel pour ADHERENT_TITULAIRE (confirmé absent, vérifié
-- avant correction, comme demandé). Deux créateurs légitimes, même mécanisme
-- générique que SOUSCRIPTEUR_INDIVIDUEL (migration 029) :
--   1. ASSUREUR_INFORMATIQUE (organisation_id) — déjà pleinement supporté
--      par resoudreScope(), aucun code applicatif à ajouter pour ce cas.
--   2. SOCIETE_ADMINISTRATION (societe_id) — NOUVEAU scope, qui n'existait
--      pas encore dans resoudreScope()/peut_inviter_role() (seuls
--      'organisation_id' et 'pharmacie_id' étaient gérés). Contrairement au
--      cas informatique, SOCIETE_ADMINISTRATION est un appelant moins
--      privilégié : le scope est dérivé de SON PROPRE profil
--      (ctx.societe_id), jamais d'une valeur fournie dans la requête — et si
--      un adherentId est fourni, il est revérifié comme appartenant
--      réellement à cette société avant d'être accepté (même famille de
--      contrôle que les fuites inter-établissement/pharmacie déjà corrigées
--      dans ce projet — voir InvitationsService.resoudreScope()).
-- ===========================================================================

-- 'societe_id' n'était pas encore une valeur autorisée (seuls 'organisation_id',
-- 'pharmacie_id', 'etablissement_id' l'étaient depuis PROMPT 5) — élargie ici.
alter table public.regles_provisioning drop constraint if exists regles_provisioning_scope_verifie_check;
alter table public.regles_provisioning add constraint regles_provisioning_scope_verifie_check
  check (scope_verifie is null
         or scope_verifie in ('organisation_id', 'pharmacie_id', 'etablissement_id', 'societe_id'));

insert into public.regles_provisioning (role_createur, role_cree, scope_verifie, mode, role_validateur)
values
  ('ASSUREUR_INFORMATIQUE', 'ADHERENT_TITULAIRE', 'organisation_id', 'CREATION_DIRECTE', null),
  ('SOCIETE_ADMINISTRATION', 'ADHERENT_TITULAIRE', 'societe_id', 'CREATION_DIRECTE', null)
on conflict on constraint regles_provisioning_unique do nothing;

-- ===========================================================================
-- peut_inviter_role() — ajout du scope 'societe_id' (défense en profondeur,
-- même principe que 'pharmacie_id'). Signature changée (paramètre
-- supplémentaire) : drop explicite avant recréation, Postgres ne remplace
-- pas une fonction en place si la liste de paramètres change.
-- ===========================================================================
-- La policy dépend de la fonction : la supprimer avant de changer sa signature.
drop policy if exists invitations_insert on public.invitations;
drop function if exists public.peut_inviter_role(text, uuid, uuid);

create or replace function public.peut_inviter_role(
  p_role_cree       text,
  p_organisation_id uuid,
  p_pharmacie_id    uuid,
  p_societe_id      uuid
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
  v_societe_id      uuid;
begin
  select role, organisation_id, pharmacie_id, societe_id
    into v_role, v_organisation_id, v_pharmacie_id, v_societe_id
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
        or (rp.scope_verifie = 'societe_id'
            and p_societe_id is not null and p_societe_id = v_societe_id)
      )
  );
end;
$$;

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert
  to authenticated
  with check (
    invite_par = auth.uid()
    and public.peut_inviter_role(role_propose, organisation_id, pharmacie_id, societe_id)
  );
