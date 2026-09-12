-- ===========================================================================
-- Révision majeure du flux pharmacie (clarification métier) : le verrou posé
-- au PROMPT 19 était PAR ORDONNANCE ENTIÈRE (un seul code_ordonnance, une
-- seule pharmacie prend tout en charge). La vraie règle est un verrou PAR
-- LIGNE de médicament : des lignes différentes d'une même ordonnance peuvent
-- être servies dans des pharmacies différentes ; une même ligne ne peut être
-- servie qu'une seule fois. `codes_ordonnance` / `validerCodeOrdonnance` /
-- `marquerDispensation` (PROMPT 19) restent en place, INCHANGÉS — ce nouveau
-- flux (module pharmacy/, PharmacyService) les remplace en pratique mais ne
-- les supprime pas.
--
-- 1. lignes_ordonnance — normalise `ordonnances.lignes` (jsonb) en table.
--    Conserve dosage/duree (déjà saisis par le médecin via LigneOrdonnanceDto,
--    PROMPT 19) en plus des colonnes demandées, pour ne perdre aucune donnée
--    déjà collectée. `pharmacie_servante_id` + `quantite_servie` ne sont
--    renseignés qu'au règlement (`confirmerPaiementDispensation`), pas à la
--    préparation — c'est le paiement confirmé qui verrouille la ligne.
-- 2. stock_medicaments_pharmacie — chaque pharmacie fixe son propre prix par
--    dénomination (texte libre, pas de FK vers le référentiel national :
--    comblait un gap documenté au prompt précédent, devient nécessaire ici).
-- 3. dispensations_pharmacie + lignes_dispensation — cycle de vie complet
--    (EN_PREPARATION → EN_ATTENTE_VALIDATION_PATIENT → VALIDEE → PAYEE),
--    même garde anti-fraude bloquante que les 4 codes déjà construits :
--    paiement impossible sans validation du code par le patient, doublée par
--    un trigger (même principe que verifier_facture_reglable, PROMPT 21).
-- ===========================================================================

