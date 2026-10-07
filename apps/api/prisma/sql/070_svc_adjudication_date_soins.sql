-- 070 — Période de cumul des plafonds annuels déterminée par la DATE DES SOINS (ADR-006,
-- amendement).
--
-- Jusqu'ici, le cumul retenait la date d'ENREGISTREMENT de la consommation
-- (remboursements.created_at = date d'adjudication ; lignes_facturation.created_at =
-- date de facturation) et la période en cours était celle du jour. Désormais une
-- consommation appartient à la période qui contient la date de survenance des soins :
--   - acte : actes_dossier.date_realisation, à défaut date_prescription ;
--   - dispensation : dispensations_pharmacie.date_paiement (délivrance : les lignes
--     passent à SERVIE au paiement), à défaut date_preparation.
-- svc_adjudication lit ces seules colonnes (aucune donnée médicale).
--
-- Idempotente : GRANT est rejouable.

BEGIN;

GRANT SELECT (date_realisation, date_prescription) ON public.actes_dossier TO svc_adjudication;
GRANT SELECT (dispensation_id) ON public.reclamations TO svc_adjudication;
GRANT SELECT (id, date_paiement, date_preparation) ON public.dispensations_pharmacie TO svc_adjudication;

COMMIT;
