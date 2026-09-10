-- ===========================================================================
-- PROMPT 20 — Ticket de Soins (3e des 4 codes anti-fraude, v8 §4)
-- Réf. skill : v8 §4 (Ticket de Soins regroupant tous les actes d'un épisode),
--              v1 §15 (ActeDossier), v10 §1.2 (`medecin_prescripteur_id`).
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- État constaté avant ce prompt : `actes_dossier` N'EXISTAIT PAS. Le PROMPT 17
-- n'avait créé que `dossiers_soins` et `consultations_dossier`. Ce prompt crée
-- donc `actes_dossier` (version minimale) en plus de `tickets_soins`.
--
-- Cycle de vie du ticket — 100 % automatique, jamais une étape manuelle :
--   * créé OUVERT dans la MÊME transaction que l'ouverture du dossier de soins
--     (CareEpisodeService.ouvrirDossier) ;
--   * clôturé (CLOTURE) dans la MÊME transaction que la clôture du dossier
--     (CareEpisodeService.appliquerCloture) — verrouille l'ajout d'actes.
-- Défense en profondeur : un trigger BEFORE INSERT sur `actes_dossier` refuse
-- tout acte si le ticket n'est pas OUVERT — même pour un INSERT SQL direct
-- (rôle `postgres` du pooler inclus), comme `verifier_medecin_traitant()`.
-- ===========================================================================

create table if not exists public.tickets_soins (
  id               uuid primary key default gen_random_uuid(),
  -- un seul ticket par dossier de soins
  dossier_soins_id uuid not null unique references public.dossiers_soins (id) on delete cascade,
  code             text not null unique
                     check (code ~ '^[A-Z0-9]{6,8}$'),
  date_emission    timestamptz not null default now(),
  date_cloture     timestamptz,
  statut           text not null default 'OUVERT'
                     check (statut in ('OUVERT', 'CLOTURE', 'ANNULE')),
  created_at       timestamptz not null default now(),

  -- CLOTURE / ANNULE => date_cloture renseignée ; OUVERT => nulle
  constraint tickets_soins_cloture_coherente
    check ((statut = 'OUVERT') = (date_cloture is null))
);

create index if not exists tickets_soins_statut_idx on public.tickets_soins (statut);

-- --- actes_dossier (version minimale — le référentiel_actes l'affinera) ------
create table if not exists public.actes_dossier (
  id                     uuid primary key default gen_random_uuid(),
  dossier_soins_id       uuid not null references public.dossiers_soins (id) on delete cascade,
  ticket_soins_id        uuid not null references public.tickets_soins (id),
  consultation_id        uuid references public.consultations_dossier (id),
  -- v10 §1.2 : le prescripteur est un compte réel, pas un champ texte libre
  medecin_prescripteur_id uuid references public.profils (id),
  categorie_acte         text not null,   -- CONSULTATION, HOSPITALISATION, PHARMACIE, OPTIQUE, DENTAIRE, IMAGERIE, BIOLOGIE...
  libelle                text not null,
  code_acte              text,            -- référence lâche au référentiel des actes (à affiner plus tard)
  quantite               integer not null default 1 check (quantite >= 1),
  montant_prescrit       numeric(14, 2) check (montant_prescrit is null or montant_prescrit >= 0),
  statut                 text not null default 'PRESCRIT'
                           check (statut in ('PRESCRIT', 'REALISE', 'ANNULE', 'LIQUIDE')),
  date_prescription      timestamptz not null default now(),
  date_realisation       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index if not exists actes_dossier_dossier_idx      on public.actes_dossier (dossier_soins_id);
create index if not exists actes_dossier_ticket_idx       on public.actes_dossier (ticket_soins_id);
create index if not exists actes_dossier_consultation_idx on public.actes_dossier (consultation_id);
create index if not exists actes_dossier_statut_idx       on public.actes_dossier (statut);

-- ===========================================================================
-- Trigger : un acte ne peut être ajouté qu'à un ticket OUVERT.
-- ===========================================================================
create or replace function public.verifier_ticket_ouvert()
returns trigger
language plpgsql
as $$
declare
  v_statut text;
begin
  select statut into v_statut
  from public.tickets_soins
  where id = new.ticket_soins_id;

  if v_statut is null then
    raise exception 'ticket_soins % introuvable', new.ticket_soins_id
      using errcode = 'check_violation';
  end if;

  if v_statut <> 'OUVERT' then
    raise exception
      'Le ticket de soins % est % — impossible d''y ajouter un acte (ticket verrouillé).',
      new.ticket_soins_id, v_statut
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_verifier_ticket_ouvert on public.actes_dossier;
create trigger trg_verifier_ticket_ouvert
  before insert on public.actes_dossier
  for each row execute function public.verifier_ticket_ouvert();

-- ===========================================================================
-- RLS — lecture ouverte à l'organisation ; écriture applicative gardée par
-- les services NestJS (+ le trigger). NB : NestJS contourne la RLS via `postgres`.
-- ===========================================================================
alter table public.tickets_soins  enable row level security;
alter table public.actes_dossier  enable row level security;

drop policy if exists tickets_soins_lecture on public.tickets_soins;
create policy tickets_soins_lecture on public.tickets_soins
  for select
  using (
    exists (
      select 1 from public.dossiers_soins d
      where d.id = tickets_soins.dossier_soins_id
        and d.organisation_id = (
          select organisation_id from public.profils
          where id = auth.uid() and deleted_at is null
        )
    )
  );

drop policy if exists actes_dossier_lecture on public.actes_dossier;
create policy actes_dossier_lecture on public.actes_dossier
  for select
  using (
    exists (
      select 1 from public.dossiers_soins d
      where d.id = actes_dossier.dossier_soins_id
        and d.organisation_id = (
          select organisation_id from public.profils
          where id = auth.uid() and deleted_at is null
        )
    )
  );

drop policy if exists actes_dossier_insert on public.actes_dossier;
create policy actes_dossier_insert on public.actes_dossier
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.dossiers_soins d
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where d.id = actes_dossier.dossier_soins_id
        and d.organisation_id = p.organisation_id
        and p.role in ('CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_ACCUEIL',
                       'CENTRE_MEDICAL_ADMINISTRATIF',
                       'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE')
    )
  );
