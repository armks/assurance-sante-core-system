-- ===========================================================================
-- Recherche serveur insensible aux accents (pagination serveur des listes
-- longues : actes / ordonnances à examiner, dispensations, codes adhérent…).
--
-- Même règle que la recherche des tableaux côté web (lib/recherche-texte.ts) :
-- casse et accents ignorés, apostrophes typographiques ramenées à « ' ».
-- `unaccent` est installée dans le schéma `extensions` (convention Supabase) ;
-- `public.sans_accent` l'enveloppe avec le dictionnaire explicite, ce qui la
-- rend IMMUTABLE (indexable si besoin plus tard).
-- ===========================================================================

create extension if not exists unaccent with schema extensions;

create or replace function public.sans_accent(texte text)
returns text
language sql
immutable
parallel safe
set search_path = extensions, public
as $$
  select translate(
    extensions.unaccent('extensions.unaccent'::regdictionary, lower(coalesce(texte, ''))),
    '’‘ʼ',
    $q$'''$q$
  );
$$;
