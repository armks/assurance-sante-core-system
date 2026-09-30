-- ===========================================================================
-- Inscriptions à la newsletter depuis la page d'accueil publique (module
-- NestJS `vitrine`). Aucun envoi automatique pour l'instant : la table ne fait
-- que stocker les adresses.
--
-- Pas d'organisation_id : la page publique est commune à la plateforme (même
-- principe que parametres_plateforme / catalogue national, prisma/sql/017).
-- `email` stocké en minuscules et unique : une ré-inscription de la même
-- adresse est idempotente (pas de doublon, pas d'erreur révélant qu'elle
-- existe déjà). `deleted_at` servira à la désinscription.
--
-- RLS activée SANS aucune policy : table inaccessible en anon/authenticated,
-- seul NestJS (connexion Prisma) y écrit. Aucune lecture exposée à ce jour.
-- ===========================================================================

create table if not exists public.newsletter_abonnes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint newsletter_abonnes_email_minuscules check (email = lower(email)),
  constraint newsletter_abonnes_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index if not exists newsletter_abonnes_email_unique
  on public.newsletter_abonnes (email);

alter table public.newsletter_abonnes enable row level security;
