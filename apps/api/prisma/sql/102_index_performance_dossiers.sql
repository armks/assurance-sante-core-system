-- Performance : listes et statistiques de dossiers filtrées par société et période d'ouverture,
-- actes lus par dossier hors suppressions logiques. Idempotent.
create index if not exists dossiers_soins_org_ouverture_idx
  on public.dossiers_soins (organisation_id, date_ouverture desc)
  where deleted_at is null;

create index if not exists actes_dossier_dossier_actifs_idx
  on public.actes_dossier (dossier_soins_id)
  where deleted_at is null;
