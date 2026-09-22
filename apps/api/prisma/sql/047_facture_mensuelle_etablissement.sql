-- ===========================================================================
-- Consolidation mensuelle des factures établissement — miroir de
-- factures_mensuelles_pharmacie (prisma/sql/044), adapté à l'établissement :
-- agrège les lignes_facturation déjà PAYE (patient a confirmé + réglé son
-- code de facturation, même principe que dispensations_pharmacie = PAYEE) en
-- un cycle de paiement mensuel unique assureur → établissement.
-- ===========================================================================

alter table public.lignes_facturation
  add column if not exists facture_mensuelle_etablissement_id uuid;
-- FK ajoutée après la création de la table (référence circulaire évitée).

create table if not exists public.factures_mensuelles_etablissement (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id),
  etablissement_id   uuid not null references public.etablissements_sante (id),
  periode            date not null,
  montant_total      numeric(14, 2) not null default 0,
  statut             text not null default 'EN_PREPARATION'
                       check (statut in ('EN_PREPARATION', 'SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL',
                                          'PROGRAMMEE_PAIEMENT', 'PAYEE')),
  date_soumission    timestamptz,
  verifie_par_id     uuid references public.profils (id),
  date_verification  timestamptz,
  date_programmation timestamptz,
  date_paiement      timestamptz,
  created_at         timestamptz not null default now(),

  constraint factures_mensuelles_etablissement_periode_premier_jour
    check (periode = date_trunc('month', periode)::date),
  constraint factures_mensuelles_etablissement_verification_coherente
    check (
      (statut = 'EN_PREPARATION')
      or (statut = 'SOUMISE' and date_soumission is not null)
      or (statut in ('VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
          and date_soumission is not null and verifie_par_id is not null and date_verification is not null)
    ),
  constraint factures_mensuelles_etablissement_unique_periode unique (etablissement_id, periode)
);

alter table public.lignes_facturation
  add constraint lignes_facturation_facture_mensuelle_etablissement_id_fkey
    foreign key (facture_mensuelle_etablissement_id) references public.factures_mensuelles_etablissement (id);

create index if not exists lignes_facturation_facture_mensuelle_etablissement_id_idx
  on public.lignes_facturation (facture_mensuelle_etablissement_id);
create index if not exists factures_mensuelles_etablissement_organisation_id_idx
  on public.factures_mensuelles_etablissement (organisation_id);
create index if not exists factures_mensuelles_etablissement_etablissement_id_idx
  on public.factures_mensuelles_etablissement (etablissement_id);
create index if not exists factures_mensuelles_etablissement_statut_idx
  on public.factures_mensuelles_etablissement (statut);

alter table public.factures_mensuelles_etablissement enable row level security;

-- Lecture : l'établissement concerné voit toujours SES propres factures (tout
-- statut, tout rôle du centre médical — il doit suivre sa soumission) ; le
-- médecin conseil voit tout (organisation entière, tout statut — il doit voir
-- les SOUMISE à vérifier) ; ASSUREUR_COMPTABLE(_ADJOINT par héritage)/
-- ASSUREUR_INFORMATIQUE ne voient QUE VERIFIEE_MEDECIN_CONSEIL et au-delà —
-- verrou explicite sur le statut, pas une convention d'écran.
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
          or p.role = 'ASSUREUR_MEDECIN_CONSEIL'
          or (
            public.profil_a_role(factures_mensuelles_etablissement.organisation_id,
                                  array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
            and factures_mensuelles_etablissement.statut in
                ('VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
          )
        )
    )
  );

-- Écriture : soumission par l'établissement (CENTRE_MEDICAL_COMPTABLE/
-- ADMINISTRATIF, jamais MEDECIN ni ACCUEIL) tant qu'EN_PREPARATION/SOUMISE ;
-- vérification par le médecin conseil ; programmation/paiement par
-- ASSUREUR_COMPTABLE — verrouillé au même palier que la lecture (jamais avant
-- VERIFIEE_MEDECIN_CONSEIL, vérifié une seconde fois ici en plus du garde NestJS).
drop policy if exists factures_mensuelles_etablissement_ecriture_etab on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_ecriture_etab on public.factures_mensuelles_etablissement
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.etablissement_id is not null and p.etablissement_id = factures_mensuelles_etablissement.etablissement_id
        and p.role in ('CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF')
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.etablissement_id is not null and p.etablissement_id = factures_mensuelles_etablissement.etablissement_id
        and p.role in ('CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF')
    )
  );

drop policy if exists factures_mensuelles_etablissement_ecriture_conseil on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_ecriture_conseil on public.factures_mensuelles_etablissement
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL']));

drop policy if exists factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  );
