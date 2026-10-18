-- Jetons d'invitation : plus jamais en clair en base (même protection que les codes à usage unique, prisma/sql/103).
--  * `token` ne contient plus que l'empreinte HMAC-SHA256 ; la version lisible (renvoi du lien) est chiffrée dans `token_chiffre`.
--  * la conversion des jetons existants se fait par script applicatif (la clé reste hors base).
--  * le jeton n'est plus copié dans les métadonnées des comptes Supabase Auth (il y figurait en clair et dans le JWT de l'utilisateur).
alter table public.invitations add column if not exists token_chiffre text;

update auth.users
   set raw_user_meta_data = raw_user_meta_data - 'invitation_token'
 where raw_user_meta_data ? 'invitation_token';
