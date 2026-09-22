-- ===========================================================================
-- Accès en revue du pharmacien conseil + mécanisme de contestation d'une
-- ligne d'ordonnance déjà servie (prévu depuis le plan directeur, jamais
-- construit jusqu'ici).
-- ===========================================================================

-- 1. contestations_prescription.
create table if not exists public.contestations_prescription (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id),
  ligne_ordonnance_id    uuid not null references public.lignes_ordonnance (id),
  ouvert_par_id          uuid not null references public.profils (id),
  motif                  text not null check (char_length(motif) >= 5),
  date_ouverture         timestamptz not null default now(),
  date_limite            timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  statut                 text not null default 'OUVERT'
                           check (statut in ('OUVERT', 'JUSTIFICATION_RECUE', 'VALIDEE', 'REJETEE')),
  reponse_etablissement  text,
  pieces_justificatives  text[] not null default '{}',
  traite_par_id          uuid references public.profils (id),
  date_cloture           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint contestations_prescription_cloture_coherente
    check (
      (statut in ('VALIDEE', 'REJETEE') and traite_par_id is not null and date_cloture is not null)
      or (statut in ('OUVERT', 'JUSTIFICATION_RECUE') and traite_par_id is null and date_cloture is null)
    )
);

create index if not exists contestations_prescription_organisation_id_idx
  on public.contestations_prescription (organisation_id);
create index if not exists contestations_prescription_ligne_ordonnance_id_idx
  on public.contestations_prescription (ligne_ordonnance_id);
create index if not exists contestations_prescription_statut_idx
  on public.contestations_prescription (statut);

-- Au plus une contestation NON TERMINALE (OUVERT/JUSTIFICATION_RECUE) active
-- par ligne à la fois — empêche toute double-contestation simultanée.
create unique index if not exists contestations_prescription_active_uniq
  on public.contestations_prescription (ligne_ordonnance_id)
  where statut in ('OUVERT', 'JUSTIFICATION_RECUE');

create or replace function public.contestations_prescription_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_contestations_prescription_updated_at on public.contestations_prescription;
create trigger trg_contestations_prescription_updated_at
  before update on public.contestations_prescription
  for each row execute function public.contestations_prescription_set_updated_at();

alter table public.contestations_prescription enable row level security;

-- Lecture : le pharmacien conseil et le reste du personnel ASSUREUR habilité
-- (organisation entière), ET toute pharmacie du réseau (elle doit voir les
-- contestations qui la concernent — la NestJS reste seule juge de l'écriture,
-- garde en profondeur uniquement, comme pour lignes_ordonnance/lignes_facturation).
drop policy if exists contestations_prescription_lecture on public.contestations_prescription;
create policy contestations_prescription_lecture on public.contestations_prescription
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_prescription.organisation_id
        and (
          p.pharmacie_id is not null
          or p.role in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL')
        )
    )
  );

-- Écriture : ouverture/tranchage réservés au pharmacien conseil ; soumission
-- de justification réservée à la pharmacie (PHARMACIE_PHARMACIEN/COMPTABLE) —
-- la NestJS vérifie en plus qu'il s'agit bien de LA pharmacie concernée
-- (`ligneOrdonnance.pharmacieServanteId`), non modélisable simplement en RLS.
drop policy if exists contestations_prescription_ecriture on public.contestations_prescription;
create policy contestations_prescription_ecriture on public.contestations_prescription
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL'])
    or exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_prescription.organisation_id
        and p.pharmacie_id is not null
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE')
    )
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL'])
    or exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_prescription.organisation_id
        and p.pharmacie_id is not null
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE')
    )
  );

-- 2. ASSUREUR_PHARMACIEN_CONSEIL rejoint la lecture des ordonnances (item 1) —
--    lignes_ordonnance l'incluait déjà (prisma/sql/026), dossiers_soins est
--    déjà ouvert à toute l'organisation (scope tenant uniquement, RBAC réel
--    posé côté NestJS par ROLES_LECTURE_DOSSIER_STAFF).
drop policy if exists ordonnances_lecture on public.ordonnances;
create policy ordonnances_lecture on public.ordonnances
  for select
  to authenticated
  using (
    medecin_id = auth.uid()
    or exists (
      select 1 from public.dossiers_soins d
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where d.id = ordonnances.dossier_soins_id
        and (
          (p.adherent_id is not null and p.adherent_id = d.adherent_id)
          or p.role in ('ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL')
        )
        and d.organisation_id = p.organisation_id
    )
  );

-- 3. Bucket de stockage privé pour les pièces justificatives d'une
--    contestation (même schéma que `cartes`, prisma/sql/023) : aucune policy
--    sur storage.objects pour ce bucket → inaccessible en anon/authenticated,
--    seul `service_role` (ContestationService, via l'API Storage REST) y
--    écrit et y génère des URL signées à durée limitée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contestations', 'contestations', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
