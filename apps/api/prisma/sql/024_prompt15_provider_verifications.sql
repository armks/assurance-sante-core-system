-- ===========================================================================
-- PROMPT 15 — Automatisation du réseau de soins (v8 §9)
--
-- Réf. : plan directeur v9 §4.3 (géocodage à la saisie, vérification périodique,
-- détection de doublons). Ferme la Phase 4.
--
-- Appliqué le 2026-09-10 via `prisma db execute --file`.
--
-- Ce prompt ajoute :
--   * `verifications_etablissement` : historique des vérifications d'un
--     établissement OU d'une pharmacie (une seule des deux FK renseignée) ;
--   * sur `etablissements_sante` et `pharmacies` : `verification_statut`
--     (dernier état connu / alerte) et `date_derniere_verification`.
-- Le géocodage (Nominatim) et la détection de doublons sont purement applicatifs
-- (ProviderService) — rien à faire en base.
-- ===========================================================================

alter table public.etablissements_sante
  add column if not exists verification_statut text
    check (verification_statut is null
           or verification_statut in ('ACTIF', 'FERME', 'DEMENAGE', 'A_REVERIFIER')),
  add column if not exists date_derniere_verification timestamptz;

alter table public.pharmacies
  add column if not exists verification_statut text
    check (verification_statut is null
           or verification_statut in ('ACTIF', 'FERME', 'DEMENAGE', 'A_REVERIFIER')),
  add column if not exists date_derniere_verification timestamptz;

create index if not exists etablissements_sante_verification_statut_idx
  on public.etablissements_sante (verification_statut);
create index if not exists pharmacies_verification_statut_idx
  on public.pharmacies (verification_statut);

-- --- Historique des vérifications ------------------------------------------
create table if not exists public.verifications_etablissement (
  id                uuid primary key default gen_random_uuid(),
  etablissement_id  uuid references public.etablissements_sante (id) on delete cascade,
  pharmacie_id      uuid references public.pharmacies (id) on delete cascade,
  date_verification timestamptz not null default now(),
  methode           text not null
                      check (methode in ('APPEL_TELEPHONIQUE', 'VISITE_TERRAIN', 'AUTO_DECLARATIF')),
  statut_confirme   text not null
                      check (statut_confirme in ('ACTIF', 'FERME', 'DEMENAGE', 'A_REVERIFIER')),
  verifie_par       uuid references public.profils (id),
  created_at        timestamptz not null default now(),

  -- exactement une cible (établissement XOR pharmacie)
  constraint verifications_etablissement_cible_unique
    check ((etablissement_id is not null) <> (pharmacie_id is not null))
);

create index if not exists verifications_etablissement_etab_idx
  on public.verifications_etablissement (etablissement_id, date_verification desc);
create index if not exists verifications_etablissement_pharm_idx
  on public.verifications_etablissement (pharmacie_id, date_verification desc);

-- --- RLS -----------------------------------------------------------------
-- Lecture : personnel de l'organisation propriétaire (résolue via la cible).
-- Écriture : ASSUREUR_INFORMATIQUE (même règle que le réseau lui-même).
-- NestJS passe par `postgres` (pooler) et contourne la RLS.
alter table public.verifications_etablissement enable row level security;

drop policy if exists verifications_etablissement_lecture on public.verifications_etablissement;
create policy verifications_etablissement_lecture on public.verifications_etablissement
  for select
  using (
    exists (
      select 1 from public.etablissements_sante e
      where e.id = verifications_etablissement.etablissement_id
        and e.organisation_id = (
          select organisation_id from public.profils
          where id = auth.uid() and deleted_at is null
        )
    )
    or exists (
      select 1 from public.pharmacies p
      where p.id = verifications_etablissement.pharmacie_id
        and p.organisation_id = (
          select organisation_id from public.profils
          where id = auth.uid() and deleted_at is null
        )
    )
  );

drop policy if exists verifications_etablissement_ecriture on public.verifications_etablissement;
create policy verifications_etablissement_ecriture on public.verifications_etablissement
  for all
  using (
    public.profil_a_role(
      coalesce(
        (select organisation_id from public.etablissements_sante e where e.id = verifications_etablissement.etablissement_id),
        (select organisation_id from public.pharmacies p where p.id = verifications_etablissement.pharmacie_id)
      ),
      array['ASSUREUR_INFORMATIQUE']
    )
  )
  with check (
    public.profil_a_role(
      coalesce(
        (select organisation_id from public.etablissements_sante e where e.id = verifications_etablissement.etablissement_id),
        (select organisation_id from public.pharmacies p where p.id = verifications_etablissement.pharmacie_id)
      ),
      array['ASSUREUR_INFORMATIQUE']
    )
  );
