-- ===========================================================================
-- Règle de fréquence des consultations (14 jours) : bloque l'ajout d'un acte
-- dans un dossier CONSULTATION_GENERALISTE/CONSULTATION_SPECIALISTE si un
-- AUTRE dossier du MÊME type_visite (compteurs strictement séparés) existe
-- déjà pour ce patient dans les 14 jours, tous établissements confondus.
-- Généralise `autorisations_repetition_acte` (prisma/sql/042) pour porter,
-- en plus du déblocage par code_acte déjà existant (analyses/examens), un
-- déblocage par type_visite (médecin conseil exclusivement, même principe).
-- ===========================================================================

alter table public.autorisations_repetition_acte
  alter column code_acte drop not null;

alter table public.autorisations_repetition_acte
  add column if not exists type_visite text;

alter table public.autorisations_repetition_acte
  drop constraint if exists autorisations_repetition_cible_exclusive;

alter table public.autorisations_repetition_acte
  add constraint autorisations_repetition_cible_exclusive
    check (
      (code_acte is not null and type_visite is null)
      or (code_acte is null and type_visite is not null)
    );

create index if not exists autorisations_repetition_ticket_type_visite_idx
  on public.autorisations_repetition_acte (ticket_soins_id, type_visite);
