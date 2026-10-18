-- Rendez-vous : agenda de présence des médecins d'un établissement sanitaire, propositions de rendez-vous par la secrétaire / l'exploitation de
-- l'assurance, confirmation ou modification par l'accueil / le médecin de l'établissement. Nouveau rôle « Secrétaire assurance ».
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --- Rôle ASSUREUR_SECRETAIRE (créé par l'informatique de l'assurance, comme les autres comptes de la société)
insert into public.sous_roles (code, entite_code, libelle, role_parent_code, niveau_acces, peut_valider, dashboard_route)
values ('ASSUREUR_SECRETAIRE', 'ASSUREUR', 'Secrétaire assurance', null, 'MODIFICATION', false, '/dashboard-assureur/secretaire')
on conflict (code) do nothing;

insert into public.regles_provisioning (role_createur, role_cree, scope_verifie, mode, role_validateur)
values ('ASSUREUR_INFORMATIQUE', 'ASSUREUR_SECRETAIRE', 'organisation_id', 'CREATION_DIRECTE', null)
on conflict (role_createur, role_cree) do nothing;

-- --- Agenda de présence : règle par date précise, par jour de la semaine (récurrent) ou absence ; heures et durée des créneaux
create table if not exists public.disponibilites_medecin (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  etablissement_id   uuid not null references public.etablissements_sante (id) on delete cascade,
  medecin_id         uuid not null references public.profils (id) on delete cascade,
  type               text not null check (type in ('DATE', 'JOUR', 'ABSENCE')),
  date_jour          date,
  jour_semaine       smallint check (jour_semaine between 1 and 7),
  valide_du          date,
  valide_au          date,
  heure_debut        time not null,
  heure_fin          time not null,
  duree_creneau_min  smallint check (duree_creneau_min between 5 and 240),
  cree_par           uuid references public.profils (id) on delete set null,
  created_at         timestamptz not null default now(),
  check (heure_fin > heure_debut),
  check (valide_au is null or valide_du is null or valide_au >= valide_du),
  check ((type = 'JOUR' and jour_semaine is not null and date_jour is null)
      or (type in ('DATE', 'ABSENCE') and date_jour is not null and jour_semaine is null)),
  check (type = 'ABSENCE' or duree_creneau_min is not null)
);
create index if not exists disponibilites_medecin_idx on public.disponibilites_medecin (medecin_id, type);
create index if not exists disponibilites_medecin_etab_idx on public.disponibilites_medecin (etablissement_id);

-- --- Rendez-vous
create table if not exists public.rendez_vous (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  etablissement_id    uuid not null references public.etablissements_sante (id) on delete cascade,
  medecin_id          uuid not null references public.profils (id) on delete cascade,
  adherent_id         uuid not null references public.adherents (id) on delete cascade,
  beneficiaire_id     uuid references public.beneficiaires (id) on delete cascade,
  date_debut          timestamptz not null,
  date_fin            timestamptz not null,
  motif               text check (motif is null or char_length(motif) <= 300),
  statut              text not null default 'PROPOSE' check (statut in ('PROPOSE', 'CONFIRME', 'REFUSE', 'ANNULE')),
  propose_par         uuid references public.profils (id) on delete set null,
  traite_par          uuid references public.profils (id) on delete set null,
  traite_le           timestamptz,
  motif_refus         text check (motif_refus is null or char_length(motif_refus) <= 300),
  modifie             boolean not null default false,
  ancienne_date_debut timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (date_fin > date_debut),
  -- un médecin ne peut pas avoir deux rendez-vous (proposés ou confirmés) qui se chevauchent
  constraint rendez_vous_pas_de_chevauchement
    exclude using gist (medecin_id with =, tstzrange(date_debut, date_fin) with &&) where (statut in ('PROPOSE', 'CONFIRME'))
);
create index if not exists rendez_vous_etab_idx on public.rendez_vous (etablissement_id, date_debut);
create index if not exists rendez_vous_adherent_idx on public.rendez_vous (adherent_id);
create index if not exists rendez_vous_org_idx on public.rendez_vous (organisation_id, statut);

-- aucune lecture directe via PostgREST : l'accès passe uniquement par l'API
alter table public.disponibilites_medecin enable row level security;
alter table public.rendez_vous enable row level security;
