-- ===========================================================================
-- PROMPT 18 — Code de Consultation (1er des 4 codes anti-fraude, v8 §2)
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 18 » —
--   « endpoint de saisie côté établissement qui déclenche l'ouverture du
--     DossierSoins — AUCUNE autre voie de création du dossier ».
--   Checklist v19 : « Un dossier de soins ne peut être créé que via un code de
--   consultation validé ».
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
--
-- Le code est généré côté serveur (crypto sûr), envoyé à l'ADHÉRENT (APP/SMS) —
-- jamais visible de l'établissement. L'établissement le SAISIT ; la validation
-- ouvre le dossier automatiquement et passe le code en UTILISE_ETABLISSEMENT.
-- ===========================================================================

create table if not exists public.codes_consultation (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  adherent_id       uuid,
  beneficiaire_id   uuid,
  etablissement_id  uuid not null references public.etablissements_sante (id),
  police_id         uuid not null references public.polices (id),
  code              text not null unique
                      check (code ~ '^[A-Z0-9]{6,8}$'),
  date_emission     timestamptz not null default now(),
  date_expiration   timestamptz not null default (now() + interval '48 hours'),
  statut            text not null default 'EMIS'
                      check (statut in ('EMIS', 'CONFIRME_PATIENT',
                                        'UTILISE_ETABLISSEMENT', 'EXPIRE', 'ANNULE')),
  canal_envoi       text[] not null default array['APP', 'SMS'],
  -- rempli uniquement à la validation (ouverture du dossier)
  dossier_soins_id  uuid references public.dossiers_soins (id),
  created_at        timestamptz not null default now(),

  constraint codes_consultation_patient_present
    check (adherent_id is not null or beneficiaire_id is not null)
);

create index if not exists codes_consultation_organisation_id_idx on public.codes_consultation (organisation_id);
create index if not exists codes_consultation_adherent_id_idx     on public.codes_consultation (adherent_id);
create index if not exists codes_consultation_etablissement_id_idx on public.codes_consultation (etablissement_id);
create index if not exists codes_consultation_statut_idx          on public.codes_consultation (statut);

-- ===========================================================================
-- RLS — le code ne doit JAMAIS être lisible par l'établissement (seulement par
-- l'adhérent qui l'a demandé). La validation passe par NestJS (rôle `postgres`,
-- contourne la RLS) qui applique les contrôles ; l'établissement n'a aucune
-- policy de lecture sur cette table.
-- ===========================================================================
alter table public.codes_consultation enable row level security;

-- lecture : seul l'adhérent concerné (via son profil.adherent_id)
drop policy if exists codes_consultation_lecture_adherent on public.codes_consultation;
create policy codes_consultation_lecture_adherent on public.codes_consultation
  for select
  to authenticated
  using (
    adherent_id is not null
    and adherent_id = (
      select adherent_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

-- insertion : un rôle adhérent, pour lui-même
drop policy if exists codes_consultation_insert_adherent on public.codes_consultation;
create policy codes_consultation_insert_adherent on public.codes_consultation
  for insert
  to authenticated
  with check (
    statut = 'EMIS'
    and exists (
      select 1 from profils p
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.role in ('ADHERENT_TITULAIRE', 'SOUSCRIPTEUR_INDIVIDUEL')
        and p.organisation_id = codes_consultation.organisation_id
        and (codes_consultation.adherent_id is null
             or codes_consultation.adherent_id = p.adherent_id)
    )
  );
