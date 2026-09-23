-- ===========================================================================
-- Étend factures_mensuelles_etablissement/pharmacie :
-- 1. ASSUREUR_COMPTABLE lit désormais TOUTES les factures (tout statut,
--    organisation entière) — plus seulement celles déjà validées/vérifiées.
-- 2. decocherLigneContestee : une ligne en litige peut être retirée
--    manuellement d'une facture pour permettre sa validation malgré tout —
--    marquée reportee_mois_suivant, réintégrée automatiquement dès que le
--    litige associé n'est plus actif.
-- 3. paiements_groupes : regroupe plusieurs factures validées du même
--    bénéficiaire en un paiement programmé unique.
-- ===========================================================================

-- 1. Report automatique d'une ligne exclue pour litige.
alter table public.lignes_dispensation
  add column if not exists reportee_mois_suivant boolean not null default false;
alter table public.lignes_facturation
  add column if not exists reportee_mois_suivant boolean not null default false;

-- 2. Compteur de lignes reportées par facture (distingue une facture PAYEE
--    intégralement d'une facture PAYEE mais partiellement réglée).
alter table public.factures_mensuelles_pharmacie
  add column if not exists nb_lignes_reportees integer not null default 0;
alter table public.factures_mensuelles_etablissement
  add column if not exists nb_lignes_reportees integer not null default 0;

-- 3. paiements_groupes — bénéficiaire polymorphe (établissement OU pharmacie),
--    pas de FK directe possible, validée côté service.
create table if not exists public.paiements_groupes (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id),
  beneficiaire_type  text not null check (beneficiaire_type in ('ETABLISSEMENT', 'PHARMACIE')),
  beneficiaire_id    uuid not null,
  montant_total      numeric(14, 2) not null default 0,
  date_programmee    timestamptz not null default now(),
  date_paiement      timestamptz,
  statut             text not null default 'PROGRAMME' check (statut in ('PROGRAMME', 'PAYE')),
  created_at         timestamptz not null default now(),

  constraint paiements_groupes_paiement_coherent
    check (
      (statut = 'PROGRAMME' and date_paiement is null)
      or (statut = 'PAYE' and date_paiement is not null)
    )
);

create index if not exists paiements_groupes_organisation_id_idx
  on public.paiements_groupes (organisation_id);
create index if not exists paiements_groupes_beneficiaire_idx
  on public.paiements_groupes (beneficiaire_type, beneficiaire_id);
create index if not exists paiements_groupes_statut_idx
  on public.paiements_groupes (statut);

create table if not exists public.paiements_groupes_factures (
  id                                    uuid primary key default gen_random_uuid(),
  paiement_groupe_id                    uuid not null references public.paiements_groupes (id) on delete cascade,
  facture_mensuelle_etablissement_id    uuid references public.factures_mensuelles_etablissement (id),
  facture_mensuelle_pharmacie_id        uuid references public.factures_mensuelles_pharmacie (id),

  constraint paiements_groupes_factures_cible_exclusive
    check (
      (facture_mensuelle_etablissement_id is not null and facture_mensuelle_pharmacie_id is null)
      or (facture_mensuelle_etablissement_id is null and facture_mensuelle_pharmacie_id is not null)
    )
);

create index if not exists paiements_groupes_factures_groupe_id_idx
  on public.paiements_groupes_factures (paiement_groupe_id);
-- Une facture ne peut appartenir qu'à UN SEUL groupe de paiement à la fois.
create unique index if not exists paiements_groupes_factures_etab_uniq
  on public.paiements_groupes_factures (facture_mensuelle_etablissement_id)
  where facture_mensuelle_etablissement_id is not null;
create unique index if not exists paiements_groupes_factures_pharma_uniq
  on public.paiements_groupes_factures (facture_mensuelle_pharmacie_id)
  where facture_mensuelle_pharmacie_id is not null;

alter table public.paiements_groupes enable row level security;
alter table public.paiements_groupes_factures enable row level security;

-- Lecture/écriture des paiements groupés : réservées à ASSUREUR_COMPTABLE (et
-- ASSUREUR_INFORMATIQUE en lecture, même transparence que les factures
-- mensuelles elles-mêmes) — organisation entière.
drop policy if exists paiements_groupes_lecture on public.paiements_groupes;
create policy paiements_groupes_lecture on public.paiements_groupes
  for select
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE']));

drop policy if exists paiements_groupes_ecriture on public.paiements_groupes;
create policy paiements_groupes_ecriture on public.paiements_groupes
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE']));

drop policy if exists paiements_groupes_factures_lecture on public.paiements_groupes_factures;
create policy paiements_groupes_factures_lecture on public.paiements_groupes_factures
  for select
  to authenticated
  using (
    exists (
      select 1 from public.paiements_groupes pg
      where pg.id = paiements_groupes_factures.paiement_groupe_id
        and public.profil_a_role(pg.organisation_id, array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
    )
  );

drop policy if exists paiements_groupes_factures_ecriture on public.paiements_groupes_factures;
create policy paiements_groupes_factures_ecriture on public.paiements_groupes_factures
  for all
  to authenticated
  using (
    exists (
      select 1 from public.paiements_groupes pg
      where pg.id = paiements_groupes_factures.paiement_groupe_id
        and public.profil_a_role(pg.organisation_id, array['ASSUREUR_COMPTABLE'])
    )
  )
  with check (
    exists (
      select 1 from public.paiements_groupes pg
      where pg.id = paiements_groupes_factures.paiement_groupe_id
        and public.profil_a_role(pg.organisation_id, array['ASSUREUR_COMPTABLE'])
    )
  );

-- 4. RLS factures mensuelles — ASSUREUR_COMPTABLE lit désormais TOUT statut
--    (accès en revue global demandé), et peut écrire dès SOUMISE (nécessaire
--    à decocherLigneContestee, qui agit avant la validation/vérification).
drop policy if exists factures_mensuelles_pharmacie_lecture on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_lecture on public.factures_mensuelles_pharmacie
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = factures_mensuelles_pharmacie.organisation_id
        and (
          (p.pharmacie_id is not null and p.pharmacie_id = factures_mensuelles_pharmacie.pharmacie_id)
          or p.role in ('ASSUREUR_PHARMACIEN_CONSEIL', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE')
        )
    )
  );

drop policy if exists factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  );

drop policy if exists factures_mensuelles_etablissement_lecture on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_lecture on public.factures_mensuelles_etablissement
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = factures_mensuelles_etablissement.organisation_id
        and (
          (p.etablissement_id is not null and p.etablissement_id = factures_mensuelles_etablissement.etablissement_id)
          or p.role in ('ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE')
        )
    )
  );

drop policy if exists factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  );
