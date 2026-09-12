-- ===========================================================================
-- 028 — Reconstruction de l'écran caissière (vrai parcours) : 2 ajustements.
--
-- 1. Lecture du stock ouverte aux 3 rôles PHARMACIE (l'ÉCRITURE reste
--    réservée au seul pharmacien, policy stock_medicaments_pharmacie_acces
--    inchangée) : la caissière doit pouvoir vérifier, au moment de la
--    dispensation, si un médicament est en stock et à quel prix — sans quoi
--    elle ne peut pas cocher/pré-remplir les lignes dispensables. Clarification
--    métier reçue lors de cette reconstruction (auparavant lecture aussi
--    réservée au pharmacien, migration 026).
-- 2. Aucun changement de schéma requis pour `GET /pharmacy/dispensations/:id`
--    (détail d'une dispensation, scopé pharmacieId) — la RLS de lecture posée
--    en 026 (dispensations_pharmacie_lecture) couvre déjà ce cas.
-- ===========================================================================

drop policy if exists stock_medicaments_pharmacie_lecture_pharmacie on public.stock_medicaments_pharmacie;
create policy stock_medicaments_pharmacie_lecture_pharmacie on public.stock_medicaments_pharmacie
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = stock_medicaments_pharmacie.pharmacie_id
    )
  );
