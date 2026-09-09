-- ===========================================================================
-- PROMPT 17 — Dossier de Soins + Numéro de Traitement
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 17 », v1 §15
--              (DossierSoins, MoteurOuvertureDossier §15.4),
--              02-corrections-medicales-v10.md §1 : `medecin_id` DOIT référencer
--              un compte réel CENTRE_MEDICAL_MEDECIN du même établissement —
--              jamais un champ texte libre, vérifié par RLS *et* trigger.
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================

create sequence if not exists public.dossiers_soins_numero_seq;
create sequence if not exists public.consultations_dossier_numero_seq;

create table if not exists public.dossiers_soins (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id),
  -- Numéro de Traitement — format TRT-YYYY-MM-NNNNNN
  numero_traitement   text not null unique
                        default ('TRT-' || to_char(now(), 'YYYY-MM') || '-' ||
                                 lpad(nextval('public.dossiers_soins_numero_seq')::text, 6, '0')),
  adherent_id         uuid,
  beneficiaire_id     uuid,
  etablissement_id    uuid not null references public.etablissements_sante (id),
  police_id           uuid not null references public.polices (id),
  plan_couverture_id  uuid references public.garanties (id),
  statut              text not null default 'OUVERT'
                        check (statut in ('OUVERT', 'SUSPENDU', 'TRANSFERE', 'CLOTURE', 'FORCE_CLOS')),
  date_ouverture      timestamptz not null default now(),
  date_cloture        timestamptz,
  motif_consultation  text,
  diagnostic_entree   text,
  code_cim10          text,
  carte_valide        boolean,
  adherent_eligible   boolean,
  aucun_dossier_ouvert boolean,
  hors_delai_carence  boolean,
  blocage_raison      text,
  cloture_par         uuid references public.profils (id),
  cloture_motif       text,
  cloture_type        text check (cloture_type is null or cloture_type in ('NORMALE', 'FORCEE')),
  transfere_vers      uuid references public.etablissements_sante (id),
  dossier_origine     uuid references public.dossiers_soins (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  -- un dossier concerne soit un adhérent, soit un bénéficiaire (au moins un)
  constraint dossiers_soins_patient_present
    check (adherent_id is not null or beneficiaire_id is not null)
);

-- Un seul dossier OUVERT à la fois par patient (garde-fou du MoteurOuvertureDossier)
create unique index if not exists dossiers_soins_un_seul_ouvert_adherent
  on public.dossiers_soins (adherent_id)
  where statut = 'OUVERT' and deleted_at is null and adherent_id is not null;
create unique index if not exists dossiers_soins_un_seul_ouvert_beneficiaire
  on public.dossiers_soins (beneficiaire_id)
  where statut = 'OUVERT' and deleted_at is null and beneficiaire_id is not null;

create index if not exists dossiers_soins_organisation_id_idx on public.dossiers_soins (organisation_id);
create index if not exists dossiers_soins_etablissement_id_idx on public.dossiers_soins (etablissement_id);
create index if not exists dossiers_soins_statut_idx          on public.dossiers_soins (statut);

create table if not exists public.consultations_dossier (
  id                  uuid primary key default gen_random_uuid(),
  numero_consultation text not null unique
                        default ('CST-' || to_char(now(), 'YYYY-MM') || '-' ||
                                 lpad(nextval('public.consultations_dossier_numero_seq')::text, 6, '0')),
  dossier_soins_id    uuid not null references public.dossiers_soins (id) on delete cascade,
  medecin_id          uuid not null references public.profils (id),
  date_consultation   timestamptz not null default now(),
  motif               text,
  observations        text,
  diagnostic          text,
  code_cim10          text,
  statut              text not null default 'EN_COURS'
                        check (statut in ('EN_COURS', 'TERMINEE', 'ANNULEE')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists consultations_dossier_dossier_idx on public.consultations_dossier (dossier_soins_id);
create index if not exists consultations_dossier_medecin_idx on public.consultations_dossier (medecin_id);

-- ===========================================================================
-- Intégrité du médecin traitant (v10 §1.2) : `medecin_id` doit référencer un
-- profil de rôle CENTRE_MEDICAL_MEDECIN rattaché au MÊME établissement que le
-- dossier de soins. Vérifié par un TRIGGER (s'applique à tout le monde, y
-- compris le rôle `postgres` du pooler utilisé par NestJS) ET par une policy RLS.
-- ===========================================================================
create or replace function public.verifier_medecin_traitant()
returns trigger
language plpgsql
as $$
declare
  v_etablissement_dossier uuid;
  v_role                  text;
  v_etablissement_medecin uuid;
begin
  select etablissement_id into v_etablissement_dossier
  from public.dossiers_soins where id = new.dossier_soins_id;

  select role, etablissement_id into v_role, v_etablissement_medecin
  from public.profils where id = new.medecin_id and deleted_at is null;

  if v_role is distinct from 'CENTRE_MEDICAL_MEDECIN' then
    raise exception 'medecin_id % n''est pas un compte CENTRE_MEDICAL_MEDECIN', new.medecin_id
      using errcode = 'check_violation';
  end if;

  if v_etablissement_medecin is distinct from v_etablissement_dossier then
    raise exception 'Le médecin % n''appartient pas à l''établissement du dossier de soins', new.medecin_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_verifier_medecin_traitant on public.consultations_dossier;
create trigger trg_verifier_medecin_traitant
  before insert or update of medecin_id on public.consultations_dossier
  for each row execute function public.verifier_medecin_traitant();

-- ===========================================================================
-- RLS — lecture ouverte à l'organisation ; écriture applicative gardée par
-- CareEpisodeService (NestJS contourne la RLS via `postgres`). Policies conservées
-- pour un accès direct via le client Supabase.
-- ===========================================================================
alter table public.dossiers_soins        enable row level security;
alter table public.consultations_dossier enable row level security;

drop policy if exists dossiers_soins_lecture on public.dossiers_soins;
create policy dossiers_soins_lecture on public.dossiers_soins
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists dossiers_soins_ecriture on public.dossiers_soins;
create policy dossiers_soins_ecriture on public.dossiers_soins
  for all
  using (public.profil_a_role(organisation_id, array[
           'CENTRE_MEDICAL_ACCUEIL', 'CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_ADMINISTRATIF',
           'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array[
           'CENTRE_MEDICAL_ACCUEIL', 'CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_ADMINISTRATIF',
           'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE']));

drop policy if exists consultations_dossier_lecture on public.consultations_dossier;
create policy consultations_dossier_lecture on public.consultations_dossier
  for select
  using (
    exists (
      select 1 from dossiers_soins d
      where d.id = consultations_dossier.dossier_soins_id
        and d.organisation_id = (
          select organisation_id from profils
          where id = auth.uid() and deleted_at is null
        )
    )
  );

-- v10 §1.2 — insertion d'une consultation : le médecin doit être un
-- CENTRE_MEDICAL_MEDECIN du même établissement que le dossier.
drop policy if exists consultations_dossier_medecin_valide on public.consultations_dossier;
create policy consultations_dossier_medecin_valide on public.consultations_dossier
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from dossiers_soins d
      join profils p on p.id = medecin_id
      where d.id = consultations_dossier.dossier_soins_id
        and p.role = 'CENTRE_MEDICAL_MEDECIN'
        and p.etablissement_id = d.etablissement_id
        and p.deleted_at is null
    )
  );
