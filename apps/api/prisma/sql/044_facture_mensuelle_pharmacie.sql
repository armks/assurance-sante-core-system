-- ===========================================================================
-- 1. Substitution de médicament — capacité ADDITIVE pour ASSUREUR_PHARMACIEN_
--    CONSEIL (jamais un remplacement de PHARMACIE_PHARMACIEN). L'audit
--    (côté NestJS) distingue déjà SUBSTITUTION_PHARMACIEN de
--    SUBSTITUTION_PHARMACIEN_CONSEIL — ici, seule la RLS est étendue.
-- ===========================================================================

drop policy if exists lignes_dispensation_substitution on public.lignes_dispensation;
create policy lignes_dispensation_substitution on public.lignes_dispensation
  for update
  to authenticated
  using (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and (
          (p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id and p.role = 'PHARMACIE_PHARMACIEN')
          or (
            p.role = 'ASSUREUR_PHARMACIEN_CONSEIL'
            and exists (
              select 1 from public.pharmacies ph
              where ph.id = dp.pharmacie_id and ph.organisation_id = p.organisation_id
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and (
          (p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id and p.role = 'PHARMACIE_PHARMACIEN')
          or (
            p.role = 'ASSUREUR_PHARMACIEN_CONSEIL'
            and exists (
              select 1 from public.pharmacies ph
              where ph.id = dp.pharmacie_id and ph.organisation_id = p.organisation_id
            )
          )
        )
    )
  );

-- ===========================================================================
-- 2. Consolidation mensuelle des factures pharmacie.
-- ===========================================================================

alter table public.lignes_dispensation
  add column if not exists facture_mensuelle_id uuid;
-- FK ajoutée après la création de la table (référence circulaire évitée).

create table if not exists public.factures_mensuelles_pharmacie (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id),
  pharmacie_id       uuid not null references public.pharmacies (id),
  periode            date not null,
  montant_total      numeric(14, 2) not null default 0,
  statut             text not null default 'EN_PREPARATION'
                       check (statut in ('EN_PREPARATION', 'SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL',
                                          'PROGRAMMEE_PAIEMENT', 'PAYEE')),
  date_soumission    timestamptz,
  valide_par_id      uuid references public.profils (id),
  date_validation    timestamptz,
  date_programmation timestamptz,
  date_paiement      timestamptz,
  created_at         timestamptz not null default now(),

  constraint factures_mensuelles_pharmacie_periode_premier_jour
    check (periode = date_trunc('month', periode)::date),
  constraint factures_mensuelles_pharmacie_validation_coherente
    check (
      (statut = 'EN_PREPARATION')
      or (statut = 'SOUMISE' and date_soumission is not null)
      or (statut in ('VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
          and date_soumission is not null and valide_par_id is not null and date_validation is not null)
    ),
  constraint factures_mensuelles_pharmacie_unique_periode unique (pharmacie_id, periode)
);

alter table public.lignes_dispensation
  add constraint lignes_dispensation_facture_mensuelle_id_fkey
    foreign key (facture_mensuelle_id) references public.factures_mensuelles_pharmacie (id);

create index if not exists lignes_dispensation_facture_mensuelle_id_idx
  on public.lignes_dispensation (facture_mensuelle_id);
create index if not exists factures_mensuelles_pharmacie_organisation_id_idx
  on public.factures_mensuelles_pharmacie (organisation_id);
create index if not exists factures_mensuelles_pharmacie_pharmacie_id_idx
  on public.factures_mensuelles_pharmacie (pharmacie_id);
create index if not exists factures_mensuelles_pharmacie_statut_idx
  on public.factures_mensuelles_pharmacie (statut);

alter table public.factures_mensuelles_pharmacie enable row level security;

-- Lecture : la pharmacie concernée voit toujours SES propres factures (tout
-- statut — elle doit suivre sa soumission) ; le pharmacien conseil voit tout
-- (organisation entière, tout statut — il doit voir les SOUMISE à valider) ;
-- ASSUREUR_COMPTABLE(_ADJOINT par héritage, profil_a_role résout un niveau de
-- parent)/ASSUREUR_INFORMATIQUE ne voient QUE VALIDEE_PHARMACIEN_CONSEIL et
-- au-delà — verrou explicite sur le statut, pas une convention d'écran.
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
          or p.role = 'ASSUREUR_PHARMACIEN_CONSEIL'
          or (
            public.profil_a_role(factures_mensuelles_pharmacie.organisation_id,
                                  array['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
            and factures_mensuelles_pharmacie.statut in
                ('VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
          )
        )
    )
  );

-- Écriture : soumission par la pharmacie (PHARMACIEN/COMPTABLE, jamais
-- caissière) tant qu'EN_PREPARATION/SOUMISE ; validation par le pharmacien
-- conseil ; programmation/paiement par ASSUREUR_COMPTABLE — verrouillé au
-- même palier que la lecture (jamais avant VALIDEE_PHARMACIEN_CONSEIL,
-- vérifié une seconde fois ici en plus du garde NestJS).
drop policy if exists factures_mensuelles_pharmacie_ecriture_pharmacie on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_ecriture_pharmacie on public.factures_mensuelles_pharmacie
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = factures_mensuelles_pharmacie.pharmacie_id
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE')
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = factures_mensuelles_pharmacie.pharmacie_id
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE')
    )
  );

drop policy if exists factures_mensuelles_pharmacie_ecriture_conseil on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_ecriture_conseil on public.factures_mensuelles_pharmacie
  for all
  to authenticated
  using (public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_PHARMACIEN_CONSEIL']));

drop policy if exists factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAYEE')
  );
