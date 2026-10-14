-- 096 — Validation des conventions ouverte à l'assurance informatique.
--
--   La contrainte `conventions_validation_tracee` (081) interdisait en base que `valide_par` soit la personne qui a saisi ou modifié
--   la convention. L'assurance informatique, qui saisit les conventions, peut désormais aussi les valider : la contrainte garde
--   l'exigence de traçabilité (validateur ET date) mais n'impose plus la séparation, qui reste contrôlée par le service pour les
--   rôles médecin conseil et direction (`ConventionsService.autoValidationInterdite`).
--
-- Idempotente : rejouable sans erreur.

ALTER TABLE public.conventions DROP CONSTRAINT IF EXISTS conventions_validation_tracee;
ALTER TABLE public.conventions ADD CONSTRAINT conventions_validation_tracee CHECK (
  statut <> 'VALIDEE' OR historique
  OR (valide_par IS NOT NULL AND date_validation IS NOT NULL)
);
