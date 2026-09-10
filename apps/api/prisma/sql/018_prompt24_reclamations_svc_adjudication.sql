-- ===========================================================================
-- PROMPT 24 — Réclamations + rôle technique svc_adjudication (partie 1 / 2)
-- Réf. skill : 03-microservice-java-adjudication-v12.md, v8 (codes anti-fraude),
--              v1 §16 (adjudication automatique).
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- Cette partie NE connecte PAS encore le microservice Java. Elle pose :
--   - `reclamations`  : une réclamation par acte_dossier (unique), machine à états
--     SOUMISE → EN_ADJUDICATION → AUTO_ADJUDIQUE / REVUE_MANUELLE → REJETE / PAYEE ;
--   - `remboursements` : résultat d'adjudication (une ligne par réclamation) ;
--   - `svc_adjudication` : rôle Postgres technique (NOLOGIN, BYPASSRLS) avec des
--     grants STRICTEMENT limités — jamais utilisé par une session utilisateur, il
--     sera assumé par le microservice Java au prompt suivant.
-- ===========================================================================

-- --- reclamations --------------------------------------------------------
create table if not exists public.reclamations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  dossier_soins_id uuid not null references public.dossiers_soins (id),
  acte_dossier_id  uuid not null references public.actes_dossier (id),
  adherent_id      uuid,
  beneficiaire_id  uuid,
  police_id        uuid not null references public.polices (id),
  garantie_id      uuid not null references public.garanties (id),
  montant          numeric(14, 2) not null check (montant >= 0),
  type_reclamation text not null default 'AUTRE'
                     check (type_reclamation in ('SOIN', 'PHARMACIE', 'HOSPITALISATION',
                                                 'OPTIQUE', 'DENTAIRE', 'ANALYSES',
                                                 'IMAGERIE', 'AUTRE')),
  statut           text not null default 'SOUMISE'
                     check (statut in ('SOUMISE', 'EN_ADJUDICATION', 'AUTO_ADJUDIQUE',
                                       'REVUE_MANUELLE', 'REJETE', 'PAYEE')),
  codes_rejet      text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- une seule réclamation vivante par acte de dossier (idempotence de la soumission)
create unique index if not exists reclamations_acte_dossier_unique
  on public.reclamations (acte_dossier_id) where deleted_at is null;
create index if not exists reclamations_organisation_id_idx  on public.reclamations (organisation_id);
create index if not exists reclamations_statut_idx           on public.reclamations (statut);
create index if not exists reclamations_dossier_soins_id_idx on public.reclamations (dossier_soins_id);

-- --- remboursements -----------------------------------------------------
create table if not exists public.remboursements (
  id                     uuid primary key default gen_random_uuid(),
  reclamation_id         uuid not null unique references public.reclamations (id),
  montant_rembourse      numeric(14, 2) not null check (montant_rembourse >= 0),
  plafond_restant_apres  numeric(14, 2),
  decision               text not null,
  duree_traitement_ms    integer check (duree_traitement_ms is null or duree_traitement_ms >= 0),
  created_at             timestamptz not null default now()
);
create index if not exists remboursements_reclamation_id_idx on public.remboursements (reclamation_id);

-- ===========================================================================
-- RLS — lecture pour le personnel ASSUREUR de l'organisation concernée.
-- AUCUNE policy d'écriture pour `authenticated` : seuls le rôle propriétaire
-- `postgres` (chemin NestJS) et `svc_adjudication` (BYPASSRLS) écrivent.
-- ===========================================================================
alter table public.reclamations   enable row level security;
alter table public.remboursements enable row level security;

drop policy if exists reclamations_lecture on public.reclamations;
create policy reclamations_lecture on public.reclamations
  for select to authenticated
  using (
    organisation_id = (
      select organisation_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists remboursements_lecture on public.remboursements;
create policy remboursements_lecture on public.remboursements
  for select to authenticated
  using (
    exists (
      select 1
      from public.reclamations r
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where r.id = remboursements.reclamation_id
        and r.organisation_id = p.organisation_id
    )
  );

-- ===========================================================================
-- log_audit → SECURITY DEFINER : le microservice n'a besoin que d'EXECUTE
-- (sinon il faudrait lui accorder INSERT sur audit_log + SELECT sur profils).
-- La fonction appartient à `postgres` ; le corps continue de s'exécuter avec
-- les droits de `postgres` — aucun changement de comportement pour NestJS.
-- ===========================================================================
alter function public.log_audit(text, text, uuid, uuid, jsonb) security definer;
alter function public.log_audit(text, text, uuid, uuid, jsonb) set search_path = public;

-- ===========================================================================
-- Rôle technique svc_adjudication — NOLOGIN, BYPASSRLS, aucune session utilisateur.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_adjudication') then
    create role svc_adjudication
      nologin nosuperuser nocreatedb nocreaterole noreplication bypassrls;
  else
    alter role svc_adjudication
      nologin nosuperuser nocreatedb nocreaterole noreplication bypassrls;
  end if;
end $$;

-- Repartir d'une ardoise vierge (le rôle peut préexister d'un essai antérieur).
revoke all on all tables    in schema public from svc_adjudication;
revoke all on all sequences in schema public from svc_adjudication;
revoke all on all functions in schema public from svc_adjudication;
revoke all on schema public from svc_adjudication;

grant usage on schema public to svc_adjudication;

-- 1) SELECT (lecture des règles de couverture et tarifs)
--    NB : il n'existe pas de table `plans_couverture` distincte — le « plan de
--    couverture » d'un dossier est une ligne de `garanties` (dossiers_soins.plan_couverture_id),
--    déjà couverte par le grant SELECT sur `garanties`.
grant select on public.garanties          to svc_adjudication;
grant select on public.grilles_tarifaires to svc_adjudication;
grant select on public.referentiel_actes  to svc_adjudication;
grant select on public.medicaments        to svc_adjudication;
grant select on public.polices            to svc_adjudication;

-- 2) reclamations : SELECT sur des colonnes PRÉCISES (jamais *) + UPDATE(statut) uniquement
grant select (id, organisation_id, dossier_soins_id, acte_dossier_id, adherent_id,
              beneficiaire_id, police_id, garantie_id, montant, type_reclamation,
              statut, created_at)
  on public.reclamations to svc_adjudication;
grant update (statut) on public.reclamations to svc_adjudication;

-- 3) remboursements : INSERT (écriture du résultat d'adjudication)
grant insert on public.remboursements to svc_adjudication;

-- 4) log_audit : EXECUTE uniquement
grant execute on function public.log_audit(text, text, uuid, uuid, jsonb) to svc_adjudication;
