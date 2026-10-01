-- ===========================================================================
-- Règle métier : un acte n'est facturable que s'il a été RÉALISÉ.
--
-- `actes_dossier.statut` (PRESCRIT | REALISE | ANNULE | LIQUIDE, prisma/sql/014)
-- restait jusqu'ici à PRESCRIT pour toujours : rien ne le faisait passer à
-- REALISE. Le médecin traitant (CENTRE_MEDICAL_MEDECIN) marque désormais l'acte
-- réalisé (`POST /preauthorization/actes/:id/realiser`, avec date_realisation),
-- et `genererFactureSelection` exclut tout acte non réalisé.
--
-- Défense en profondeur (garde NestJS + base) :
--   1. un acte REALISE / LIQUIDE porte toujours sa date de réalisation ;
--   2. une ligne de facturation ne peut être créée — ni rattachée à un nouveau
--      cycle de facturation — que pour un acte REALISE ou LIQUIDE.
-- ===========================================================================

alter table public.actes_dossier drop constraint if exists actes_dossier_realise_avec_date;
alter table public.actes_dossier
  add constraint actes_dossier_realise_avec_date
  check (statut not in ('REALISE', 'LIQUIDE') or date_realisation is not null);

create or replace function public.verifier_acte_realise_facturation()
returns trigger
language plpgsql
as $$
declare
  v_statut text;
begin
  select statut into v_statut
  from public.actes_dossier
  where id = new.acte_dossier_id;

  if v_statut is null then
    raise exception 'acte_dossier % introuvable', new.acte_dossier_id
      using errcode = 'check_violation';
  end if;

  if v_statut not in ('REALISE', 'LIQUIDE') then
    raise exception
      'L''acte % est % — seul un acte réalisé peut être facturé.',
      new.acte_dossier_id, v_statut
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_verifier_acte_realise_facturation on public.lignes_facturation;
create trigger trg_verifier_acte_realise_facturation
  before insert or update of facture_dossier_id on public.lignes_facturation
  for each row execute function public.verifier_acte_realise_facturation();
