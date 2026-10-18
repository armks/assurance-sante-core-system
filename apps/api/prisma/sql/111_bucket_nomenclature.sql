-- Bucket privé « nomenclature » : texte officiel de la Nomenclature générale des actes de médecine et de biologie de Côte d'Ivoire
-- (NGAMBCI, décembre 2019, Comité technique CMU), consultable en PDF depuis le catalogue national. Accès par l'API uniquement.
insert into storage.buckets (id, name, public, file_size_limit)
values ('nomenclature', 'nomenclature', false, 26214400)
on conflict (id) do nothing;
