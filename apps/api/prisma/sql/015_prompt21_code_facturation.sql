-- ===========================================================================
-- PROMPT 21 — Code de Facturation (4e et DERNIER des 4 codes anti-fraude, v8 §5)
--             → clôt la Phase 6 (parcours de soins + système anti-fraude à 4 codes).
-- Réf. skill : 07-sequence-prompts-EXECUTION-v19.md « PROMPT 21 », checklist v19 :
--   « Aucune facture ne peut être réglée sans code_valide_par_patient = true ».
--
-- Appliqué le 2026-09-10 via `prisma db execute`.
--
-- Garde en profondeur : la garde applicative (PreauthorizationService.confirmerPaiement
-- refuse si code_valide_par_patient est false) est DOUBLÉE par un trigger
-- `verifier_facture_reglable()` qui bloque tout passage à REGLEE sans validation
-- patient — même en UPDATE SQL direct.
-- ===========================================================================

create table if not exists public.factures_dossier (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id),
  dossier_soins_id         uuid not null references public.dossiers_soins (id) on delete cascade,
  -- une seule facture par ticket de soins (= un épisode)
  ticket_soins_id          uuid not null unique references public.tickets_soins (id),
  etablissement_id         uuid not null references public.etablissements_sante (id),
  adherent_id              uuid,
  beneficiaire_id          uuid,
  montant_total            numeric(14, 2) not null default 0 check (montant_total >= 0),
  montant_assurance        numeric(14, 2) not null default 0 check (montant_assurance >= 0),
  montant_patient          numeric(14, 2) not null default 0 check (montant_patient >= 0),
  statut                   text not null default 'EMISE'
                             check (statut in ('EMISE', 'EN_VALIDATION', 'VALIDEE',
                                               'REGLEE', 'CONTESTEE')),
  -- généré seulement quand la facture est prête à être présentée à l'adhérent
  code_facturation         text unique
                             check (code_facturation is null
                                    or code_facturation ~ '^[A-Z0-9]{6,8}$'),
  code_valide_par_patient   boolean not null default false,
  date_validation_patient   timestamptz,
  date_reglement           timestamptz,
  regle_par                uuid references public.profils (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint factures_dossier_patient_present
    check (adherent_id is not null or beneficiaire_id is not null),
  -- validation patient => horodatage
  constraint factures_dossier_validation_coherente
    check (code_valide_par_patient = false or date_validation_patient is not null)
);

create index if not exists factures_dossier_organisation_id_idx on public.factures_dossier (organisation_id);
create index if not exists factures_dossier_adherent_id_idx     on public.factures_dossier (adherent_id);
create index if not exists factures_dossier_etablissement_id_idx on public.factures_dossier (etablissement_id);
create index if not exists factures_dossier_statut_idx          on public.factures_dossier (statut);

-- ===========================================================================
-- Trigger : interdit tout passage à REGLEE sans code_valide_par_patient = true.
-- ===========================================================================
create or replace function public.verifier_facture_reglable()
returns trigger
language plpgsql
as $$
begin
  if new.statut = 'REGLEE' and old.statut is distinct from 'REGLEE' then
    if new.code_valide_par_patient is not true then
      raise exception
        'Facture % : règlement impossible tant que le code de facturation n''a pas été validé par l''adhérent (anti-fraude, v8 §5).',
        new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verifier_facture_reglable on public.factures_dossier;
create trigger trg_verifier_facture_reglable
  before update on public.factures_dossier
  for each row execute function public.verifier_facture_reglable();

-- ===========================================================================
-- RLS
--  - lecture : l'établissement (sa propre facture), l'adhérent concerné, le
--    personnel de l'assureur ;
--  - écriture : rôles ASSUREUR habilités (le NestJS contourne la RLS via
--    `postgres` — c'est aussi la « génération automatique par le système ») ;
--  - l'adhérent peut mettre à jour SA facture (validation du code).
-- ===========================================================================
alter table public.factures_dossier enable row level security;

drop policy if exists factures_dossier_lecture on public.factures_dossier;
create policy factures_dossier_lecture on public.factures_dossier
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = factures_dossier.organisation_id
        and (
          -- adhérent concerné
          (p.adherent_id is not null and p.adherent_id = factures_dossier.adherent_id)
          -- établissement propriétaire de la facture
          or (p.etablissement_id is not null and p.etablissement_id = factures_dossier.etablissement_id)
          -- personnel de l'assureur
          or p.role in ('ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE',
                        'ASSUREUR_COMPTABLE_ADJOINT', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_DIRECTION')
        )
    )
  );

drop policy if exists factures_dossier_ecriture_assureur on public.factures_dossier;
create policy factures_dossier_ecriture_assureur on public.factures_dossier
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
  )
  with check (
    public.profil_a_role(organisation_id, array[
      'ASSUREUR_EXPLOITATION', 'ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'])
  );

drop policy if exists factures_dossier_validation_adherent on public.factures_dossier;
create policy factures_dossier_validation_adherent on public.factures_dossier
  for update
  to authenticated
  using (
    adherent_id is not null
    and adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  )
  with check (
    adherent_id is not null
    and adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );
