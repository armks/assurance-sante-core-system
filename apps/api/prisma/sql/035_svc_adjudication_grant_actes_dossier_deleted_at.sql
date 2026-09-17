-- ===========================================================================
-- 035 — Grant manquant : SQL_CONTEXTE référence `ad.deleted_at IS NULL` dans la
-- condition du LEFT JOIN actes_dossier (034), mais seules `id`/`code_acte`
-- avaient été accordées à svc_adjudication — confirmé par
-- "permission denied for table actes_dossier" en conditions réelles.
-- ===========================================================================

grant select (deleted_at) on public.actes_dossier to svc_adjudication;
