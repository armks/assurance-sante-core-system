-- ===========================================================================
-- 036 — `type_visite` sur dossiers_soins : choisi UNE FOIS, à l'intérieur du
-- dossier, APRÈS son ouverture (l'ouverture reste conditionnée au code de
-- consultation, inchangée). Nullable : NULL = pas encore choisi.
-- ===========================================================================

alter table public.dossiers_soins
  add column if not exists type_visite text
    check (type_visite is null or type_visite in (
      'CONSULTATION_GENERALISTE',
      'CONSULTATION_SPECIALISTE',
      'HOSPITALISATION_MEDICALE',
      'ANALYSES_EXAMENS_MEDICAUX',
      'ACTES_DENTAIRES',
      'CONSULTATION_DENTAIRE',
      'PRESCRIPTION_MEDICALE'
    ));
