-- ===========================================================================
-- Mécanisme de contestation du médecin conseil sur les actes/hospitalisations/
-- analyses-examens (actes_dossier) — même principe que contestations_prescription
-- (prisma/sql/043), réutilisé pour ce nouveau domaine plutôt que redessiné,
-- mais réservé à ASSUREUR_MEDECIN_CONSEIL et scopé à l'établissement concerné
-- (CENTRE_MEDICAL_MEDECIN/COMPTABLE/ADMINISTRATIF) côté justification.
-- ===========================================================================

create table if not exists public.contestations_acte (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id),
  acte_dossier_id        uuid not null references public.actes_dossier (id),
  ouvert_par_id          uuid not null references public.profils (id),
  motif                  text not null check (char_length(motif) >= 5),
  date_ouverture         timestamptz not null default now(),
  date_limite            timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  statut                 text not null default 'OUVERT'
                           check (statut in ('OUVERT', 'JUSTIFICATION_RECUE', 'VALIDEE', 'REJETEE')),
  reponse_etablissement  text,
  pieces_justificatives  text[] not null default '{}',
  traite_par_id          uuid references public.profils (id),
  date_cloture           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint contestations_acte_cloture_coherente
    check (
      (statut in ('VALIDEE', 'REJETEE') and traite_par_id is not null and date_cloture is not null)
      or (statut in ('OUVERT', 'JUSTIFICATION_RECUE') and traite_par_id is null and date_cloture is null)
    )
);

create index if not exists contestations_acte_organisation_id_idx
  on public.contestations_acte (organisation_id);
create index if not exists contestations_acte_acte_dossier_id_idx
  on public.contestations_acte (acte_dossier_id);
create index if not exists contestations_acte_statut_idx
  on public.contestations_acte (statut);

-- Au plus une contestation NON TERMINALE (OUVERT/JUSTIFICATION_RECUE) active
-- par acte à la fois — empêche toute double-contestation simultanée.
create unique index if not exists contestations_acte_active_uniq
  on public.contestations_acte (acte_dossier_id)
  where statut in ('OUVERT', 'JUSTIFICATION_RECUE');

create or replace function public.contestations_acte_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_contestations_acte_updated_at on public.contestations_acte;
create trigger trg_contestations_acte_updated_at
  before update on public.contestations_acte
  for each row execute function public.contestations_acte_set_updated_at();

alter table public.contestations_acte enable row level security;

-- Lecture : le médecin conseil et le reste du personnel ASSUREUR habilité
-- (organisation entière), ET tout établissement du réseau (il doit voir les
-- contestations qui le concernent — la NestJS reste seule juge de l'écriture,
-- garde en profondeur uniquement, même schéma que contestations_prescription).
drop policy if exists contestations_acte_lecture on public.contestations_acte;
create policy contestations_acte_lecture on public.contestations_acte
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_acte.organisation_id
        and (
          p.etablissement_id is not null
          or p.role in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL')
        )
    )
  );

-- Écriture : ouverture/tranchage réservés au médecin conseil ; soumission de
-- justification réservée à l'établissement concerné (CENTRE_MEDICAL_MEDECIN/
-- COMPTABLE/ADMINISTRATIF, jamais ACCUEIL) — la NestJS vérifie en plus qu'il
-- s'agit bien de L'établissement concerné (`acteDossier.dossier.etablissementId`),
-- non modélisable simplement en RLS.
drop policy if exists contestations_acte_ecriture on public.contestations_acte;
create policy contestations_acte_ecriture on public.contestations_acte
  for all
  to authenticated
  using (
    public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL'])
    or exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_acte.organisation_id
        and p.etablissement_id is not null
        and p.role in ('CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF')
    )
  )
  with check (
    public.profil_a_role(organisation_id, array['ASSUREUR_MEDECIN_CONSEIL'])
    or exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.organisation_id = contestations_acte.organisation_id
        and p.etablissement_id is not null
        and p.role in ('CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF')
    )
  );
