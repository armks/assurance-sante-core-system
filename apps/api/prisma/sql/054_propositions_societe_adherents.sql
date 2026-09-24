-- ===========================================================================
-- Étend imports_adherents pour la gestion collaborative de sa liste
-- d'adhérents/bénéficiaires par une société cliente, AVANT validation finale
-- par l'assureur — même circuit que l'import Excel (statut EN_ATTENTE_
-- VALIDATION, validerImportAdherents déjà construit), avec un nouveau statut
-- BROUILLON intermédiaire : la société ajoute/modifie/supprime des lignes une
-- à une (jamais un import Excel, qui saute directement en EN_ATTENTE_
-- VALIDATION), jusqu'à « Soumettre pour validation ».
-- ===========================================================================

alter table public.imports_adherents
  alter column fichier_nom drop not null;

alter table public.imports_adherents
  drop constraint if exists imports_adherents_statut_check;
alter table public.imports_adherents
  add constraint imports_adherents_statut_check
    check (statut in ('BROUILLON', 'EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE'));

alter table public.imports_adherents
  drop constraint if exists imports_adherents_validation_coherente;
alter table public.imports_adherents
  add constraint imports_adherents_validation_coherente
    check (
      (statut in ('BROUILLON', 'EN_ATTENTE_VALIDATION') and valide_par is null and date_validation is null)
      or (statut in ('VALIDE', 'REJETE') and valide_par is not null and date_validation is not null)
    );

-- Lecture : la société voit ses PROPRES imports/brouillons (tout statut) —
-- s'ajoute à la lecture assureur déjà en place (policies permissives OR).
drop policy if exists imports_adherents_lecture_societe on public.imports_adherents;
create policy imports_adherents_lecture_societe on public.imports_adherents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.societe_id = imports_adherents.souscripteur_id
        and p.role in ('SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION')
    )
  );

-- Création : la société crée SON propre brouillon (souscripteur_id = sa société).
drop policy if exists imports_adherents_insertion_societe on public.imports_adherents;
create policy imports_adherents_insertion_societe on public.imports_adherents
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.societe_id = imports_adherents.souscripteur_id
        and p.role in ('SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION')
    )
  );

-- Mise à jour : la société modifie SON propre brouillon (ajout/édition/
-- suppression de ligne, soumission pour validation) — s'ajoute à la policy
-- de validation assureur déjà en place (permissive OR, périmètres disjoints :
-- la société ne peut de toute façon écrire que tant que statut = BROUILLON,
-- vérifié côté NestJS, ImportAdherentsService.assertProposition).
drop policy if exists imports_adherents_ecriture_societe on public.imports_adherents;
create policy imports_adherents_ecriture_societe on public.imports_adherents
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.societe_id = imports_adherents.souscripteur_id
        and p.role in ('SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION')
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.societe_id = imports_adherents.souscripteur_id
        and p.role in ('SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION')
    )
  );

-- ===========================================================================
-- Réclamations — lecture scopée à SES PROPRES adhérents pour une société
-- cliente (SOCIETE_ASSUREE / SOCIETE_ADMINISTRATION). `reclamations` n'a pas
-- de colonne société directe (gap déjà noté, prisma/sql/025) : on scope via
-- le sous-ensemble des `adherents` de son `souscripteur_id`.
-- ===========================================================================
drop policy if exists reclamations_lecture_societe on public.reclamations;
create policy reclamations_lecture_societe on public.reclamations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      join public.adherents a on a.id = reclamations.adherent_id
      where p.id = auth.uid() and p.deleted_at is null
        and p.role in ('SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION')
        and a.souscripteur_id = p.societe_id
    )
  );
