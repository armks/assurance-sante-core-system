-- ===========================================================================
-- Demandes du formulaire « Adhésion » de la page d'accueil (module NestJS
-- `vitrine`). Jusqu'ici la demande ne partait QUE par e-mail : si l'envoi
-- échouait, elle était perdue. Elle est désormais enregistrée AVANT l'envoi
-- de l'e-mail (qui reste en place) ; `email_envoye` trace le résultat.
--
-- `organisation_id` : la société de la page d'où vient la demande (/{slug}),
-- ou, depuis la page commune « / », l'organisation vitrine
-- (VITRINE_ORGANISATION_ID) — NULL seulement si aucune n'est configurée.
--
-- Consultation : ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION de
-- l'organisation (vérifié par VitrineService), qui peuvent passer une demande
-- de NOUVEAU à TRAITE (tracé par log_audit). RLS activée SANS policy : comme
-- newsletter_abonnes, seul NestJS (connexion Prisma) lit et écrit.
-- ===========================================================================

create table if not exists public.demandes_adhesion (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  nom_societe     text not null,
  nombre_estime   integer not null,
  email           text not null,
  telephone       text not null,
  objet           text not null,
  message         text,
  statut          text not null default 'NOUVEAU',
  email_envoye    boolean,
  traite_par      uuid references public.profils(id),
  traite_le       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint demandes_adhesion_statut check (statut in ('NOUVEAU', 'TRAITE')),
  constraint demandes_adhesion_nombre_estime check (nombre_estime between 1 and 1000000),
  constraint demandes_adhesion_traitement check (
    (statut = 'TRAITE') = (traite_le is not null)
  )
);

create index if not exists demandes_adhesion_organisation_idx
  on public.demandes_adhesion (organisation_id, statut, created_at desc);

alter table public.demandes_adhesion enable row level security;
