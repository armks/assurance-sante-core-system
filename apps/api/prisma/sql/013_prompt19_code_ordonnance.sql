-- ===========================================================================
-- PROMPT 19 — Code Référence d'Ordonnance (2e des 4 codes anti-fraude, v8 §3)
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 19 » —
--   « Endpoint de saisie côté pharmacie qui débloque l'affichage du contenu de
--     l'ordonnance uniquement si le code est valide. »
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- Même principe que codes_consultation (PROMPT 18) : la pharmacie n'a AUCUNE
-- lecture directe des `ordonnances` ni des `codes_ordonnance` ; le contenu
-- (`lignes`) n'est révélé que par `validerCodeOrdonnance` (NestJS), après
-- présentation d'un code valide par une pharmacie.
-- ===========================================================================

-- --- ordonnances (table minimale — le référentiel medicaments viendra affiner) --
create table if not exists public.ordonnances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  dossier_soins_id  uuid not null references public.dossiers_soins (id),
  consultation_id   uuid not null references public.consultations_dossier (id),
  medecin_id        uuid not null references public.profils (id),
  -- liste de {medicament, dosage, posologie, duree, quantite} en JSON pour l'instant
  lignes            jsonb not null default '[]',
  statut            text not null default 'ACTIVE'
                      check (statut in ('ACTIVE', 'PARTIELLEMENT_DELIVREE',
                                        'COMPLETEMENT_DELIVREE', 'EXPIREE', 'ANNULEE')),
  date_prescription timestamptz not null default now(),
  date_validite     timestamptz not null default (now() + interval '7 days'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists ordonnances_organisation_id_idx on public.ordonnances (organisation_id);
create index if not exists ordonnances_dossier_idx         on public.ordonnances (dossier_soins_id);
create index if not exists ordonnances_consultation_idx    on public.ordonnances (consultation_id);
create index if not exists ordonnances_statut_idx          on public.ordonnances (statut);

-- --- codes_ordonnance ------------------------------------------------------
create table if not exists public.codes_ordonnance (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id),
  ordonnance_id            uuid references public.ordonnances (id),
  adherent_id              uuid,
  beneficiaire_id          uuid,
  code                     text not null unique
                             check (code ~ '^[A-Z0-9]{6,8}$'),
  date_emission            timestamptz not null default now(),
  -- aligné sur la validité de l'ordonnance (7 jours)
  date_expiration          timestamptz not null default (now() + interval '7 days'),
  statut                   text not null default 'EMIS'
                             check (statut in ('EMIS', 'PRESENTE_PHARMACIE',
                                               'UTILISE_PARTIEL', 'UTILISE_COMPLET',
                                               'EXPIRE', 'ANNULE')),
  pharmacie_utilisatrice_id uuid references public.pharmacies (id),
  created_at               timestamptz not null default now(),

  constraint codes_ordonnance_patient_present
    check (adherent_id is not null or beneficiaire_id is not null)
);

create index if not exists codes_ordonnance_organisation_id_idx on public.codes_ordonnance (organisation_id);
create index if not exists codes_ordonnance_adherent_id_idx     on public.codes_ordonnance (adherent_id);
create index if not exists codes_ordonnance_ordonnance_id_idx   on public.codes_ordonnance (ordonnance_id);
create index if not exists codes_ordonnance_statut_idx          on public.codes_ordonnance (statut);

-- ===========================================================================
-- RLS
--  - ordonnances : lecture par le médecin prescripteur, l'adhérent concerné, et
--    le personnel de l'assureur ; AUCUNE policy pour la pharmacie (elle passe
--    par validerCodeOrdonnance, NestJS, rôle `postgres` du pooler).
--  - codes_ordonnance : lecture réservée à l'adhérent concerné ; AUCUNE policy
--    pour la pharmacie.
-- Défense en profondeur — PreauthorizationService applique les mêmes gardes.
-- ===========================================================================
alter table public.ordonnances       enable row level security;
alter table public.codes_ordonnance  enable row level security;

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
                        'ASSUREUR_MEDECIN_CONSEIL')
        )
        and d.organisation_id = p.organisation_id
    )
  );

drop policy if exists ordonnances_insert on public.ordonnances;
create policy ordonnances_insert on public.ordonnances
  for insert
  to authenticated
  with check (
    public.profil_a_role(organisation_id, array['CENTRE_MEDICAL_MEDECIN'])
  );

drop policy if exists codes_ordonnance_lecture_adherent on public.codes_ordonnance;
create policy codes_ordonnance_lecture_adherent on public.codes_ordonnance
  for select
  to authenticated
  using (
    adherent_id is not null
    and adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists codes_ordonnance_insert on public.codes_ordonnance;
create policy codes_ordonnance_insert on public.codes_ordonnance
  for insert
  to authenticated
  with check (
    statut = 'EMIS'
    and public.profil_a_role(organisation_id, array['CENTRE_MEDICAL_MEDECIN'])
  );
