-- ===========================================================================
-- PROMPT 22 — Administration SaaS : licences + confirmation à deux temps
--             des actions superadmin sensibles.
-- Réf. skill : 05-domaines-manquants-v14.md §5 (licences_organisation).
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- `codes_validation_superadmin` : une action sensible du SUPERADMIN_PRINCIPAL
-- (création / suspension / prolongation d'une organisation) n'est PLUS exécutée
-- immédiatement. Le payload est stocké, un code à 8 caractères est envoyé par
-- e-mail à SUPERADMIN_EMAIL (Resend), et l'action n'est réalisée qu'après saisie
-- du code (validité 15 min, usage unique).
-- ===========================================================================

create table if not exists public.licences_organisation (
  organisation_id        uuid primary key references public.organisations (id) on delete cascade,
  plan                   text not null default 'STARTER'
                           check (plan in ('STARTER', 'BUSINESS', 'ENTERPRISE')),
  limite_adherents       integer check (limite_adherents is null or limite_adherents >= 0),
  limite_appels_api_mois integer check (limite_appels_api_mois is null or limite_appels_api_mois >= 0),
  date_debut             date not null default current_date,
  date_fin               date,
  statut                 text not null default 'ACTIVE'
                           check (statut in ('ACTIVE', 'SUSPENDUE', 'EXPIREE')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists licences_organisation_statut_idx on public.licences_organisation (statut);

create table if not exists public.codes_validation_superadmin (
  id              uuid primary key default gen_random_uuid(),
  action          text not null
                    check (action in ('CREATION_ORGANISATION',
                                      'SUSPENSION_ORGANISATION',
                                      'PROLONGATION_ORGANISATION')),
  -- données de l'action en attente de confirmation
  payload         jsonb not null,
  code            text not null unique
                    check (code ~ '^[A-Z0-9]{6,8}$'),
  date_emission   timestamptz not null default now(),
  date_expiration timestamptz not null default (now() + interval '15 minutes'),
  statut          text not null default 'EMIS'
                    check (statut in ('EMIS', 'CONFIRME', 'EXPIRE', 'ANNULE')),
  created_at      timestamptz not null default now()
);

create index if not exists codes_validation_superadmin_statut_idx on public.codes_validation_superadmin (statut);

-- ===========================================================================
-- RLS — tables purement superadmin / système. NestJS (rôle `postgres` du pooler)
-- est le seul chemin d'écriture ; policies de lecture minimales en défense.
-- ===========================================================================
alter table public.licences_organisation      enable row level security;
alter table public.codes_validation_superadmin enable row level security;

-- Licence : le superadmin voit tout ; un membre d'une organisation voit SA licence.
drop policy if exists licences_organisation_lecture on public.licences_organisation;
create policy licences_organisation_lecture on public.licences_organisation
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and (
          p.role in ('SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN')
          or p.organisation_id = licences_organisation.organisation_id
        )
    )
  );

drop policy if exists licences_organisation_ecriture_superadmin on public.licences_organisation;
create policy licences_organisation_ecriture_superadmin on public.licences_organisation
  for all
  to authenticated
  using (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role = 'SUPERADMIN_PRINCIPAL')
  )
  with check (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role = 'SUPERADMIN_PRINCIPAL')
  );

-- Codes de validation : superadmin uniquement (payloads sensibles).
drop policy if exists codes_validation_superadmin_superadmin_only on public.codes_validation_superadmin;
create policy codes_validation_superadmin_superadmin_only on public.codes_validation_superadmin
  for all
  to authenticated
  using (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role in ('SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN'))
  )
  with check (
    exists (select 1 from public.profils p
            where p.id = auth.uid() and p.deleted_at is null
              and p.role in ('SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN'))
  );
