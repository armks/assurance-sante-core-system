-- ===========================================================================
-- Facturation par sélection d'actes, paiement partiel (suite du 4e code
-- anti-fraude, v8 §5). Un dossier peut désormais avoir PLUSIEURS cycles de
-- facturation successifs (un cycle = une sélection d'actes, un code, un
-- règlement) plutôt qu'une facture unique par ticket de soins.
-- ===========================================================================

-- 1. factures_dossier n'est plus limitée à UNE facture par ticket.
alter table public.factures_dossier
  drop constraint if exists factures_dossier_ticket_soins_id_key;
create index if not exists factures_dossier_ticket_soins_id_idx
  on public.factures_dossier (ticket_soins_id);

-- 2. lignes_facturation — détail acte par acte d'un cycle de facturation.
create table if not exists public.lignes_facturation (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id),
  -- nullable : une ligne réclame un acte pour un cycle, mais reste
  -- ré-attachable à un cycle ultérieur (acte resélectionné après un cycle
  -- abandonné avant validation patient — pas de doublon de ligne A_PAYER).
  facture_dossier_id  uuid references public.factures_dossier (id),
  acte_dossier_id     uuid not null references public.actes_dossier (id),
  montant_reclame     numeric(14, 2) not null check (montant_reclame >= 0),
  statut              text not null default 'A_PAYER'
                        check (statut in ('A_PAYER', 'PAYE')),
  date_paiement       timestamptz,
  created_at          timestamptz not null default now(),

  constraint lignes_facturation_paiement_coherent
    check (
      (statut = 'PAYE' and date_paiement is not null)
      or (statut = 'A_PAYER' and date_paiement is null)
    )
);

create index if not exists lignes_facturation_organisation_id_idx
  on public.lignes_facturation (organisation_id);
create index if not exists lignes_facturation_facture_dossier_id_idx
  on public.lignes_facturation (facture_dossier_id);
create index if not exists lignes_facturation_acte_dossier_id_idx
  on public.lignes_facturation (acte_dossier_id);
create index if not exists lignes_facturation_statut_idx
  on public.lignes_facturation (statut);

-- Au plus UNE ligne A_PAYER active par acte à la fois — empêche toute
-- double-réclamation du même acte sur deux cycles simultanés.
create unique index if not exists lignes_facturation_acte_a_payer_uniq
  on public.lignes_facturation (acte_dossier_id)
  where statut = 'A_PAYER';

-- ===========================================================================
-- RLS — même esprit que factures_dossier (prisma/sql/015) : lecture pour
-- l'établissement du dossier, l'adhérent concerné, le personnel ASSUREUR ;
-- écriture réservée aux rôles ASSUREUR habilités (le NestJS contourne la RLS
-- via `postgres`, garde en profondeur uniquement).
-- ===========================================================================
alter table public.lignes_facturation enable row level security;

drop policy if exists lignes_facturation_lecture on public.lignes_facturation;
create policy lignes_facturation_lecture on public.lignes_facturation
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.actes_dossier ad
      join public.dossiers_soins ds on ds.id = ad.dossier_soins_id
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where ad.id = lignes_facturation.acte_dossier_id
        and p.organisation_id = lignes_facturation.organisation_id
        and (
          (p.adherent_id is not null and p.adherent_id = ds.adherent_id)
          or (p.etablissement_id is not null and p.etablissement_id = ds.etablissement_id)
          or p.role in ('ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE',
                        'ASSUREUR_COMPTABLE_ADJOINT', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_DIRECTION')
        )
    )
  );

drop policy if exists lignes_facturation_ecriture_assureur on public.lignes_facturation;
create policy lignes_facturation_ecriture_assureur on public.lignes_facturation
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
  )
  with check (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
  );
