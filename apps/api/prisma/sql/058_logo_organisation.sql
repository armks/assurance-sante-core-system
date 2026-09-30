-- ===========================================================================
-- Logo de l'organisation (assureur) — affiché dans l'en-tête de la carte de
-- membre PDF (MemberCarteService). Modifiable EXCLUSIVEMENT par
-- SUPERADMIN_PRINCIPAL (OrganisationsService.modifierLogoOrganisation).
--
-- `logo_url` = URL publique de l'objet dans le bucket `logos` (null tant
-- qu'aucun logo n'a été téléversé : la carte se génère alors sans logo).
--
-- Bucket `logos` PUBLIC en lecture : un logo est destiné à un document
-- imprimable, ce n'est pas une donnée sensible (à la différence de `cartes`
-- et `photos`, privés). Écriture uniquement par `service_role` via NestJS :
-- aucune policy d'écriture sur `storage.objects` pour ce bucket. PNG/JPEG
-- seulement — les deux formats que pdf-lib sait embarquer dans la carte.
-- ===========================================================================

alter table public.organisations
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
