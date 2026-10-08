-- 073 — Cascades SENSIBLES passées en ON DELETE RESTRICT (ADR-007).
--
-- Une suppression PHYSIQUE d'un parent ne doit jamais emporter en silence des données
-- financières ou contractuelles. Avec RESTRICT, la base refuse elle-même la suppression
-- tant qu'un enfant existe : le contrôle applicatif (service des dépendances, 409) reste
-- la règle, la base est le dernier rempart.
--
--   dossiers_soins → factures_dossier, actes_dossier
--   polices        → cotisations, avenants
--   adherents      → beneficiaires
--   produits       → garanties, grilles_tarifaires
--   souscripteurs  → grilles_tarifaires, questionnaires_medicaux, plan_paiement_collectivite
--
-- Cascades TECHNIQUES conservées (enfant sans existence propre, listées dans ADR-007) :
-- consultations_dossier, tickets_soins, notes_dossier → dossiers_soins ;
-- lignes_ordonnance → ordonnances ; lignes_dispensation → dispensations_pharmacie ;
-- stock_medicaments_pharmacie, verifications_etablissement → pharmacies / établissements ;
-- paiements_groupes_factures → paiements_groupes ; tarification_individuelle → polices /
-- questionnaires ; membres_comite_gestion → souscripteurs ; licences_organisation →
-- organisations ; audit_log.organisation_id (SET NULL).
--
-- Aucune donnée ne peut bloquer cette migration : changer la règle ON DELETE ne revalide
-- pas les lignes existantes (et les clés étrangères garantissent déjà l'absence d'orphelin).
-- Idempotente : chaque contrainte est recréée sous le même nom.

BEGIN;

ALTER TABLE public.factures_dossier DROP CONSTRAINT IF EXISTS factures_dossier_dossier_soins_id_fkey,
  ADD CONSTRAINT factures_dossier_dossier_soins_id_fkey FOREIGN KEY (dossier_soins_id)
  REFERENCES public.dossiers_soins (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.actes_dossier DROP CONSTRAINT IF EXISTS actes_dossier_dossier_soins_id_fkey,
  ADD CONSTRAINT actes_dossier_dossier_soins_id_fkey FOREIGN KEY (dossier_soins_id)
  REFERENCES public.dossiers_soins (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.cotisations DROP CONSTRAINT IF EXISTS cotisations_police_id_fkey,
  ADD CONSTRAINT cotisations_police_id_fkey FOREIGN KEY (police_id)
  REFERENCES public.polices (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.avenants DROP CONSTRAINT IF EXISTS avenants_police_id_fkey,
  ADD CONSTRAINT avenants_police_id_fkey FOREIGN KEY (police_id)
  REFERENCES public.polices (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.beneficiaires DROP CONSTRAINT IF EXISTS beneficiaires_adherent_id_fkey,
  ADD CONSTRAINT beneficiaires_adherent_id_fkey FOREIGN KEY (adherent_id)
  REFERENCES public.adherents (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.garanties DROP CONSTRAINT IF EXISTS garanties_produit_id_fkey,
  ADD CONSTRAINT garanties_produit_id_fkey FOREIGN KEY (produit_id)
  REFERENCES public.produits (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.grilles_tarifaires DROP CONSTRAINT IF EXISTS grilles_tarifaires_produit_id_fkey,
  ADD CONSTRAINT grilles_tarifaires_produit_id_fkey FOREIGN KEY (produit_id)
  REFERENCES public.produits (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.grilles_tarifaires DROP CONSTRAINT IF EXISTS grilles_tarifaires_souscripteur_id_fkey,
  ADD CONSTRAINT grilles_tarifaires_souscripteur_id_fkey FOREIGN KEY (souscripteur_id)
  REFERENCES public.souscripteurs (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.questionnaires_medicaux DROP CONSTRAINT IF EXISTS questionnaires_medicaux_souscripteur_id_fkey,
  ADD CONSTRAINT questionnaires_medicaux_souscripteur_id_fkey FOREIGN KEY (souscripteur_id)
  REFERENCES public.souscripteurs (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public.plan_paiement_collectivite DROP CONSTRAINT IF EXISTS plan_paiement_collectivite_souscripteur_id_fkey,
  ADD CONSTRAINT plan_paiement_collectivite_souscripteur_id_fkey FOREIGN KEY (souscripteur_id)
  REFERENCES public.souscripteurs (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