create table if not exists public.lignes_ordonnance (
  id                      uuid primary key default gen_random_uuid(),
  ordonnance_id           uuid not null references public.ordonnances (id) on delete cascade,
  denomination_medicament text not null,
  dosage                  text,
  posologie               text not null,
  duree                   text,
  quantite_prescrite      integer not null default 1 check (quantite_prescrite > 0),
  statut                  text not null default 'DISPONIBLE' check (statut in ('DISPONIBLE', 'SERVIE')),
  pharmacie_servante_id   uuid references public.pharmacies (id),
  quantite_servie         integer check (quantite_servie is null or quantite_servie > 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint lignes_ordonnance_servie_coherente
    check (statut = 'DISPONIBLE' or pharmacie_servante_id is not null)
);

create index if not exists lignes_ordonnance_ordonnance_id_idx on public.lignes_ordonnance (ordonnance_id);
create index if not exists lignes_ordonnance_statut_idx on public.lignes_ordonnance (statut);
create index if not exists lignes_ordonnance_pharmacie_servante_id_idx on public.lignes_ordonnance (pharmacie_servante_id);

-- Migration des données existantes : éclate ordonnances.lignes (jsonb array)
-- en lignes_ordonnance. Idempotent (ne réinsère pas si déjà fait).
insert into public.lignes_ordonnance (ordonnance_id, denomination_medicament, dosage, posologie, duree, quantite_prescrite)
select
  o.id,
  coalesce(l ->> 'medicament', 'Médicament non précisé'),
  l ->> 'dosage',
  coalesce(l ->> 'posologie', ''),
  l ->> 'duree',
  coalesce(nullif(l ->> 'quantite', '')::int, 1)
from public.ordonnances o
cross join lateral jsonb_array_elements(o.lignes) as l
where jsonb_typeof(o.lignes) = 'array'
  and jsonb_array_length(o.lignes) > 0
  and not exists (
    select 1 from public.lignes_ordonnance lo where lo.ordonnance_id = o.id
  );

-- ===========================================================================
-- stock_medicaments_pharmacie
-- ===========================================================================
create table if not exists public.stock_medicaments_pharmacie (
  id                      uuid primary key default gen_random_uuid(),
  pharmacie_id            uuid not null references public.pharmacies (id) on delete cascade,
  denomination_medicament text not null,
  prix_pharmacie          numeric(14, 2) check (prix_pharmacie is null or prix_pharmacie >= 0),
  disponible              boolean not null default true,
  date_maj                timestamptz not null default now(),
  created_at              timestamptz not null default now(),

  constraint stock_medicaments_pharmacie_unique unique (pharmacie_id, denomination_medicament)
);

create index if not exists stock_medicaments_pharmacie_pharmacie_id_idx on public.stock_medicaments_pharmacie (pharmacie_id);

-- ===========================================================================
-- dispensations_pharmacie + lignes_dispensation
-- ===========================================================================
create table if not exists public.dispensations_pharmacie (
  id                      uuid primary key default gen_random_uuid(),
  ordonnance_id           uuid not null references public.ordonnances (id),
  pharmacie_id            uuid not null references public.pharmacies (id),
  -- l'utilisateur qui a prépare la dispensation — n'importe lequel des 3
  -- sous-rôles PHARMACIE_* (dispensation standard partagée, audit prompt
  -- précédent), nom de colonne conservé tel que spécifié.
  caissiere_id            uuid not null references public.profils (id),
  montant_total           numeric(14, 2) not null default 0 check (montant_total >= 0),
  statut                  text not null default 'EN_PREPARATION'
                            check (statut in ('EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT',
                                              'VALIDEE', 'PAYEE', 'ANNULEE')),
  code_confirmation       text unique check (code_confirmation is null or code_confirmation ~ '^[A-Z0-9]{6,8}$'),
  date_preparation        timestamptz not null default now(),
  date_validation_patient timestamptz,
  date_paiement           timestamptz,
  created_at              timestamptz not null default now(),

  constraint dispensations_pharmacie_paiement_coherent
    check (statut <> 'PAYEE' or date_paiement is not null)
);

create index if not exists dispensations_pharmacie_ordonnance_id_idx on public.dispensations_pharmacie (ordonnance_id);
create index if not exists dispensations_pharmacie_pharmacie_id_idx on public.dispensations_pharmacie (pharmacie_id);
create index if not exists dispensations_pharmacie_statut_idx on public.dispensations_pharmacie (statut);

create table if not exists public.lignes_dispensation (
  id                  uuid primary key default gen_random_uuid(),
  dispensation_id     uuid not null references public.dispensations_pharmacie (id) on delete cascade,
  ligne_ordonnance_id uuid not null references public.lignes_ordonnance (id),
  prix_unitaire       numeric(14, 2) not null check (prix_unitaire >= 0),
  quantite            integer not null default 1 check (quantite > 0),
  montant_ligne       numeric(14, 2) not null check (montant_ligne >= 0)
);

create index if not exists lignes_dispensation_dispensation_id_idx on public.lignes_dispensation (dispensation_id);
create index if not exists lignes_dispensation_ligne_ordonnance_id_idx on public.lignes_dispensation (ligne_ordonnance_id);

-- ===========================================================================
-- Trigger : interdit tout passage à PAYEE sans être passé par VALIDEE au
-- préalable (même principe que verifier_facture_reglable(), PROMPT 21).
-- ===========================================================================
create or replace function public.verifier_dispensation_payable()
returns trigger
language plpgsql
as $$
begin
  if new.statut = 'PAYEE' and old.statut is distinct from 'PAYEE' then
    if old.statut is distinct from 'VALIDEE' then
      raise exception
        'Dispensation % : règlement impossible tant que le code n''a pas été validé par le patient (statut actuel : %).',
        new.id, old.statut
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verifier_dispensation_payable on public.dispensations_pharmacie;
create trigger trg_verifier_dispensation_payable
  before update on public.dispensations_pharmacie
  for each row execute function public.verifier_dispensation_payable();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.lignes_ordonnance enable row level security;

drop policy if exists lignes_ordonnance_lecture on public.lignes_ordonnance;
create policy lignes_ordonnance_lecture on public.lignes_ordonnance
  for select
  to authenticated
  using (
    exists (
      select 1 from public.ordonnances o
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where o.id = lignes_ordonnance.ordonnance_id
        and (
          -- l'adhérent (ou le titulaire du bénéficiaire) concerné
          (p.adherent_id is not null and o.dossier_soins_id in (
            select id from public.dossiers_soins where adherent_id = p.adherent_id or beneficiaire_id in (
              select id from public.beneficiaires where adherent_id = p.adherent_id
            )
          ))
          -- toute pharmacie du réseau (recherche par carte, PROMPT pharmacie)
          or p.pharmacie_id is not null
          -- personnel de l'établissement / assureur habilité
          or p.etablissement_id is not null
          or p.role in ('ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE',
                        'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL')
        )
    )
  );

drop policy if exists lignes_ordonnance_ecriture on public.lignes_ordonnance;
create policy lignes_ordonnance_ecriture on public.lignes_ordonnance
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and (p.pharmacie_id is not null or p.role = 'CENTRE_MEDICAL_MEDECIN')
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and (p.pharmacie_id is not null or p.role = 'CENTRE_MEDICAL_MEDECIN')
    )
  );

