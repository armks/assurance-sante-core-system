-- ===========================================================================
-- 1. ASSUREUR_COMPTABLE peut désormais créer un souscripteur (creerSouscripteur,
--    module tenant/) — étend la policy RLS `souscripteurs_modif` (défense en
--    profondeur, en plus du roleChain côté NestJS, tenant.types.ts).
-- 2. ASSUREUR_COMPTABLE reste EXCLU de tarifs_conventionnes (déjà exclusif à
--    ASSUREUR_INFORMATIQUE, prisma/sql/033 — inchangé) ET, désormais, des
--    grilles_tarifaires négociées (prisma/sql/006 l'incluait par erreur de
--    conception initiale — corrigé ici : la gestion des grilles reste un
--    périmètre distinct de la génération de cotisations, que ASSUREUR_COMPTABLE
--    continue d'effectuer).
-- 3. Coupure de facturation mensuelle : un adhérent PRINCIPAL doit être validé
--    par ASSUREUR_EXPLOITATION pour compter dans genererCotisationsPeriode —
--    jamais les bénéficiaires (pas de colonne équivalente sur `beneficiaires`).
-- ===========================================================================

-- 1. souscripteurs_modif — ajoute ASSUREUR_COMPTABLE.
drop policy if exists souscripteurs_modif on public.souscripteurs;
create policy souscripteurs_modif on public.souscripteurs
  for all
  using (
    exists (
      select 1
      from public.profils p
      join public.sous_roles sr on sr.code = p.role
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id = souscripteurs.organisation_id
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE')
    )
  )
  with check (
    exists (
      select 1
      from public.profils p
      join public.sous_roles sr on sr.code = p.role
      where p.id = auth.uid()
        and p.deleted_at is null
        and p.organisation_id = souscripteurs.organisation_id
        and coalesce(sr.role_parent_code, sr.code)
            in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE')
    )
  );

-- 2. grilles_tarifaires_ecriture — retire ASSUREUR_COMPTABLE (ASSUREUR_INFORMATIQUE seul).
drop policy if exists grilles_tarifaires_ecriture on public.grilles_tarifaires;
create policy grilles_tarifaires_ecriture on public.grilles_tarifaires
  for all
  using (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']))
  with check (public.profil_a_role(organisation_id, array['ASSUREUR_INFORMATIQUE']));

-- 3. Validation d'un adhérent PRINCIPAL par ASSUREUR_EXPLOITATION.
alter table public.adherents
  add column if not exists date_validation timestamptz,
  add column if not exists valide_par_id uuid references public.profils (id);

create index if not exists adherents_date_validation_idx
  on public.adherents (date_validation);
