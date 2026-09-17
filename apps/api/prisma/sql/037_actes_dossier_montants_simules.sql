-- ===========================================================================
-- 037 — Simulation indicative de remboursement au moment de l'ajout d'un acte
-- (ajouterActe, preauthorization.service.ts) : tarifs_conventionnes (si
-- existant pour l'établissement/l'acte) × garanties.tauxCouverture, calculée
-- et affichée IMMÉDIATEMENT à l'établissement, AVANT toute adjudication
-- définitive par le microservice Java (qui garde le dernier mot — reclamations
-- + remboursements, calcul BigDecimal exact, franchise/plafonds compris).
-- Purement indicatif : NULL si l'acte n'a pas de codeActe renseigné ou ne
-- correspond à aucun acte homologué du référentiel (pas de tarif à simuler).
-- ===========================================================================

alter table public.actes_dossier
  add column if not exists montant_simule_assurance numeric(14, 2),
  add column if not exists montant_simule_patient    numeric(14, 2),
  add column if not exists ticket_moderateur_simule   numeric(14, 2);