alter table public.stock_medicaments_pharmacie enable row level security;

drop policy if exists stock_medicaments_pharmacie_acces on public.stock_medicaments_pharmacie;
create policy stock_medicaments_pharmacie_acces on public.stock_medicaments_pharmacie
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = stock_medicaments_pharmacie.pharmacie_id
        and p.role = 'PHARMACIE_PHARMACIEN'
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = stock_medicaments_pharmacie.pharmacie_id
        and p.role = 'PHARMACIE_PHARMACIEN'
    )
  );

alter table public.dispensations_pharmacie enable row level security;

drop policy if exists dispensations_pharmacie_lecture on public.dispensations_pharmacie;
create policy dispensations_pharmacie_lecture on public.dispensations_pharmacie
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and (
          (p.pharmacie_id is not null and p.pharmacie_id = dispensations_pharmacie.pharmacie_id)
          or p.role = 'ASSUREUR_PHARMACIEN_CONSEIL'
          or exists (
            select 1 from public.ordonnances o
            join public.dossiers_soins d on d.id = o.dossier_soins_id
            where o.id = dispensations_pharmacie.ordonnance_id
              and p.adherent_id is not null
              and (d.adherent_id = p.adherent_id or d.beneficiaire_id in (
                select id from public.beneficiaires where adherent_id = p.adherent_id
              ))
          )
        )
    )
  );

drop policy if exists dispensations_pharmacie_ecriture on public.dispensations_pharmacie;
create policy dispensations_pharmacie_ecriture on public.dispensations_pharmacie
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = dispensations_pharmacie.pharmacie_id
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_CAISSIERE', 'PHARMACIE_COMPTABLE')
    )
  )
  with check (
    exists (
      select 1 from public.profils p
      where p.id = auth.uid() and p.deleted_at is null
        and p.pharmacie_id is not null and p.pharmacie_id = dispensations_pharmacie.pharmacie_id
        and p.role in ('PHARMACIE_PHARMACIEN', 'PHARMACIE_CAISSIERE', 'PHARMACIE_COMPTABLE')
    )
  );

drop policy if exists dispensations_pharmacie_validation_adherent on public.dispensations_pharmacie;
create policy dispensations_pharmacie_validation_adherent on public.dispensations_pharmacie
  for update
  to authenticated
  using (
    exists (
      select 1 from public.ordonnances o
      join public.dossiers_soins d on d.id = o.dossier_soins_id
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where o.id = dispensations_pharmacie.ordonnance_id
        and p.adherent_id is not null
        and (d.adherent_id = p.adherent_id or d.beneficiaire_id in (
          select id from public.beneficiaires where adherent_id = p.adherent_id
        ))
    )
  );

alter table public.lignes_dispensation enable row level security;

drop policy if exists lignes_dispensation_acces on public.lignes_dispensation;
create policy lignes_dispensation_acces on public.lignes_dispensation
  for all
  to authenticated
  using (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
    )
  )
  with check (
    exists (
      select 1 from public.dispensations_pharmacie dp
      join public.profils p on p.id = auth.uid() and p.deleted_at is null
      where dp.id = lignes_dispensation.dispensation_id
        and p.pharmacie_id is not null and p.pharmacie_id = dp.pharmacie_id
    )
  );
