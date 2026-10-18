-- Prix des licences et historique : grille de tarifs par type de licence (modifiable par le superadmin) et prix « figé » au moment
-- où chaque licence est générée ou activée (un changement de tarif n'altère jamais l'historique).
create table if not exists public.tarifs_licence (
  type_licence text primary key check (type_licence in ('ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE')),
  prix         numeric(14, 2) not null default 0 check (prix >= 0),
  devise       text not null default 'XOF',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profils (id)
);
alter table public.tarifs_licence enable row level security;

-- tarifs de départ (FCFA) : valeurs à ajuster par le superadmin dans l'application
insert into public.tarifs_licence (type_licence, prix) values
  ('ESSAI', 0), ('MENSUELLE', 150000), ('TRIMESTRIELLE', 400000), ('SEMESTRIELLE', 750000), ('ANNUELLE', 1400000), ('BIENNALE', 2600000)
on conflict (type_licence) do nothing;

alter table public.codes_activation_licence add column if not exists prix numeric(14, 2) not null default 0 check (prix >= 0);
alter table public.codes_activation_licence add column if not exists mode text not null default 'CODE' check (mode in ('CODE', 'DIRECTE'));

-- historique existant : prix au tarif actuel de son type
update public.codes_activation_licence c set prix = t.prix from public.tarifs_licence t where t.type_licence = c.type_licence and c.prix = 0;
-- activations directes passées : ligne créée déjà activée avec expiration = activation
update public.codes_activation_licence set mode = 'DIRECTE' where statut = 'ACTIVE' and date_activation is not null and date_expiration <= date_activation;

-- supprimer le compte d'un superadmin ne doit pas être bloqué par la trace « modifié par » d'un tarif
alter table public.tarifs_licence drop constraint if exists tarifs_licence_updated_by_fkey;
alter table public.tarifs_licence add constraint tarifs_licence_updated_by_fkey foreign key (updated_by) references public.profils (id) on delete set null;
