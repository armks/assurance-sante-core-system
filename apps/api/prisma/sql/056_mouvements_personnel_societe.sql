-- ===========================================================================
-- Mouvements de personnel (sortants/entrants) par la société cliente, avec
-- effet différé au mois suivant pour les entrants — cohérent avec la coupure
-- de facturation déjà posée (prisma/sql/052, `Adherent.dateValidation` avant
-- le 1er du mois facturé).
-- ===========================================================================

-- --- Sortants : nouveau statut intermédiaire PROPOSE_SORTANT --------------
-- Effet IMMÉDIAT une fois validé (SUSPENDU/RADIE) : à la différence des
-- entrants, rien dans ce prompt ne demande de reporter la date de sortie —
-- seuls les entrants sont explicitement différés au mois suivant.
alter table public.adherents drop constraint if exists adherents_statut_check;
alter table public.adherents
  add constraint adherents_statut_check
    check (statut in ('ACTIF', 'SUSPENDU', 'RADIE', 'PROPOSE_SORTANT'));

alter table public.adherents add column if not exists statut_sortant_cible text;
alter table public.adherents drop constraint if exists adherents_statut_sortant_cible_check;
alter table public.adherents
  add constraint adherents_statut_sortant_cible_check
    check (statut_sortant_cible is null or statut_sortant_cible in ('SUSPENDU', 'RADIE'));

alter table public.adherents add column if not exists motif_sortie text;

-- Cohérence : PROPOSE_SORTANT implique toujours une cible déjà choisie.
alter table public.adherents drop constraint if exists adherents_sortant_coherent;
alter table public.adherents
  add constraint adherents_sortant_coherent
    check (
      (statut = 'PROPOSE_SORTANT' and statut_sortant_cible is not null)
      or (statut != 'PROPOSE_SORTANT')
    );

-- --- Entrants : mois d'effet explicite sur un lot de propositions ---------
-- Renseigné uniquement pour un lot « mouvements de personnel » à effet
-- différé — NULL pour tout import/proposition existant (comportement
-- inchangé : `validerImportAdherents` ne stampe `dateValidation` que via
-- `validerAdherent`, séparément, comme aujourd'hui).
alter table public.imports_adherents add column if not exists mois_effet date;
