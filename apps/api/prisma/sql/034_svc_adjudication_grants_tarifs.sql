-- ===========================================================================
-- 034 — Grants svc_adjudication manquants pour joindre le tarif conventionné
-- (033_tarifs_conventionnes.sql) depuis JdbcAdjudicationRepository.SQL_CONTEXTE.
--
-- La migration 018 (prisma/sql/018_prompt24_reclamations_svc_adjudication.sql)
-- n'accordait SELECT que sur garanties/grilles_tarifaires/referentiel_actes/
-- medicaments/polices — jamais sur dossiers_soins ni actes_dossier, nécessaires
-- pour retrouver l'établissement du dossier et le code de l'acte réclamé.
-- Colonnes précises uniquement (jamais *), même discipline que le grant
-- existant sur reclamations.
-- ===========================================================================

grant select (id, etablissement_id) on public.dossiers_soins to svc_adjudication;
grant select (id, code_acte)        on public.actes_dossier   to svc_adjudication;
