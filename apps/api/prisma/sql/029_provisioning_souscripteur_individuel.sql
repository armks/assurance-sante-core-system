-- ===========================================================================
-- 029 — Provisioning réel pour SOUSCRIPTEUR_INDIVIDUEL, corrige le 404
-- identifié à l'audit de couverture frontend.
--
-- Constat exact (vérifié avant toute correction, comme demandé) :
-- `regles_provisioning` couvrait 22 des 25 sous-rôles, mais AUCUNE règle
-- n'existait pour créer un compte ADHERENT_TITULAIRE ni SOUSCRIPTEUR_INDIVIDUEL
-- — toute l'entité ADHERENT était sans chemin de provisioning applicatif
-- (`member/adherent.service.ts::creerAdherent` ne crée que la fiche métier,
-- jamais de compte Supabase/profil lié). Ce n'était donc pas un problème de
-- valeur mal posée dans `profil.societe_id`, mais l'absence totale du chemin
-- de création.
--
-- Principe retenu (même logique que les sociétés clientes, sur demande
-- explicite) : un souscripteur individuel est un `souscripteurs` de type
-- INDIVIDUEL (déjà supporté par `POST /tenant/souscripteurs`), avec sa propre
-- police personnalisable (`policy/`) — exactement comme une société a ses
-- propres adhérents. `ASSUREUR_INFORMATIQUE` (déjà créateur direct de tous les
-- rôles SOCIETE_*) crée ce compte via `POST /invitations` en renseignant
-- `societeId` (le souscripteur INDIVIDUEL) ET `adherentId` (la fiche adhérent
-- de cette même personne, créée séparément via `POST /member/adherents`) —
-- le mécanisme générique `resoudreScope()`/`accepterInvitation()` copie déjà
-- fidèlement les deux vers `profil.societe_id`/`profil.adherent_id`, aucun
-- code applicatif à modifier. `peut_inviter_role()` (RLS, prisma/sql/008)
-- lit cette même table : aucune modification SQL séparée nécessaire non plus.
-- ===========================================================================

insert into public.regles_provisioning (role_createur, role_cree, scope_verifie, mode, role_validateur)
values ('ASSUREUR_INFORMATIQUE', 'SOUSCRIPTEUR_INDIVIDUEL', 'organisation_id', 'CREATION_DIRECTE', null)
on conflict on constraint regles_provisioning_unique do nothing;
