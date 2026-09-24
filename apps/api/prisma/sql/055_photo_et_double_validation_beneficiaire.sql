-- ===========================================================================
-- Photo de profil (adhérents/bénéficiaires) + double validation d'un
-- bénéficiaire ajouté par l'adhérent lui-même (SOCIETE_ADMINISTRATION puis
-- ASSUREUR_INFORMATIQUE/EXPLOITATION) avant génération de son numero_carte.
-- ===========================================================================

alter table public.adherents add column if not exists photo_url text;
alter table public.beneficiaires add column if not exists photo_url text;

-- numero_carte devient nullable côté bénéficiaire UNIQUEMENT : un bénéficiaire
-- proposé par l'adhérent lui-même n'a PAS de carte tant que les deux
-- validations ne sont pas passées (INSERT explicite de NULL, en dehors du
-- défaut de séquence — inchangé pour la création directe par
-- SOCIETE_ADMINISTRATION/ASSUREUR, qui continue de recevoir un numéro
-- immédiatement). `adherents.numero_carte` reste NOT NULL : un adhérent
-- principal est toujours créé directement, jamais via ce circuit.
alter table public.beneficiaires alter column numero_carte drop not null;

alter table public.beneficiaires drop constraint if exists beneficiaires_statut_check;
alter table public.beneficiaires
  add constraint beneficiaires_statut_check
    check (statut in ('EN_ATTENTE_SOCIETE', 'EN_ATTENTE_ASSUREUR', 'ACTIF', 'SUSPENDU', 'RADIE'));

-- Cohérence carte/statut : un bénéficiaire encore en attente n'a jamais de
-- numero_carte ; un bénéficiaire ACTIF/SUSPENDU/RADIE en a toujours un (créé
-- directement avec, ou attribué par `validerBeneficiaireAssureur`).
alter table public.beneficiaires drop constraint if exists beneficiaires_carte_coherente;
alter table public.beneficiaires
  add constraint beneficiaires_carte_coherente
    check (
      (statut in ('EN_ATTENTE_SOCIETE', 'EN_ATTENTE_ASSUREUR') and numero_carte is null)
      or (statut in ('ACTIF', 'SUSPENDU', 'RADIE') and numero_carte is not null)
    );

-- ===========================================================================
-- RLS — écriture propre de l'adhérent sur SES bénéficiaires (proposition +
-- modification tant que non carté) et sur SA photo / celle de ses
-- bénéficiaires. S'ajoute aux policies existantes (permissives, combinées en
-- OR) — NestJS reste la vraie porte (contourne la RLS via le pooler
-- `postgres`), ces policies sont la défense en profondeur habituelle.
-- ===========================================================================

drop policy if exists beneficiaires_insertion_propre_adherent on public.beneficiaires;
create policy beneficiaires_insertion_propre_adherent on public.beneficiaires
  for insert
  to authenticated
  with check (
    adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists beneficiaires_modification_propre_adherent on public.beneficiaires;
create policy beneficiaires_modification_propre_adherent on public.beneficiaires
  for update
  to authenticated
  using (
    adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  )
  with check (
    adherent_id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

drop policy if exists adherents_modification_photo_propre on public.adherents;
create policy adherents_modification_photo_propre on public.adherents
  for update
  to authenticated
  using (
    id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  )
  with check (
    id = (
      select adherent_id from public.profils
      where id = auth.uid() and deleted_at is null
    )
  );

-- ===========================================================================
-- Bucket de stockage privé `photos` — même recette que `cartes`
-- (prisma/sql/023) : PRIVÉ, aucune policy sur `storage.objects`, seul le
-- `service_role` (AdherentService, via l'API Storage REST) y écrit et signe
-- des URL à durée limitée. Images uniquement (pas de PDF ici).
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
