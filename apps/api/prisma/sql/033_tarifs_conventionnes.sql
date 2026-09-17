-- ===========================================================================
-- 033 — Tarifs conventionnés établissement/pharmacie × acte (v3 §5, plan
-- directeur phase 4.2 « Grilles tarifaires conventionnées ») — fonctionnalité
-- prévue mais jamais implémentée (confirmée par diagnostic) : `grilles_tarifaires`
-- (prisma/sql/006) ne couvre QUE la cotisation par tranche d'âge/souscripteur,
-- aucun lien avec un établissement ni un acte précis.
--
-- Usage adjudication (v3 §4) : lors du calcul du remboursement, si un tarif
-- conventionné existe pour le couple (établissement du dossier de soins, acte
-- réclamé), le montant facturé est plafonné par ce tarif AVANT application du
-- taux de couverture — min(montant_facture, tarif_convention). Absence de
-- tarif conventionné = comportement inchangé (taux appliqué au montant facturé
-- tel quel).
-- ===========================================================================

create table if not exists public.tarifs_conventionnes (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id),
  etablissement_id     uuid references public.etablissements_sante (id),
  pharmacie_id         uuid references public.pharmacies (id),
  referentiel_acte_id  uuid not null references public.referentiel_actes (id),
  tarif_convention     numeric(14, 2) not null check (tarif_convention >= 0),
  date_debut           date not null,
  date_fin             date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  -- exactement une cible : soit un établissement, soit une pharmacie (jamais
  -- les deux, jamais aucun) — même pattern que cotisations_cible_unique (006).
  constraint tarifs_conventionnes_cible_unique
    check ((etablissement_id is not null)::int + (pharmacie_id is not null)::int = 1),
  constraint tarifs_conventionnes_periode_coherente
    check (date_fin is null or date_fin >= date_debut)
);

create index if not exists tarifs_conventionnes_organisation_id_idx     on public.tarifs_conventionnes (organisation_id);
create index if not exists tarifs_conventionnes_etablissement_id_idx    on public.tarifs_conventionnes (etablissement_id);
create index if not exists tarifs_conventionnes_pharmacie_id_idx        on public.tarifs_conventionnes (pharmacie_id);
create index if not exists tarifs_conventionnes_referentiel_acte_id_idx on public.tarifs_conventionnes (referentiel_acte_id);

-- Un seul tarif ACTIF (deleted_at is null) par couple cible × acte — une
-- modification passe par UPDATE, pas par une deuxième ligne concurrente.
create unique index if not exists tarifs_conventionnes_etablissement_acte_actif_idx
  on public.tarifs_conventionnes (etablissement_id, referentiel_acte_id)
  where deleted_at is null and etablissement_id is not null;
create unique index if not exists tarifs_conventionnes_pharmacie_acte_actif_idx
  on public.tarifs_conventionnes (pharmacie_id, referentiel_acte_id)
  where deleted_at is null and pharmacie_id is not null;

-- ===========================================================================
-- RLS — même pattern que etablissements_sante/pharmacies (prisma/sql/009) :
-- lecture ouverte à l'organisation, écriture réservée à ASSUREUR_INFORMATIQUE.
-- NestJS passe par le rôle `postgres` (pooler) et contourne la RLS —
-- ProviderService applique la même règle (défense en profondeur).
-- ===========================================================================
alter table public.tarifs_conventionnes enable row level security;

drop policy if exists tarifs_conventionnes_lecture on public.tarifs_conventionnes;
create policy tarifs_conventionnes_lecture on public.tarifs_conventionnes
  for select
  using (
    organisation_id = (
      select organisation_id from profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists tarifs_conventionnes_ecriture on public.tarifs_conventionnes;
create policy tarifs_conventionnes_ecriture on public.tarifs_conventionnes
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

-- ===========================================================================
-- Accès du microservice d'adjudication (svc_adjudication, prisma/sql/018) —
-- lecture seule, colonnes déjà couvertes par un SELECT simple (pas de colonnes
-- sensibles ici, contrairement à reclamations).
-- ===========================================================================
grant select on public.tarifs_conventionnes to svc_adjudication;
