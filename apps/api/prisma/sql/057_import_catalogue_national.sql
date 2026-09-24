-- ===========================================================================
-- Import en masse par Excel du catalogue national (referentiel_national_actes
-- / referentiel_national_medicaments), réservé EXCLUSIVEMENT à SUPERADMIN_
-- PRINCIPAL — même pattern que imports_adherents (prisma/sql/053) : import et
-- validation séparés, AUCUNE entrée créée/modifiée avant validation explicite.
--
-- Pas d'organisation_id : le catalogue national est cross-tenant par nature
-- (comme referentiel_national_actes/medicaments et parametres_plateforme,
-- prisma/sql/017), même politique RLS que ces deux tables.
-- ===========================================================================

create table if not exists public.imports_catalogue_national (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('ACTES', 'MEDICAMENTS')),
  fichier_nom       text not null,
  statut            text not null default 'EN_ATTENTE_VALIDATION'
                      check (statut in ('EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE')),
  nb_lignes_total   integer not null default 0,
  nb_lignes_valides integer not null default 0,
  nb_lignes_erreur  integer not null default 0,
  -- Lignes déjà validées, discriminées par `type` de l'import — chaque entrée
  -- porte `estMiseAJour`/`idExistant` : une mise à jour d'un doublon détecté
  -- (code / dénomination commune déjà présent) au lieu d'une nouvelle entrée,
  -- jamais une erreur bloquante (v. commentaire prompt). Consommées une seule
  -- fois, à `validerImportCatalogue`.
  lignes_valides    jsonb not null default '[]',
  -- Array JSON {ligne, donnees, erreurs[]} — une entrée par ligne rejetée.
  erreurs_detail    jsonb not null default '[]',
  importe_par       uuid not null references public.profils (id),
  valide_par        uuid references public.profils (id),
  date_validation   timestamptz,
  created_at        timestamptz not null default now(),

  constraint imports_catalogue_national_validation_coherente
    check (
      (statut = 'EN_ATTENTE_VALIDATION' and valide_par is null and date_validation is null)
      or (statut in ('VALIDE', 'REJETE') and valide_par is not null and date_validation is not null)
    )
);

create index if not exists imports_catalogue_national_type_idx   on public.imports_catalogue_national (type);
create index if not exists imports_catalogue_national_statut_idx on public.imports_catalogue_national (statut);

alter table public.imports_catalogue_national enable row level security;

-- Lecture ET écriture EXCLUSIVEMENT SUPERADMIN_PRINCIPAL — pas de double
-- validation ici (contrairement à imports_adherents) : le Super Admin est
-- déjà la plus haute autorité sur cette donnée cross-tenant.
drop policy if exists imports_catalogue_national_superadmin_only on public.imports_catalogue_national;
create policy imports_catalogue_national_superadmin_only on public.imports_catalogue_national
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
