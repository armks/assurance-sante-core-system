-- ===========================================================================
-- 027 — Substitution de médicament sur une ligne de dispensation, réservée
-- EXCLUSIVEMENT à PHARMACIE_PHARMACIEN (jamais la caissière), cohérent avec
-- la clarification métier : "concernant la modification ou la substitution
-- d'un médicament le pharmacien doit valider". Ne peut s'appliquer qu'avant
-- confirmation du paiement (dispensation encore EN_PREPARATION ou
-- EN_ATTENTE_VALIDATION_PATIENT) — vérifié côté NestJS ; la RLS ci-dessous ne
-- vérifie que le rôle + la pharmacie (défense en profondeur, comme partout
-- ailleurs dans ce module).
-- ===========================================================================

alter table public.lignes_dispensation
  add column if not exists medicament_substitue text,
  add column if not exists motif_substitution    text,
  add column if not exists substitue_par_id       uuid references public.profils (id),
  add column if not exists date_substitution      timestamptz;

-- La RLS précédente (lignes_dispensation_acces, "for all") ne distinguait pas
-- les rôles. On la remplace par 3 policies : lecture ouverte aux 3 rôles
-- pharmacie de la pharmacie propriétaire (inchangé), création réservée à la
-- préparation d'une dispensation (les 3 rôles, comme avant), modification
-- (substitution) réservée au PHARMACIEN seul.
drop policy if exists lignes_dispensation_acces on public.lignes_dispensation;

create policy lignes_dispensation_lecture on public.lignes_dispensation
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
    )
  );

create policy lignes_dispensation_creation on public.lignes_dispensation
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
    )
  );

create policy lignes_dispensation_substitution on public.lignes_dispensation
  for update
  to authenticated
  using (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
        and p.role = 'PHARMACIE_PHARMACIEN'
    )
  )
  with check (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
        and p.role = 'PHARMACIE_PHARMACIEN'
    )
  );
