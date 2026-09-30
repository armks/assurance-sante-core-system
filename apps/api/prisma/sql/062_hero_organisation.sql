-- ===========================================================================
-- En-tête (bannière « hero ») personnalisable de la page d'accueil d'une
-- société (/{slug}). Les trois champs sont facultatifs : tant qu'aucun n'est
-- renseigné, la page garde la bannière par défaut de la plateforme ; un champ
-- vide reprend la valeur par défaut correspondante (jamais de section vide).
--
-- Écriture réservée à ASSUREUR_INFORMATIQUE de l'organisation (rôle exact,
-- vérifié par EvenementsService — écran « Événements »). La table
-- `organisations` n'a qu'une policy `organisations_service_role_only` : aucun
-- client ne peut y écrire directement, seul NestJS (service) le fait.
--
-- `hero_image_url` : URL publique dans le bucket PUBLIC `evenements`
-- (prisma/sql/060), sous `{organisation_id}/hero-{horodatage}.{ext}`.
-- ===========================================================================

alter table public.organisations add column if not exists hero_titre text;
alter table public.organisations add column if not exists hero_sous_titre text;
alter table public.organisations add column if not exists hero_image_url text;

alter table public.organisations drop constraint if exists organisations_hero_titre_longueur;
alter table public.organisations
  add constraint organisations_hero_titre_longueur
    check (hero_titre is null or char_length(hero_titre) between 2 and 120);

alter table public.organisations drop constraint if exists organisations_hero_sous_titre_longueur;
alter table public.organisations
  add constraint organisations_hero_sous_titre_longueur
    check (hero_sous_titre is null or char_length(hero_sous_titre) between 2 and 300);
