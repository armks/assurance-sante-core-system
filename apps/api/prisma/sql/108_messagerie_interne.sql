-- Messagerie interne instantanée : conversations privées 1 à 1 sur invitation, messages et fichiers joints (bucket privé « messagerie »).
-- Les données sont TEMPORAIRES : tout est supprimé le 1er de chaque mois à 00h00 (tâche de purge de l'API).
create table if not exists public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  -- paire ordonnée (user_a < user_b) : une seule conversation par couple de comptes
  user_a           uuid not null references public.profils (id) on delete cascade,
  user_b           uuid not null references public.profils (id) on delete cascade,
  initiateur       uuid not null references public.profils (id) on delete cascade,
  statut           text not null default 'INVITATION' check (statut in ('INVITATION', 'ACTIVE', 'REFUSEE')),
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  last_message_at  timestamptz not null default now(),
  check (user_a < user_b),
  check (initiateur = user_a or initiateur = user_b),
  unique (user_a, user_b)
);
create index if not exists chat_conversations_user_a_idx on public.chat_conversations (user_a);
create index if not exists chat_conversations_user_b_idx on public.chat_conversations (user_b);

create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  expediteur_id    uuid not null references public.profils (id) on delete cascade,
  contenu          text check (contenu is null or char_length(contenu) between 1 and 2000),
  fichier_chemin   text,
  fichier_nom      text,
  fichier_type     text,
  fichier_taille   integer check (fichier_taille is null or fichier_taille between 1 and 5242880),
  created_at       timestamptz not null default now(),
  lu_le            timestamptz,
  check (contenu is not null or fichier_chemin is not null),
  check ((fichier_chemin is null) = (fichier_nom is null))
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, created_at);

-- dernier mois purgé (la purge du 1er du mois est idempotente et se rattrape si l'API était arrêtée à minuit)
create table if not exists public.chat_purge_etat (
  cle          text primary key,
  valeur       text not null,
  mis_a_jour   timestamptz not null default now()
);

-- aucune lecture directe via PostgREST : l'accès passe uniquement par l'API
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_purge_etat enable row level security;

-- bucket privé des fichiers joints (5 Mo max, types limités)
insert into storage.buckets (id, name, public, file_size_limit)
values ('messagerie', 'messagerie', false, 5242880)
on conflict (id) do nothing;
