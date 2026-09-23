-- ===========================================================================
-- Mouvements entre comptes financiers + suivi des dépenses courantes.
-- Table d'audit IMMUABLE (insert-only, jamais de update/delete) — chaque ligne
-- de trésorerie (transfert, dépense, approvisionnement, futur règlement de
-- facture) y est tracée une fois pour toutes. Même périmètre EXCLUSIF que
-- comptes_financiers : réservé au rôle EXACT ASSUREUR_COMPTABLE, JAMAIS
-- ASSUREUR_COMPTABLE_ADJOINT (comparaison directe sur profils.role, jamais
-- profil_a_role()).
-- ===========================================================================

create table if not exists public.mouvements_financiers (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id),
  compte_source_id      uuid references public.comptes_financiers (id),
  compte_destination_id uuid references public.comptes_financiers (id),
  type                  text not null check (type in ('TRANSFERT', 'DEPENSE', 'APPROVISIONNEMENT', 'PAIEMENT_FACTURE')),
  montant               numeric(14, 2) not null check (montant > 0),
  description           text not null check (char_length(trim(description)) >= 3),
  piece_jointe_url      text,
  effectue_par          uuid not null references public.profils (id),
  created_at            timestamptz not null default now(),

  constraint mouvements_financiers_comptes_coherents
    check (
      (type = 'TRANSFERT' and compte_source_id is not null and compte_destination_id is not null)
      or (type = 'DEPENSE' and compte_source_id is not null and compte_destination_id is null)
      or (type = 'APPROVISIONNEMENT' and compte_destination_id is not null)
      or (type = 'PAIEMENT_FACTURE' and compte_source_id is not null and compte_destination_id is null)
    ),
  constraint mouvements_financiers_comptes_distincts
    check (compte_source_id is distinct from compte_destination_id)
);

create index if not exists mouvements_financiers_organisation_id_idx
  on public.mouvements_financiers (organisation_id);
create index if not exists mouvements_financiers_compte_source_id_idx
  on public.mouvements_financiers (compte_source_id);
create index if not exists mouvements_financiers_compte_destination_id_idx
  on public.mouvements_financiers (compte_destination_id);
create index if not exists mouvements_financiers_created_at_idx
  on public.mouvements_financiers (created_at);

alter table public.mouvements_financiers enable row level security;

-- Lecture : rôle EXACT ASSUREUR_COMPTABLE uniquement — mêmes données
-- sensibles (montants, pièces jointes bancaires) que comptes_financiers.
drop policy if exists mouvements_financiers_lecture on public.mouvements_financiers;
create policy mouvements_financiers_lecture on public.mouvements_financiers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = mouvements_financiers.organisation_id
        and p.role = 'ASSUREUR_COMPTABLE'
    )
  );

-- Écriture : INSERT seulement (table immuable, jamais de update/delete côté
-- applicatif ni via RLS) — même rôle EXACT.
drop policy if exists mouvements_financiers_insertion on public.mouvements_financiers;
create policy mouvements_financiers_insertion on public.mouvements_financiers
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = mouvements_financiers.organisation_id
        and p.role = 'ASSUREUR_COMPTABLE'
    )
  );

-- Bucket de stockage privé pour les pièces jointes (chèque/reçu) — même
-- schéma que `contestations`/`cartes` (prisma/sql/043/023) : aucune policy
-- sur storage.objects → inaccessible en anon/authenticated, seul
-- `service_role` (PaymentService, via l'API Storage REST) y écrit et y
-- génère des URL signées à durée limitée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mouvements-financiers', 'mouvements-financiers', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
