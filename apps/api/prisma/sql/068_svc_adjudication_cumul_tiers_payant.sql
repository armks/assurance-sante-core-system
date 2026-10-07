-- ===========================================================================
-- svc_adjudication : lecture des lignes de facturation tiers payant pour le
-- cumul du plafond annuel (ADR-005, « le Java calcule tout »).
--
-- Le plafond annuel d'une garantie est consommé par TOUT ce que l'assureur prend
-- en charge : remboursements adjugés + part assurance des lignes de facturation
-- tiers payant (actes facturés par l'établissement). Le microservice
-- (`sommeConsommeeAnnee`) remonte, pour une personne et une garantie :
--   lignes_facturation → actes_dossier → dossiers_soins (patient, police)
--   → polices (produit) → garanties (produit + catégorie de l'acte).
--
-- Grants COLONNE strictement nécessaires (même principe que 018 / 034 / 035) ;
-- la référence unique de l'état des grants est ARCHITECTURE-DECISIONS.md, ADR-003.
-- ===========================================================================

grant select (id, acte_dossier_id, montant_reclame, reportee_mois_suivant, created_at)
  on public.lignes_facturation to svc_adjudication;

grant select (dossier_soins_id, categorie_acte)
  on public.actes_dossier to svc_adjudication;

grant select (adherent_id, beneficiaire_id, police_id)
  on public.dossiers_soins to svc_adjudication;
