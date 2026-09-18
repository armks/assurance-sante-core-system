-- ===========================================================================
-- Pré-autorisation à DEUX niveaux (restructure le circuit posé au Prompt 2,
-- ne le jette pas) : ASSUREUR_EXPLOITATION(_CONJOINTE) statue en premier
-- (APPROUVE / REFUSE / ESCALADE_MEDECIN_CONSEIL) ; l'escalade seule alimente
-- désormais la file du médecin conseil.
-- ===========================================================================

-- 1. Migration des données existantes AVANT de resserrer la contrainte —
--    tout ce qui attendait la validation (ancien circuit à un niveau) devient
--    « en attente du premier niveau » (exploitation), jamais perdu.
update public.actes_dossier
  set statut_preautorisation = 'EN_ATTENTE_EXPLOITATION'
  where statut_preautorisation = 'EN_ATTENTE_VALIDATION';

-- 2. Nouvel ensemble de statuts.
alter table public.actes_dossier
  drop constraint if exists actes_dossier_statut_preautorisation_check;
alter table public.actes_dossier
  add constraint actes_dossier_statut_preautorisation_check
  check (statut_preautorisation in (
    'NON_REQUISE',
    'EN_ATTENTE_EXPLOITATION',
    'EN_ATTENTE_MEDECIN_CONSEIL',
    'APPROUVEE',
    'APPROUVEE_PARTIELLEMENT',
    'REFUSEE'
  ));

-- 3. Approbation partielle (ex. 2 jours accordés sur 3 demandés, ou une
--    « mise en observation » à la place d'une hospitalisation) — `quantite`
--    (déjà existante) reste la quantité DEMANDÉE, inchangée.
alter table public.actes_dossier
  add column if not exists quantite_approuvee integer
    check (quantite_approuvee is null or quantite_approuvee >= 0),
  add column if not exists type_acte_approuve text,
  add column if not exists ticket_moderateur_ajuste numeric(5, 2)
    check (ticket_moderateur_ajuste is null
           or (ticket_moderateur_ajuste >= 0 and ticket_moderateur_ajuste <= 100));
