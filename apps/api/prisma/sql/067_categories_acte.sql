-- ===========================================================================
-- Référentiel UNIQUE des catégories d'acte (ADR-004 « référentiel unique des
-- catégories d'acte, règle non couvert », ARCHITECTURE-DECISIONS.md).
--
-- Avant : trois vocabulaires divergents — actes (CATEGORIES_ACTE, API), garanties
-- (liste du formulaire produit, texte libre côté API), type de réclamation
-- (CATEGORIE_VERS_TYPE). La part assurance appariait acte ↔ garantie par code
-- exact : BIOLOGIE / ACTE_TECHNIQUE / TRANSPORT ne trouvaient jamais de garantie
-- et recevaient un taux par défaut de 80 % codé en dur.
--
-- Cette migration :
--   1. crée `categories_acte` (code, libellé, type de réclamation, rôle de revue,
--      actif) et la remplit ;
--   2. convertit les anciens codes (BIOLOGIE, ANALYSES_LABORATOIRE → ANALYSES ;
--      TRANSPORT_SANITAIRE → TRANSPORT) et normalise la catégorie en texte libre
--      des référentiels d'actes ;
--   3. échoue (sans rien modifier) si une valeur restante n'est pas dans le
--      référentiel, ou si une conversion crée deux garanties de même catégorie
--      dans un produit ;
--   4. ajoute les clés étrangères, l'index unique (produit, catégorie) des
--      garanties, rend `garanties.taux_couverture` obligatoire ;
--   5. `produits.categories_non_couvertes` : catégories confirmées « non
--      couvertes » par l'assureur à la publication ;
--   6. `reclamations.garantie_id` nullable UNIQUEMENT pour une réclamation
--      rejetée E011 (catégorie non couverte par le produit, jamais envoyée au
--      microservice d'adjudication).
--
-- État vérifié avant application (2026-10-07) : 4 garanties (CONSULTATION,
-- HOSPITALISATION, taux renseignés, aucun doublon), 0 acte, 0 réclamation,
-- référentiel d'actes : « Consultation » (texte libre), catalogue national :
-- CONSULTATION, IMAGERIE, MATERNITE, DENTAIRE, ANALYSES.
-- ===========================================================================

begin;

-- --- 1. Référentiel ---------------------------------------------------------

create table if not exists public.categories_acte (
  code             text primary key check (code ~ '^[A-Z][A-Z_]{1,39}$'),
  libelle          text not null,
  type_reclamation text not null
                     check (type_reclamation in ('SOIN', 'PHARMACIE', 'HOSPITALISATION',
                       'OPTIQUE', 'DENTAIRE', 'ANALYSES', 'IMAGERIE', 'AUTRE')),
  role_revue       text not null references public.sous_roles (code),
  actif            boolean not null default true,
  ordre            integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

insert into public.categories_acte (code, libelle, type_reclamation, role_revue, ordre) values
  ('CONSULTATION',     'Consultation',            'SOIN',            'ASSUREUR_MEDECIN_CONSEIL', 10),
  ('HOSPITALISATION',  'Hospitalisation',         'HOSPITALISATION', 'ASSUREUR_MEDECIN_CONSEIL', 20),
  ('MATERNITE',        'Maternité',               'HOSPITALISATION', 'ASSUREUR_MEDECIN_CONSEIL', 30),
  ('PHARMACIE',        'Pharmacie',               'PHARMACIE',       'ASSUREUR_MEDECIN_CONSEIL', 40),
  ('ANALYSES',         'Analyses de laboratoire', 'ANALYSES',        'ASSUREUR_MEDECIN_CONSEIL', 50),
  ('IMAGERIE',         'Imagerie',                'IMAGERIE',        'ASSUREUR_MEDECIN_CONSEIL', 60),
  ('OPTIQUE',          'Optique',                 'OPTIQUE',         'ASSUREUR_MEDECIN_CONSEIL', 70),
  ('DENTAIRE',         'Dentaire',                'DENTAIRE',        'ASSUREUR_MEDECIN_CONSEIL', 80),
  ('ACTE_TECHNIQUE',   'Acte technique',          'SOIN',            'ASSUREUR_MEDECIN_CONSEIL', 90),
  ('SOINS_INFIRMIERS', 'Soins infirmiers',        'SOIN',            'ASSUREUR_MEDECIN_CONSEIL', 100),
  ('TRANSPORT',        'Transport sanitaire',     'AUTRE',           'ASSUREUR_EXPLOITATION',    110),
  ('AUTRE',            'Autre',                   'AUTRE',           'ASSUREUR_EXPLOITATION',    120)
on conflict (code) do update set
  libelle = excluded.libelle,
  type_reclamation = excluded.type_reclamation,
  role_revue = excluded.role_revue,
  ordre = excluded.ordre,
  updated_at = now();

-- Données de référence non sensibles : lecture pour tout compte authentifié,
-- aucune écriture hors migration.
alter table public.categories_acte enable row level security;
drop policy if exists categories_acte_lecture on public.categories_acte;
create policy categories_acte_lecture on public.categories_acte
  for select to authenticated using (true);

-- --- 2. Conversions et normalisation ----------------------------------------

-- Anciens codes → codes du référentiel.
create temporary table alias_categorie (ancien text primary key, nouveau text not null) on commit drop;
insert into alias_categorie values
  ('BIOLOGIE', 'ANALYSES'),
  ('ANALYSES_LABORATOIRE', 'ANALYSES'),
  ('ANALYSES_DE_LABORATOIRE', 'ANALYSES'),
  ('TRANSPORT_SANITAIRE', 'TRANSPORT');

update public.garanties g set categorie_acte = a.nouveau
  from alias_categorie a where g.categorie_acte = a.ancien;
update public.actes_dossier x set categorie_acte = a.nouveau
  from alias_categorie a where x.categorie_acte = a.ancien;

-- Référentiels d'actes (texte libre) : « Consultation » → CONSULTATION,
-- « Analyses de laboratoire » → ANALYSES_DE_LABORATOIRE → ANALYSES, vide → NULL.
update public.referentiel_actes set categorie = nullif(trim(categorie), '');
update public.referentiel_actes
   set categorie = upper(trim(both '_' from regexp_replace(public.sans_accent(categorie), '[^A-Za-z0-9]+', '_', 'g')))
 where categorie is not null;
update public.referentiel_actes r set categorie = a.nouveau
  from alias_categorie a where r.categorie = a.ancien;
-- un libellé exact du référentiel (« Transport sanitaire ») vaut son code
update public.referentiel_actes r set categorie = c.code
  from public.categories_acte c
 where r.categorie is not null and r.categorie not in (select code from public.categories_acte)
   and r.categorie = upper(trim(both '_' from regexp_replace(public.sans_accent(c.libelle), '[^A-Za-z0-9]+', '_', 'g')));

update public.referentiel_national_actes set categorie = nullif(trim(categorie), '');
update public.referentiel_national_actes
   set categorie = upper(trim(both '_' from regexp_replace(public.sans_accent(categorie), '[^A-Za-z0-9]+', '_', 'g')))
 where categorie is not null;
update public.referentiel_national_actes r set categorie = a.nouveau
  from alias_categorie a where r.categorie = a.ancien;
update public.referentiel_national_actes r set categorie = c.code
  from public.categories_acte c
 where r.categorie is not null and r.categorie not in (select code from public.categories_acte)
   and r.categorie = upper(trim(both '_' from regexp_replace(public.sans_accent(c.libelle), '[^A-Za-z0-9]+', '_', 'g')));

-- --- 3. Garde-fous : échec explicite plutôt que perte silencieuse -----------

do $$
declare
  inconnues text;
  doublons  text;
  sans_taux integer;
begin
  select string_agg(distinct t.v, ', ') into inconnues
    from (
      select 'garanties:' || categorie_acte as v from public.garanties
       where categorie_acte not in (select code from public.categories_acte)
      union all
      select 'actes_dossier:' || categorie_acte from public.actes_dossier
       where categorie_acte not in (select code from public.categories_acte)
      union all
      select 'referentiel_actes:' || categorie from public.referentiel_actes
       where categorie is not null and categorie not in (select code from public.categories_acte)
      union all
      select 'referentiel_national_actes:' || categorie from public.referentiel_national_actes
       where categorie is not null and categorie not in (select code from public.categories_acte)
    ) t;
  if inconnues is not null then
    raise exception 'Catégories hors référentiel, à convertir avant migration : %', inconnues;
  end if;

  select string_agg(produit_id::text || '/' || categorie_acte, ', ') into doublons
    from (select produit_id, categorie_acte from public.garanties
           where deleted_at is null group by 1, 2 having count(*) > 1) d;
  if doublons is not null then
    raise exception 'Garanties en double pour une même catégorie (produit/catégorie) : %', doublons;
  end if;

  select count(*) into sans_taux from public.garanties where taux_couverture is null;
  if sans_taux > 0 then
    raise exception '% garantie(s) sans taux de couverture : à renseigner avant migration', sans_taux;
  end if;
end $$;

-- --- 4. Contraintes ----------------------------------------------------------

alter table public.garanties drop constraint if exists garanties_categorie_acte_fkey;
alter table public.garanties
  add constraint garanties_categorie_acte_fkey
  foreign key (categorie_acte) references public.categories_acte (code);

alter table public.actes_dossier drop constraint if exists actes_dossier_categorie_acte_fkey;
alter table public.actes_dossier
  add constraint actes_dossier_categorie_acte_fkey
  foreign key (categorie_acte) references public.categories_acte (code);

alter table public.referentiel_actes drop constraint if exists referentiel_actes_categorie_fkey;
alter table public.referentiel_actes
  add constraint referentiel_actes_categorie_fkey
  foreign key (categorie) references public.categories_acte (code);

alter table public.referentiel_national_actes drop constraint if exists referentiel_national_actes_categorie_fkey;
alter table public.referentiel_national_actes
  add constraint referentiel_national_actes_categorie_fkey
  foreign key (categorie) references public.categories_acte (code);

-- une seule garantie active par (produit, catégorie) : l'appariement acte ↔
-- garantie n'est plus ambigu (une Map gardait silencieusement la dernière).
create unique index if not exists garanties_produit_categorie_unique
  on public.garanties (produit_id, categorie_acte) where deleted_at is null;

-- plus de taux par défaut implicite (80 % côté NestJS, 100 % côté Java)
alter table public.garanties alter column taux_couverture set not null;

-- --- 5. Catégories confirmées « non couvertes » à la publication ------------

alter table public.produits
  add column if not exists categories_non_couvertes text[] not null default '{}';

-- --- 6. Réclamation rejetée « catégorie non couverte » (E011) ---------------

alter table public.reclamations alter column garantie_id drop not null;
alter table public.reclamations drop constraint if exists reclamations_garantie_ou_non_couverte;
alter table public.reclamations
  add constraint reclamations_garantie_ou_non_couverte
  check (garantie_id is not null or (statut = 'REJETE' and 'E011' = any (codes_rejet)));

commit;
