-- Codes à usage unique protégés et TEMPORAIRES.
--  * `code` / `code_facturation` / `code_confirmation` ne contiennent plus que l'empreinte HMAC-SHA256 du code
--    (recherche et unicité) ; la version lisible est chiffrée AES-256-GCM dans `*_chiffre` (common/codes-secrets.ts).
--  * le code de facturation et le code de confirmation de dispensation reçoivent une date d'expiration.
-- Idempotent. La conversion des codes existants se fait par script applicatif (la clé reste hors base).

alter table public.codes_consultation        add column if not exists code_chiffre text;
alter table public.codes_ordonnance          add column if not exists code_chiffre text;
alter table public.codes_validation_superadmin add column if not exists code_chiffre text;
alter table public.factures_dossier          add column if not exists code_facturation_chiffre text;
alter table public.factures_dossier          add column if not exists code_facturation_expire_le timestamptz;
alter table public.dispensations_pharmacie   add column if not exists code_confirmation_chiffre text;
alter table public.dispensations_pharmacie   add column if not exists code_confirmation_expire_le timestamptz;

-- l'empreinte (64 caractères hexadécimaux) remplace le code de 6 à 8 caractères : contraintes de format retirées
alter table public.codes_consultation          drop constraint if exists codes_consultation_code_check;
alter table public.codes_ordonnance            drop constraint if exists codes_ordonnance_code_check;
alter table public.codes_validation_superadmin drop constraint if exists codes_validation_superadmin_code_check;
alter table public.factures_dossier            drop constraint if exists factures_dossier_code_facturation_check;
alter table public.dispensations_pharmacie     drop constraint if exists dispensations_pharmacie_code_confirmation_check;

alter table public.codes_consultation          add constraint codes_consultation_code_check check (code ~ '^[A-Z0-9]{6,64}$');
alter table public.codes_ordonnance            add constraint codes_ordonnance_code_check check (code ~ '^[A-Z0-9]{6,64}$');
alter table public.codes_validation_superadmin add constraint codes_validation_superadmin_code_check check (code ~ '^[A-Z0-9]{6,64}$');
alter table public.factures_dossier            add constraint factures_dossier_code_facturation_check check (code_facturation is null or code_facturation ~ '^[A-Z0-9]{6,64}$');
alter table public.dispensations_pharmacie     add constraint dispensations_pharmacie_code_confirmation_check check (code_confirmation is null or code_confirmation ~ '^[A-Z0-9]{6,64}$');

-- codes déjà émis et encore utilisables : durée de vie à partir de la migration (24 h facturation, 2 h confirmation)
update public.factures_dossier set code_facturation_expire_le = now() + interval '24 hours'
  where code_facturation is not null and code_valide_par_patient = false and code_facturation_expire_le is null;
update public.dispensations_pharmacie set code_confirmation_expire_le = now() + interval '2 hours'
  where code_confirmation is not null and statut = 'EN_ATTENTE_VALIDATION_PATIENT' and code_confirmation_expire_le is null;
