-- ===========================================================================
-- PROMPT 12 — Module member : adherents + beneficiaires (v9 phase 3)
--
-- Réf. : plan directeur v9 §3 phase 3 ; audit de consolidation 2026-09-10
-- (dette : `adherent_id` / `beneficiaire_id` circulaient en UUID bruts non
-- contraints dans 8 tables). Ce prompt matérialise les 2 tables et pose les
-- vraies clés étrangères.
--
-- Appliqué le 2026-09-10 via `prisma db execute --file`.
--
-- Ordre : (1) séquences + tables + index + RLS  →  (2) réconciliation des
-- données de test existantes (3 lignes référençaient des UUID fictifs)  →
-- (3) contraintes FK sur les 8 tables. La réconciliation est gardée : sur un
-- environnement neuf, les blocs `if exists (…)` ne font rien.
-- ===========================================================================

-- 1. SÉQUENCES de numérotation -------------------------------------------
create sequence if not exists public.adherents_numero_seq;
create sequence if not exists public.cartes_membre_numero_seq;  -- partagée adherents + beneficiaires

-- 2. TABLE adherents ----------------------------------------------------
create table if not exists public.adherents (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id),
  souscripteur_id       uuid not null references public.souscripteurs (id),
  police_id             uuid references public.polices (id),
  numero_adherent       text not null unique
                          default ('ADH-' || to_char(now(), 'YYYY') || '-' ||
                                   lpad(nextval('public.adherents_numero_seq')::text, 6, '0')),
  nom                   text not null,
  prenom                text not null,
  date_naissance        date not null,
  sexe                  text not null check (sexe in ('M', 'F')),
  statut                text not null default 'ACTIF'
                          check (statut in ('ACTIF', 'SUSPENDU', 'RADIE')),
  numero_carte          text not null unique
                          default ('CM-' || lpad(nextval('public.cartes_membre_numero_seq')::text, 10, '0')),
  iban_ou_rib           text,
  banque_nom            text,
  mode_paiement_prefere text check (mode_paiement_prefere in ('MOBILE_MONEY', 'VIREMENT_BANCAIRE')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index if not exists adherents_organisation_id_idx on public.adherents (organisation_id);
create index if not exists adherents_souscripteur_id_idx on public.adherents (souscripteur_id);
create index if not exists adherents_police_id_idx       on public.adherents (police_id);
create index if not exists adherents_statut_idx          on public.adherents (statut);
create index if not exists adherents_deleted_at_idx      on public.adherents (deleted_at);

-- 3. TABLE beneficiaires (ayants droit) -------------------------------
create table if not exists public.beneficiaires (
  id             uuid primary key default gen_random_uuid(),
  adherent_id    uuid not null references public.adherents (id) on delete cascade,
  lien_parente   text not null check (lien_parente in ('CONJOINT', 'ENFANT', 'PERE', 'MERE', 'AUTRE')),
  nom            text not null,
  prenom         text not null,
  date_naissance date not null,
  sexe           text not null check (sexe in ('M', 'F')),
  numero_carte   text not null unique
                   default ('CM-' || lpad(nextval('public.cartes_membre_numero_seq')::text, 10, '0')),
  statut         text not null default 'ACTIF'
                   check (statut in ('ACTIF', 'SUSPENDU', 'RADIE')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists beneficiaires_adherent_id_idx on public.beneficiaires (adherent_id);
create index if not exists beneficiaires_statut_idx      on public.beneficiaires (statut);

-- ===========================================================================
-- 4. RLS
--   lecture : personnel de l'organisation OU l'adhérent lui-même
--             (profils.adherent_id = adherents.id — usage futur portail assuré)
--   écriture : ASSUREUR_DIRECTION / _EXPLOITATION / _INFORMATIQUE (profil_a_role)
--              OU SOCIETE_ADMINISTRATION pour SES propres adhérents
--              (adherents.souscripteur_id = profils.societe_id)
--   NB : NestJS passe par `postgres` (pooler) et contourne la RLS — ces policies
--        sont la défense en profondeur, AdherentService applique les mêmes règles.
-- ===========================================================================
alter table public.adherents    enable row level security;
alter table public.beneficiaires enable row level security;

-- --- adherents ---
drop policy if exists adherents_lecture on public.adherents;
create policy adherents_lecture on public.adherents
  for select
  using (
    organisation_id = (
      select organisation_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
    or id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists adherents_ecriture on public.adherents;
create policy adherents_ecriture on public.adherents
  for all
  using (
    public.profil_a_role(organisation_id,
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'])
    or souscripteur_id = (
      select societe_id from public.profils
      where id = auth.uid() and deleted_at is null and role = 'SOCIETE_ADMINISTRATION'
    )
  )
  with check (
    public.profil_a_role(organisation_id,
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'])
    or souscripteur_id = (
      select societe_id from public.profils
      where id = auth.uid() and deleted_at is null and role = 'SOCIETE_ADMINISTRATION'
    )
  );

-- --- beneficiaires (organisation / rôle résolus via l'adhérent parent) ---
drop policy if exists beneficiaires_lecture on public.beneficiaires;
create policy beneficiaires_lecture on public.beneficiaires
  for select
  using (
    exists (
      select 1 from public.adherents a
      where a.id = beneficiaires.adherent_id
        and (
          a.organisation_id = (
            select organisation_id from public.profils
            where id = auth.uid() and deleted_at is null
          )
          or a.id = (
            select adherent_id from public.profils
            where id = auth.uid() and deleted_at is null
          )
        )
    )
  );

drop policy if exists beneficiaires_ecriture on public.beneficiaires;
create policy beneficiaires_ecriture on public.beneficiaires
  for all
  using (
    exists (
      select 1 from public.adherents a
      where a.id = beneficiaires.adherent_id
        and (
          public.profil_a_role(a.organisation_id,
            array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'])
          or a.souscripteur_id = (
            select societe_id from public.profils
            where id = auth.uid() and deleted_at is null and role = 'SOCIETE_ADMINISTRATION'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.adherents a
      where a.id = beneficiaires.adherent_id
        and (
          public.profil_a_role(a.organisation_id,
            array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'])
          or a.souscripteur_id = (
            select societe_id from public.profils
            where id = auth.uid() and deleted_at is null and role = 'SOCIETE_ADMINISTRATION'
          )
        )
    )
  );

-- ===========================================================================
-- 5. RÉCONCILIATION des données de test existantes
--    3 lignes référençaient des UUID d'adhérents fictifs (audit 2026-09-10).
--    On matérialise un adhérent réel par UUID orphelin (org A / souscripteur
--    ACME BTP `76d6d833…` / POL-2026-000004 `d1d1d1d1…`). Gardé : ne s'exécute
--    que si l'orphelin existe → no-op sur un environnement neuf.
-- ===========================================================================
do $$
begin
  -- profil armelk01+adherent@gmail.com → adherent_id 1aff894a-…
  if exists (select 1 from public.profils where adherent_id = '1aff894a-3cc8-426e-9365-c5a23446193e') then
    insert into public.adherents (id, organisation_id, souscripteur_id, police_id,
                                  nom, prenom, date_naissance, sexe, statut)
    values ('1aff894a-3cc8-426e-9365-c5a23446193e',
            'aaaaaaaa-0000-0000-0000-000000000001',
            '76d6d833-39f7-45cc-9865-a8e2fa5e9495',
            'd1d1d1d1-1111-4111-8111-111111111111',
            'Konan', 'Adjoua', '1990-05-14', 'F', 'ACTIF')
    on conflict (id) do nothing;
  end if;

  -- cotisation PAYEE 2026-01 → adherent_id 11111111-…
  if exists (select 1 from public.cotisations where adherent_id = '11111111-2222-4333-8444-555555555555') then
    insert into public.adherents (id, organisation_id, souscripteur_id, police_id,
                                  nom, prenom, date_naissance, sexe, statut)
    values ('11111111-2222-4333-8444-555555555555',
            'aaaaaaaa-0000-0000-0000-000000000001',
            '76d6d833-39f7-45cc-9865-a8e2fa5e9495',
            'd1d1d1d1-1111-4111-8111-111111111111',
            'Yao', 'Kouassi', '1985-02-01', 'M', 'ACTIF')
    on conflict (id) do nothing;
  end if;

  -- cotisation EN_RETARD 2026-03 → adherent_id 99999999-…
  if exists (select 1 from public.cotisations where adherent_id = '99999999-8888-4777-8666-555555555555') then
    insert into public.adherents (id, organisation_id, souscripteur_id, police_id,
                                  nom, prenom, date_naissance, sexe, statut)
    values ('99999999-8888-4777-8666-555555555555',
            'aaaaaaaa-0000-0000-0000-000000000001',
            '76d6d833-39f7-45cc-9865-a8e2fa5e9495',
            'd1d1d1d1-1111-4111-8111-111111111111',
            'Traore', 'Awa', '1992-11-20', 'F', 'ACTIF')
    on conflict (id) do nothing;
  end if;
end $$;

-- ===========================================================================
-- 6. CLÉS ÉTRANGÈRES — la dette de l'audit : plus aucun UUID d'adhérent /
--    bénéficiaire non contraint. Noms `<table>_<col>_fkey` (convention Prisma).
--    Toutes les colonnes sont nullable → ON DELETE NO ACTION (défaut) ; les
--    adhérents sont de toute façon supprimés en douceur (deleted_at).
-- ===========================================================================
alter table public.profils
  add constraint profils_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);

alter table public.cotisations
  add constraint cotisations_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);

alter table public.invitations
  add constraint invitations_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);

alter table public.dossiers_soins
  add constraint dossiers_soins_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);
alter table public.dossiers_soins
  add constraint dossiers_soins_beneficiaire_id_fkey
  foreign key (beneficiaire_id) references public.beneficiaires (id);

alter table public.codes_consultation
  add constraint codes_consultation_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);
alter table public.codes_consultation
  add constraint codes_consultation_beneficiaire_id_fkey
  foreign key (beneficiaire_id) references public.beneficiaires (id);

alter table public.codes_ordonnance
  add constraint codes_ordonnance_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);
alter table public.codes_ordonnance
  add constraint codes_ordonnance_beneficiaire_id_fkey
  foreign key (beneficiaire_id) references public.beneficiaires (id);

alter table public.factures_dossier
  add constraint factures_dossier_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);
alter table public.factures_dossier
  add constraint factures_dossier_beneficiaire_id_fkey
  foreign key (beneficiaire_id) references public.beneficiaires (id);

alter table public.reclamations
  add constraint reclamations_adherent_id_fkey
  foreign key (adherent_id) references public.adherents (id);
alter table public.reclamations
  add constraint reclamations_beneficiaire_id_fkey
  foreign key (beneficiaire_id) references public.beneficiaires (id);

-- ===========================================================================
-- 7. GRANT : le microservice svc_adjudication lit déjà reclamations.adherent_id
--    (ADR-003). Aucune nouvelle table ne lui est nécessaire — il n'a PAS accès
--    à adherents / beneficiaires (il travaille sur la réclamation figée).
-- ===========================================================================
