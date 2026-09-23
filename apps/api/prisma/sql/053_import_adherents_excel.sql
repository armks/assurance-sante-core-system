-- ===========================================================================
-- Import en masse d'adhérents depuis un fichier Excel, pour une société
-- cliente déjà créée avec sa police/formule établie.
--
-- 1. adherents.sexe devient nullable — l'import Excel ne collecte pas ce
--    champ (colonnes nom/prénom/téléphone/email/date de naissance
--    uniquement) ; reste requis pour la création manuelle (CreateAdherentDto,
--    validation applicative). email/telephone ajoutés — email UNIQUE quand
--    renseigné (nombreux adhérents existants n'en ont pas).
-- 2. imports_adherents : AUCUN adhérent créé à l'import — reste EN_ATTENTE_
--    VALIDATION, lignes déjà validées portées en JSON (lignes_valides),
--    erreurs listées précisément (erreurs_detail) sans bloquer les lignes
--    valides. Seul validerImportAdherents crée les Adherent réels + cartes.
-- ===========================================================================

alter table public.adherents
  alter column sexe drop not null;

alter table public.adherents
  add column if not exists email text,
  add column if not exists telephone text;

drop index if exists adherents_email_uniq;
create unique index adherents_email_uniq on public.adherents (email) where email is not null;

create table if not exists public.imports_adherents (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  souscripteur_id   uuid not null references public.souscripteurs (id),
  fichier_nom       text not null,
  statut            text not null default 'EN_ATTENTE_VALIDATION'
                      check (statut in ('EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE')),
  nb_lignes_total   integer not null default 0,
  nb_lignes_valides integer not null default 0,
  nb_lignes_erreur  integer not null default 0,
  lignes_valides    jsonb not null default '[]',
  erreurs_detail    jsonb not null default '[]',
  importe_par       uuid not null references public.profils (id),
  valide_par        uuid references public.profils (id),
  date_validation   timestamptz,
  created_at        timestamptz not null default now(),

  constraint imports_adherents_validation_coherente
    check (
      (statut = 'EN_ATTENTE_VALIDATION' and valide_par is null and date_validation is null)
      or (statut in ('VALIDE', 'REJETE') and valide_par is not null and date_validation is not null)
    )
);

create index if not exists imports_adherents_organisation_id_idx on public.imports_adherents (organisation_id);
create index if not exists imports_adherents_souscripteur_id_idx on public.imports_adherents (souscripteur_id);
create index if not exists imports_adherents_statut_idx on public.imports_adherents (statut);

alter table public.imports_adherents enable row level security;

-- Lecture : les 3 rôles impliqués (créateurs INFORMATIQUE/COMPTABLE, validateur
-- INFORMATIQUE/EXPLOITATION), organisation entière.
drop policy if exists imports_adherents_lecture on public.imports_adherents;
create policy imports_adherents_lecture on public.imports_adherents
  for select
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE', 'ASSUREUR_EXPLOITATION']));

-- Création (import) : INFORMATIQUE / COMPTABLE uniquement.
drop policy if exists imports_adherents_insertion on public.imports_adherents;
create policy imports_adherents_insertion on public.imports_adherents
  for insert
  to authenticated
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE']));

-- Validation (mise à jour du statut) : INFORMATIQUE / EXPLOITATION uniquement.
drop policy if exists imports_adherents_validation on public.imports_adherents;
create policy imports_adherents_validation on public.imports_adherents
  for update
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION']));
