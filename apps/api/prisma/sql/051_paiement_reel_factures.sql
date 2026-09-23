-- ===========================================================================
-- Relie enfin le paiement RÉEL des factures mensuelles (établissement ET
-- pharmacie) et des paiements groupés aux comptes financiers de l'assureur —
-- point de convergence le plus sensible du système : jamais de statut PAYEE
-- sans un débit réel, tracé, exact (payerFacture, module payment/).
--
-- Nouveaux statuts, communs aux 3 tables concernées :
--   PARTIELLEMENT_REGLEE : paiement RÉEL partiel déjà effectué (montant_paye
--     < montant_total) — factures individuelles uniquement, jamais un groupe.
--   PAIEMENT_PROGRAMME : un paiement RÉEL a été programmé à une date future
--     (payerFacture avec dateProgrammee) mais N'A PAS ENCORE débité le compte
--     choisi — les 3/4 champs paiement_programme_* portent l'intention en
--     attente ; un nouvel appel à payerFacture (sans date future) confirme et
--     exécute le débit réel.
-- ===========================================================================

-- 1. factures_mensuelles_etablissement
alter table public.factures_mensuelles_etablissement
  add column if not exists montant_paye numeric(14, 2) not null default 0,
  add column if not exists paiement_programme_compte_id uuid references public.comptes_financiers (id),
  add column if not exists paiement_programme_montant numeric(14, 2),
  add column if not exists paiement_programme_preuves text[] not null default '{}',
  add column if not exists paiement_programme_date timestamptz;

alter table public.factures_mensuelles_etablissement
  drop constraint if exists factures_mensuelles_etablissement_statut_check;
alter table public.factures_mensuelles_etablissement
  add constraint factures_mensuelles_etablissement_statut_check
    check (statut in ('EN_PREPARATION', 'SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL',
                       'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE', 'PAYEE'));

alter table public.factures_mensuelles_etablissement
  drop constraint if exists factures_mensuelles_etablissement_verification_coherente;
alter table public.factures_mensuelles_etablissement
  add constraint factures_mensuelles_etablissement_verification_coherente
    check (
      (statut = 'EN_PREPARATION')
      or (statut = 'SOUMISE' and date_soumission is not null)
      or (statut in ('VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                      'PARTIELLEMENT_REGLEE', 'PAYEE')
          and date_soumission is not null and verifie_par_id is not null and date_verification is not null)
    );

drop policy if exists factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement;
create policy factures_mensuelles_etablissement_ecriture_comptable on public.factures_mensuelles_etablissement
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                    'PARTIELLEMENT_REGLEE', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VERIFIEE_MEDECIN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                    'PARTIELLEMENT_REGLEE', 'PAYEE')
  );

-- 2. factures_mensuelles_pharmacie
alter table public.factures_mensuelles_pharmacie
  add column if not exists montant_paye numeric(14, 2) not null default 0,
  add column if not exists paiement_programme_compte_id uuid references public.comptes_financiers (id),
  add column if not exists paiement_programme_montant numeric(14, 2),
  add column if not exists paiement_programme_preuves text[] not null default '{}',
  add column if not exists paiement_programme_date timestamptz;

alter table public.factures_mensuelles_pharmacie
  drop constraint if exists factures_mensuelles_pharmacie_statut_check;
alter table public.factures_mensuelles_pharmacie
  add constraint factures_mensuelles_pharmacie_statut_check
    check (statut in ('EN_PREPARATION', 'SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL',
                       'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE', 'PAYEE'));

alter table public.factures_mensuelles_pharmacie
  drop constraint if exists factures_mensuelles_pharmacie_validation_coherente;
alter table public.factures_mensuelles_pharmacie
  add constraint factures_mensuelles_pharmacie_validation_coherente
    check (
      (statut = 'EN_PREPARATION')
      or (statut = 'SOUMISE' and date_soumission is not null)
      or (statut in ('VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                      'PARTIELLEMENT_REGLEE', 'PAYEE')
          and date_soumission is not null and valide_par_id is not null and date_validation is not null)
    );

drop policy if exists factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie;
create policy factures_mensuelles_pharmacie_ecriture_comptable on public.factures_mensuelles_pharmacie
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                    'PARTIELLEMENT_REGLEE', 'PAYEE')
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_COMPTABLE'])
    and statut in ('SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL', 'PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME',
                    'PARTIELLEMENT_REGLEE', 'PAYEE')
  );

-- 3. paiements_groupes
alter table public.paiements_groupes
  add column if not exists paiement_programme_compte_id uuid references public.comptes_financiers (id),
  add column if not exists paiement_programme_preuves text[] not null default '{}',
  add column if not exists paiement_programme_date timestamptz;

alter table public.paiements_groupes
  drop constraint if exists paiements_groupes_statut_check;
alter table public.paiements_groupes
  add constraint paiements_groupes_statut_check
    check (statut in ('PROGRAMME', 'PAIEMENT_PROGRAMME', 'PAYE'));

alter table public.paiements_groupes
  drop constraint if exists paiements_groupes_paiement_coherent;
alter table public.paiements_groupes
  add constraint paiements_groupes_paiement_coherent
    check (
      (statut in ('PROGRAMME', 'PAIEMENT_PROGRAMME') and date_paiement is null)
      or (statut = 'PAYE' and date_paiement is not null)
    );
