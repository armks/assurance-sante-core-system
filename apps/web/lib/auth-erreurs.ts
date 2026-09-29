/**
 * Traduit en français les erreurs Supabase Auth affichées dans les parcours
 * d'authentification (connexion, mot de passe oublié / mis à jour, inscription).
 * On se base sur `error.code` (stable) plutôt que sur le message anglais.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed:
    'Votre adresse e-mail n’est pas encore confirmée. Consultez le lien reçu par e-mail.',
  user_banned: 'Ce compte est suspendu. Contactez votre administrateur.',
  user_not_found: 'Aucun compte ne correspond à cette adresse e-mail.',
  email_address_invalid: 'Adresse e-mail invalide.',
  email_address_not_authorized: 'Cette adresse e-mail n’est pas autorisée.',
  email_exists: 'Un compte existe déjà avec cette adresse e-mail.',
  user_already_exists: 'Un compte existe déjà avec cette adresse e-mail.',
  signup_disabled:
    'La création de compte est désactivée. Un compte est créé par votre administrateur.',
  weak_password:
    'Mot de passe trop faible. Utilisez au moins 8 caractères, avec lettres et chiffres.',
  same_password: 'Le nouveau mot de passe doit être différent de l’actuel.',
  session_not_found:
    'Votre session a expiré. Recommencez la procédure depuis le lien reçu par e-mail.',
  session_expired:
    'Votre session a expiré. Recommencez la procédure depuis le lien reçu par e-mail.',
  otp_expired: 'Ce lien a expiré. Demandez un nouvel e-mail de réinitialisation.',
  reauthentication_needed:
    'Pour des raisons de sécurité, reconnectez-vous avant de changer votre mot de passe.',
  over_request_rate_limit:
    'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  over_email_send_rate_limit:
    'Trop d’e-mails envoyés. Patientez quelques minutes avant de réessayer.',
  captcha_failed: 'La vérification de sécurité a échoué. Réessayez.',
  validation_failed: 'Les informations saisies sont invalides.',
  request_timeout: 'Le serveur met trop de temps à répondre. Réessayez.',
};

const ERREUR_GENERIQUE = 'Une erreur est survenue. Réessayez dans un instant.';

export function messageErreurAuth(error: unknown): string {
  if (!error || typeof error !== 'object') return ERREUR_GENERIQUE;
  const { code, status, message } = error as {
    code?: string;
    status?: number;
    message?: string;
  };

  if (code && MESSAGES[code]) return MESSAGES[code];
  // AuthRetryableFetchError (status 0) / fetch échoué : serveur injoignable
  if (status === 0 || (message && /failed to fetch|network/i.test(message))) {
    return 'Impossible de joindre le serveur. Vérifiez votre connexion.';
  }
  if (status === 429) return MESSAGES.over_request_rate_limit;
  return ERREUR_GENERIQUE;
}
