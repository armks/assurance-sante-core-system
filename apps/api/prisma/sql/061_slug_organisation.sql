-- ===========================================================================
-- Page d'accueil dédiée par société : https://<domaine>/<slug>.
--
-- `organisations.slug` : unique, minuscules, chiffres et tirets
-- (^[a-z0-9]+(-[a-z0-9]+)*$, 2 à 60 caractères). Généré depuis `nom` à la
-- création (SuperadminActionsService), modifiable EXCLUSIVEMENT par
-- SUPERADMIN_PRINCIPAL (OrganisationsService.modifierSlug).
--
-- Segments réservés (routes existantes de l'application, ressources
-- techniques) : interdits par contrainte, en plus du contrôle NestJS
-- (common/slug.util.ts) et du proxy Next.js (lib/slugs.ts) — mêmes listes.
-- ===========================================================================

alter table public.organisations add column if not exists slug text;

-- Remplissage des organisations existantes : nom sans accents, en minuscules,
-- tout ce qui n'est ni lettre ni chiffre → tiret ; doublons suffixés -2, -3…
with base as (
  select id,
         coalesce(
           nullif(
             left(
               trim(both '-' from regexp_replace(
                 lower(translate(nom,
                   'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿŒœÆæ',
                   'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyyOoAa')),
                 '[^a-z0-9]+', '-', 'g')),
               60),
             ''),
           'organisation') as s
  from public.organisations
  where slug is null
),
numerote as (
  select id, s, row_number() over (partition by s order by id) as n from base
)
update public.organisations o
set slug = case when numerote.n = 1 then numerote.s else left(numerote.s, 56) || '-' || numerote.n end
from numerote
where o.id = numerote.id;

alter table public.organisations alter column slug set not null;

create unique index if not exists organisations_slug_unique on public.organisations (slug);

alter table public.organisations drop constraint if exists organisations_slug_format;
alter table public.organisations
  add constraint organisations_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60);

alter table public.organisations drop constraint if exists organisations_slug_non_reserve;
alter table public.organisations
  add constraint organisations_slug_non_reserve
    check (
      slug !~ '^dashboard'
      and slug not in (
        'accepter-invitation', 'admin', 'api', 'auth', 'favicon', 'images', 'login',
        'logout', 'protected', 'public', 'reseau-de-soins', 'robots', 'sitemap',
        'static', 'superadmin'
      )
    );
