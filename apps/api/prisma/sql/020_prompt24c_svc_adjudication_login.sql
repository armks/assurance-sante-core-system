-- ===========================================================================
-- PROMPT 24 (correctif c) — svc_adjudication : LOGIN + SELECT(deleted_at) sur reclamations
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- 1) LOGIN — le microservice Java (adjudication-service/) ouvre une connexion
--    JDBC en tant que `svc_adjudication` (session DE SERVICE, jamais une session
--    utilisateur). Le PROMPT 24 partie 1 avait créé le rôle en NOLOGIN.
--    Le mot de passe est posé HORS de ce fichier (jamais versionné) :
--      ALTER ROLE svc_adjudication PASSWORD '<secret>';   (dashboard / commande manuelle)
--
-- 2) SELECT (deleted_at) — la requête de contexte de l'adjudication filtre
--    `WHERE r.deleted_at IS NULL` pour ne jamais adjuger une réclamation
--    soft-deleted. `deleted_at` s'ajoute donc aux 12 colonnes déjà accordées en
--    lecture sur `reclamations` (→ 13 colonnes). Vérifié : sans ce grant, le
--    SELECT échoue en `permission denied for column reclamations.deleted_at`
--    (test HTTP réel du microservice).
--
-- Aucun autre grant modifié.
-- ===========================================================================

alter role svc_adjudication login;

grant select (deleted_at) on public.reclamations to svc_adjudication;
