-- ===========================================================================
-- Correctif — audit_log.id sans valeur par défaut
--
-- Découvert au PROMPT 4 : la fonction log_audit() (skill 01-plan-directeur-v9
-- §1.6) n'insère PAS de valeur pour audit_log.id, ce qui suppose que la colonne
-- porte `default gen_random_uuid()`. La table réelle (créée au PROMPT 1) avait
-- `id uuid primary key` SANS défaut → tout appel à log_audit() échouait en
-- 23502 (not-null violation). L'audit n'avait jamais réellement fonctionné
-- (aucun chemin d'écriture ne l'exerçait avant le module tenant).
--
-- Appliqué le 2026-09-09 via `prisma db execute`.
-- ===========================================================================
alter table public.audit_log
  alter column id set default gen_random_uuid();
