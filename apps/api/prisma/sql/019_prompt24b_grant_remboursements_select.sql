-- ===========================================================================
-- PROMPT 24 (correctif b) — svc_adjudication : SELECT sur remboursements
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- 1) Calcul du plafond restant : il faut SOMMER les remboursements de l'année
--    pour un adhérent (jointure `remboursements` × `reclamations.adherent_id`).
--    → SELECT sur `reclamation_id`, `montant_rembourse`, `created_at`.
--
-- 2) `INSERT INTO remboursements (...) VALUES (...) RETURNING id` :
--    la clause RETURNING est évaluée comme un SELECT sur les colonnes renvoyées.
--    Sans SELECT sur `id`, l'INSERT échoue avec « permission denied for table
--    remboursements » (vérifié — test SQL direct en tant que svc_adjudication).
--    Le microservice a besoin de l'id du remboursement créé (traçabilité, lien
--    de retour vers la réclamation).
--    → SELECT sur `id` également.
--
-- On n'accorde PAS `decision`, `plafond_restant_apres`, `duree_traitement_ms` :
-- ce sont des données que le microservice ÉCRIT, il n'a pas à les relire.
--
-- Ne touche à aucun autre grant : tous les autres restent conformes au PROMPT 24.
-- ===========================================================================

grant select (id, reclamation_id, montant_rembourse, created_at)
  on public.remboursements to svc_adjudication;
