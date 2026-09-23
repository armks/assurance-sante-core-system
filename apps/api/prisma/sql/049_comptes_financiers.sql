-- ===========================================================================
-- Socle des comptes financiers de l'assureur (trésorerie interne : comptes
-- bancaires + caisses internes) — réservé EXCLUSIVEMENT à ASSUREUR_COMPTABLE,
-- JAMAIS ASSUREUR_COMPTABLE_ADJOINT. Vérifié sur le rôle EXACT du profil
-- (`p.role = 'ASSUREUR_COMPTABLE'`), jamais via `profil_a_role()` — cette
-- fonction remonte l'adjoint vers son parent (`role_parent_code`, un niveau),
-- comportement déjà exploité DÉLIBÉRÉMENT ailleurs (factures mensuelles,
-- paiements groupés) mais explicitement exclu ici.
-- ===========================================================================

create table if not exists public.comptes_financiers (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  type             text not null check (type in ('BANCAIRE', 'CAISSE_INTERNE')),
  nom              text not null check (char_length(nom) >= 2),
  banque_nom       text,
  numero_compte    text,
  solde_actuel     numeric(14, 2) not null default 0,
  cree_par         uuid not null references public.profils (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists comptes_financiers_organisation_id_idx
  on public.comptes_financiers (organisation_id);

alter table public.comptes_financiers enable row level security;

-- Lecture ET écriture : rôle EXACT ASSUREUR_COMPTABLE uniquement — comparaison
-- directe sur profils.role, jamais profil_a_role (qui inclurait l'adjoint).
drop policy if exists comptes_financiers_lecture on public.comptes_financiers;
create policy comptes_financiers_lecture on public.comptes_financiers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = comptes_financiers.organisation_id
        and p.role = 'ASSUREUR_COMPTABLE'
    )
  );

drop policy if exists comptes_financiers_ecriture on public.comptes_financiers;
create policy comptes_financiers_ecriture on public.comptes_financiers
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = comptes_financiers.organisation_id
        and p.role = 'ASSUREUR_COMPTABLE'
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = comptes_financiers.organisation_id
        and p.role = 'ASSUREUR_COMPTABLE'
    )
  );
