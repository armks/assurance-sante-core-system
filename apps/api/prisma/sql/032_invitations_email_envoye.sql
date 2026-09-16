-- ===========================================================================
-- 032 — Visibilité de l'échec d'envoi d'e-mail sur les invitations.
--
-- Constat : `emailEnvoye` (résultat de SupabaseAdminService.inviterUtilisateur)
-- n'était retourné qu'UNE FOIS, dans la réponse immédiate de creerInvitation/
-- validerProposition — jamais persisté, donc invisible dès que l'informaticien
-- recharge l'écran Utilisateurs. Un échec d'envoi (SMTP par défaut Supabase
-- rate-limité, confirmé 429 `over_email_send_rate_limit` dans cet
-- environnement) devenait alors silencieusement indiscernable d'un envoi
-- réussi.
--
-- NULL = aucune tentative d'envoi réel encore effectuée (proposition encore
-- EN_ATTENTE_VALIDATION_INFORMATIQUE, ou lignes historiques créées avant cette
-- migration — on ne invente pas une valeur qu'on n'a jamais mesurée).
-- true/false = résultat du DERNIER essai réel (création, validation de
-- proposition, ou renvoi manuel).
-- ===========================================================================

alter table public.invitations add column if not exists email_envoye boolean;

comment on column public.invitations.email_envoye is
  'Résultat du dernier essai réel d''envoi de l''e-mail Supabase. NULL = aucun essai encore tenté.';
