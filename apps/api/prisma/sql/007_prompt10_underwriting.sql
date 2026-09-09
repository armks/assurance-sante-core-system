-- ===========================================================================
-- PROMPT 10 (original — rattrapé après le PROMPT 11)
-- questionnaires_medicaux + tarification_individuelle.
-- Réf. skill : v4 §3.1, v9 §1.4, v10 §3 (séparation stricte médecin
-- souscripteur / médecin conseil).
--
-- SÉPARATION STRICTE : la table questionnaires_medicaux est réservée EXCLUSIVEMENT
-- à ASSUREUR_MEDECIN_SOUSCRIPTEUR pour la décision. ASSUREUR_MEDECIN_CONSEIL n'a
-- AUCUN accès (ni lecture ni écriture) — vérifié par profil_a_role() (CONSEIL
-- n'apparaît dans aucune liste, et son role_parent_code est null).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================

create table if not exists public.questionnaires_medicaux (
  id                     uuid primary key default gen_random_uuid(),
  souscripteur_id        uuid not null references public.souscripteurs (id) on delete cascade,
  reponses               jsonb not null default '{}',
  antecedents_declares   text[] not null default '{}',
  date_soumission        timestamptz,
  -- null tant que le médecin souscripteur n'a pas tranché
  decision               text
                           check (decision is null
                                  or decision in ('ACCEPTE', 'ACCEPTE_AVEC_EXCLUSION',
                                                  'ACCEPTE_SURPRIME', 'REFUSE')),
  exclusions_specifiques text[] not null default '{}',
  surprime_pourcent      numeric(6, 2) not null default 0 check (surprime_pourcent >= 0),
  valide_par             uuid references public.profils (id),
  date_decision          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,

  -- cohérence : une décision rendue a un validateur et une date
  constraint questionnaire_decision_coherente
    check ((decision is null) or (valide_par is not null and date_decision is not null))
);

create index if not exists questionnaires_medicaux_souscripteur_id_idx on public.questionnaires_medicaux (souscripteur_id);
create index if not exists questionnaires_medicaux_decision_idx        on public.questionnaires_medicaux (decision);
-- un seul questionnaire actif par souscripteur
create unique index if not exists questionnaires_medicaux_souscripteur_unique
  on public.questionnaires_medicaux (souscripteur_id)
  where deleted_at is null;

-- Réservé aux souscripteurs de type INDIVIDUEL (v4 §3.1).
create or replace function public.verifier_souscripteur_individuel()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type from public.souscripteurs where id = new.souscripteur_id;
  if v_type is distinct from 'INDIVIDUEL' then
    raise exception 'questionnaires_medicaux : le souscripteur % n''est pas de type INDIVIDUEL (type %)',
      new.souscripteur_id, v_type using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists questionnaires_souscripteur_individuel on public.questionnaires_medicaux;
create trigger questionnaires_souscripteur_individuel
  before insert or update of souscripteur_id on public.questionnaires_medicaux
  for each row execute function public.verifier_souscripteur_individuel();

create table if not exists public.tarification_individuelle (
  id                      uuid primary key default gen_random_uuid(),
  police_id               uuid not null references public.polices (id) on delete cascade,
  questionnaire_medical_id uuid not null references public.questionnaires_medicaux (id) on delete cascade,
  age_a_souscription      integer not null check (age_a_souscription >= 0),
  prime_base              numeric(14, 2) not null check (prime_base >= 0),
  surprime_medicale       numeric(14, 2) not null default 0 check (surprime_medicale >= 0),
  prime_finale            numeric(14, 2) generated always as (prime_base + surprime_medicale) stored,
  created_at              timestamptz not null default now()
);

create index if not exists tarification_individuelle_police_id_idx        on public.tarification_individuelle (police_id);
create index if not exists tarification_individuelle_questionnaire_id_idx on public.tarification_individuelle (questionnaire_medical_id);

-- ===========================================================================
-- RLS questionnaires_medicaux — SÉPARATION STRICTE (v10 §3)
--
--  SELECT  : ASSUREUR_MEDECIN_SOUSCRIPTEUR (org du souscripteur) OU le
--            souscripteur individuel lui-même (profils.societe_id).
--  INSERT  : le souscripteur concerné OU ASSUREUR_MEDECIN_SOUSCRIPTEUR.
--  UPDATE  : EXCLUSIVEMENT ASSUREUR_MEDECIN_SOUSCRIPTEUR.
--  DELETE  : EXCLUSIVEMENT ASSUREUR_MEDECIN_SOUSCRIPTEUR.
--
--  => ASSUREUR_MEDECIN_CONSEIL : profil_a_role(..., ['ASSUREUR_MEDECIN_SOUSCRIPTEUR'])
--     renvoie false pour lui (rôle différent, pas de parenté), et il n'est jamais
--     le souscripteur => AUCUN accès, ni lecture ni écriture.
-- ===========================================================================
alter table public.questionnaires_medicaux enable row level security;

drop policy if exists questionnaires_select on public.questionnaires_medicaux;
create policy questionnaires_select on public.questionnaires_medicaux
  for select
  using (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = questionnaires_medicaux.souscripteur_id),
      array['ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
    or questionnaires_medicaux.souscripteur_id = (
      select societe_id from profils where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists questionnaires_insert on public.questionnaires_medicaux;
create policy questionnaires_insert on public.questionnaires_medicaux
  for insert
  with check (
    questionnaires_medicaux.souscripteur_id = (
      select societe_id from profils where id = auth.uid() and deleted_at is null
    )
    or public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = questionnaires_medicaux.souscripteur_id),
      array['ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  );

drop policy if exists questionnaires_update on public.questionnaires_medicaux;
create policy questionnaires_update on public.questionnaires_medicaux
  for update
  using (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = questionnaires_medicaux.souscripteur_id),
      array['ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  )
  with check (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = questionnaires_medicaux.souscripteur_id),
      array['ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  );

drop policy if exists questionnaires_delete on public.questionnaires_medicaux;
create policy questionnaires_delete on public.questionnaires_medicaux
  for delete
  using (
    public.profil_a_role(
      (select organisation_id from souscripteurs s where s.id = questionnaires_medicaux.souscripteur_id),
      array['ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  );

-- ===========================================================================
-- RLS tarification_individuelle
--  lecture : personnel ASSUREUR de l'org de la police OU le souscripteur concerné
--  écriture : ASSUREUR_DIRECTION / ASSUREUR_EXPLOITATION / ASSUREUR_MEDECIN_SOUSCRIPTEUR
-- ===========================================================================
alter table public.tarification_individuelle enable row level security;

drop policy if exists tarification_individuelle_lecture on public.tarification_individuelle;
create policy tarification_individuelle_lecture on public.tarification_individuelle
  for select
  using (
    exists (
      select 1 from polices pol
      where pol.id = tarification_individuelle.police_id
        and (
          exists (
            select 1 from profils p join sous_roles sr on sr.code = p.role
            where p.id = auth.uid() and p.deleted_at is null
              and p.organisation_id = pol.organisation_id
              and sr.entite_code = 'ASSUREUR'
          )
          or pol.souscripteur_id = (
            select societe_id from profils where id = auth.uid() and deleted_at is null
          )
        )
    )
  );

drop policy if exists tarification_individuelle_ecriture on public.tarification_individuelle;
create policy tarification_individuelle_ecriture on public.tarification_individuelle
  for all
  using (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = tarification_individuelle.police_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  )
  with check (
    public.profil_a_role(
      (select organisation_id from polices pol where pol.id = tarification_individuelle.police_id),
      array['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_MEDECIN_SOUSCRIPTEUR']
    )
  );
