-- ===========================================================================
-- CONSOLIDATION — `tickets_soins.organisation_id` (dénormalisé) + RLS directe
--
-- Réf. : revue de consolidation 2026-09-10, point 2 ; règle transverse du skill
-- « RLS partout, sans exception » ; ARCHITECTURE-DECISIONS.md (contexte).
--
-- Appliqué le 2026-09-10 via `prisma db execute --file`.
--
-- Constat corrigé : `tickets_soins` (prisma/sql/014) n'avait PAS de colonne
-- `organisation_id`. Son isolation multi-tenant (policy `tickets_soins_lecture`)
-- ne reposait que sur une **jointure implicite** vers `dossiers_soins` — non
-- vérifiable directement sur la table elle-même, seule table du parcours de
-- soins dans ce cas. On ajoute la colonne (miroir dénormalisé du dossier), on
-- la fige par trigger, et on réécrit la policy RLS pour qu'elle porte
-- directement sur `tickets_soins.organisation_id`.
--
-- « Dénormalisé depuis le dossier à la création » :
--   * côté applicatif : CareEpisodeService.ouvrirDossier passe `organisationId`
--     dans le même `tx` que la création du dossier ;
--   * côté base (défense en profondeur) : le trigger BEFORE INSERT ci-dessous
--     REFIGE toujours `organisation_id` depuis `dossiers_soins` — un INSERT SQL
--     direct (rôle `postgres` du pooler inclus) ne peut pas la faire diverger.
-- ===========================================================================

-- 1. Colonne (nullable le temps du backfill) -------------------------------
alter table public.tickets_soins
  add column if not exists organisation_id uuid references public.organisations (id);

-- 2. Backfill depuis le dossier de soins parent ---------------------------
update public.tickets_soins t
set organisation_id = d.organisation_id
from public.dossiers_soins d
where d.id = t.dossier_soins_id
  and t.organisation_id is null;

-- 3. Contrainte NOT NULL + index ----------------------------------------
alter table public.tickets_soins
  alter column organisation_id set not null;

create index if not exists tickets_soins_organisation_id_idx
  on public.tickets_soins (organisation_id);

-- 4. Trigger : `organisation_id` toujours dérivée du dossier -------------
create or replace function public.tickets_soins_set_organisation_id()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  select d.organisation_id into v_org
  from public.dossiers_soins d
  where d.id = new.dossier_soins_id;

  if v_org is null then
    raise exception
      'dossier_soins % introuvable — organisation_id du ticket indéterminée',
      new.dossier_soins_id
      using errcode = 'foreign_key_violation';
  end if;

  -- refige : ignore toute valeur fournie qui divergerait du dossier
  new.organisation_id := v_org;
  return new;
end;
$$;

drop trigger if exists trg_tickets_soins_set_organisation_id on public.tickets_soins;
create trigger trg_tickets_soins_set_organisation_id
  before insert on public.tickets_soins
  for each row execute function public.tickets_soins_set_organisation_id();

-- 5. RLS — policy de lecture portée DIRECTEMENT sur la colonne ----------
--    (remplace la version jointure-vers-dossiers_soins de prisma/sql/014)
drop policy if exists tickets_soins_lecture on public.tickets_soins;
create policy tickets_soins_lecture on public.tickets_soins
  for select
  using (
    organisation_id = (
      select organisation_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );
