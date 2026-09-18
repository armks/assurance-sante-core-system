-- ===========================================================================
-- Complète le circuit de pré-autorisation à deux niveaux (prisma/sql/041) :
-- règle anti-répétition (14 jours) sur les analyses/examens, notes libres sur
-- le dossier/un acte, orientation d'un acte vers un établissement exécutant.
-- ===========================================================================

-- 1. Orientation — établissement EXÉCUTANT d'un acte, distinct de celui
--    d'origine (dossier.etablissement_id). Renseigné par ASSUREUR_EXPLOITATION
--    au moment de l'approbation ; utilisé ensuite pour le tarif conventionné.
alter table public.actes_dossier
  add column if not exists etablissement_execution_id uuid
    references public.etablissements_sante (id);

create index if not exists actes_dossier_etablissement_execution_id_idx
  on public.actes_dossier (etablissement_execution_id);

-- 2. Autorisation à usage unique du médecin conseil débloquant la règle
--    anti-répétition pour UN acte précis (même code) sur UN ticket précis.
create table if not exists public.autorisations_repetition_acte (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  ticket_soins_id  uuid not null references public.tickets_soins (id),
  code_acte        text not null,
  motif            text not null check (char_length(motif) >= 5),
  autorise_par_id  uuid not null references public.profils (id),
  utilisee         boolean not null default false,
  utilisee_le      timestamptz,
  created_at       timestamptz not null default now(),

  constraint autorisations_repetition_utilisation_coherente
    check (
      (utilisee = true and utilisee_le is not null)
      or (utilisee = false and utilisee_le is null)
    )
);

create index if not exists autorisations_repetition_organisation_id_idx
  on public.autorisations_repetition_acte (organisation_id);
create index if not exists autorisations_repetition_ticket_code_idx
  on public.autorisations_repetition_acte (ticket_soins_id, code_acte);

alter table public.autorisations_repetition_acte enable row level security;

drop policy if exists autorisations_repetition_lecture on public.autorisations_repetition_acte;
create policy autorisations_repetition_lecture on public.autorisations_repetition_acte
  for select
  to authenticated
  using (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE',
      'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists autorisations_repetition_ecriture on public.autorisations_repetition_acte;
create policy autorisations_repetition_ecriture on public.autorisations_repetition_acte
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']));

-- 3. Notes libres sur un dossier de soins (ou un acte précis). Écriture
--    réservée à l'exploitation et au médecin conseil ; lecture élargie à tout
--    rôle ayant déjà accès au dossier (personnel ASSUREUR habilité, organisation
--    entière ; personnel du centre médical, scopé à son établissement — même
--    périmètre que `CareEpisodeService.modeLectureDossiers`).
create table if not exists public.notes_dossier (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  dossier_soins_id uuid not null references public.dossiers_soins (id) on delete cascade,
  acte_dossier_id  uuid references public.actes_dossier (id),
  auteur_id        uuid not null references public.profils (id),
  contenu          text not null check (char_length(contenu) >= 3),
  created_at       timestamptz not null default now()
);

create index if not exists notes_dossier_organisation_id_idx
  on public.notes_dossier (organisation_id);
create index if not exists notes_dossier_dossier_soins_id_idx
  on public.notes_dossier (dossier_soins_id);

alter table public.notes_dossier enable row level security;

drop policy if exists notes_dossier_lecture on public.notes_dossier;
create policy notes_dossier_lecture on public.notes_dossier
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dossiers_soins ds
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where ds.id = notes_dossier.dossier_soins_id
        and p.organisation_id = notes_dossier.organisation_id
        and (
          p.role in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION',
                      'ASSUREUR_EXPLOITATION_CONJOINTE', 'ASSUREUR_INFORMATIQUE',
                      'ASSUREUR_MEDECIN_CONSEIL')
          or (p.etablissement_id is not null and p.etablissement_id = ds.etablissement_id)
        )
    )
  );

drop policy if exists notes_dossier_ecriture on public.notes_dossier;
create policy notes_dossier_ecriture on public.notes_dossier
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE', 'ASSUREUR_MEDECIN_CONSEIL'])
  )
  with check (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE', 'ASSUREUR_MEDECIN_CONSEIL'])
  );
