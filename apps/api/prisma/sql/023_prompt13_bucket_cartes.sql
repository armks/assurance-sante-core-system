-- ===========================================================================
-- PROMPT 13 — Cartes de membre : bucket de stockage privé `cartes`
--
-- Réf. : plan directeur v9 §3 phase 3 (génération de cartes de membre).
-- Appliqué le 2026-09-10 via `prisma db execute --file`.
--
-- Le bucket est PRIVÉ : aucune policy sur `storage.objects` pour ce bucket →
-- inaccessible en anon / authenticated. Seul le rôle `service_role` (utilisé
-- par MemberCarteService côté NestJS, via l'API Storage REST) y écrit et y
-- génère des URL signées à durée limitée. Cohérent avec ADR-002 (pas d'accès
-- direct hors NestJS aux données sensibles).
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cartes', 'cartes', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
