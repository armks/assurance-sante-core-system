-- ===========================================================================
-- Remboursement pharmacie (diagnostic confirmé absent) :
--  1. lignes_dispensation.montant_assurance / montant_patient (garanties.taux_couverture) ;
--  2. reclamations peut désormais naître d'une dispensation pharmacie (pas
--     seulement d'un acte_dossier établissement) — acte_dossier_id devient
--     nullable, ajout de dispensation_id, exactement l'un des deux ;
--  3. délai de validité des ordonnances/codes d'ordonnance : 7 → 14 jours.
-- ===========================================================================

-- 1. lignes_dispensation — part assurance / part patient, calculées à la
--    préparation (PharmacyService.preparerDispensation), même logique que
--    simulerMontantActe (garanties.taux_couverture appliqué à prix_unitaire × quantite).
alter table public.lignes_dispensation
  add column if not exists montant_assurance numeric(14, 2) not null default 0
    check (montant_assurance >= 0),
  add column if not exists montant_patient numeric(14, 2) not null default 0
    check (montant_patient >= 0);

-- 2. reclamations — acte_dossier_id devient nullable, ajout de dispensation_id
--    (référence dispensations_pharmacie, PAS lignes_dispensation : « une
--    dispensation payée = un remboursement réclamé », montant cumulé sur
--    toutes ses lignes). Exactement une source par réclamation.
alter table public.reclamations
  alter column acte_dossier_id drop not null;
alter table public.reclamations
  add column if not exists dispensation_id uuid references public.dispensations_pharmacie (id);

alter table public.reclamations
  drop constraint if exists reclamations_source_exclusive;
alter table public.reclamations
  add constraint reclamations_source_exclusive
  check (
    (acte_dossier_id is not null and dispensation_id is null)
    or (acte_dossier_id is null and dispensation_id is not null)
  );

-- une seule réclamation vivante par acte_dossier (inchangé, désormais restreint
-- aux lignes où acte_dossier_id n'est pas null) / par dispensation.
drop index if exists reclamations_acte_dossier_unique;
create unique index reclamations_acte_dossier_unique
  on public.reclamations (acte_dossier_id)
  where deleted_at is null and acte_dossier_id is not null;
create unique index if not exists reclamations_dispensation_unique
  on public.reclamations (dispensation_id)
  where deleted_at is null and dispensation_id is not null;
create index if not exists reclamations_dispensation_id_idx
  on public.reclamations (dispensation_id);

-- 3. Délai de validité : 7 → 14 jours (nouvelles lignes uniquement — les
--    lignes déjà émises gardent leur date d'expiration déjà fixée).
alter table public.codes_ordonnance
  alter column date_expiration set default (now() + '14 days'::interval);
alter table public.ordonnances
  alter column date_validite set default (now() + '14 days'::interval);
