import { lireSession } from '@/lib/session';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * Appel serveur vers l'API NestJS, avec le jeton de session Supabase de
 * l'utilisateur courant en `Authorization: Bearer`. À utiliser dans les Server
 * Components et Server Actions uniquement.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await lireSession();

  const headers = new Headers(init.headers);
  // FormData (upload multipart, ex. pièces justificatives) : laisser fetch
  // poser lui-même Content-Type avec la boundary — jamais application/json.
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}

/** Appel serveur SANS authentification (parcours public, ex: acceptation). */
export async function apiFetchPublic(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

/**
 * Message de repli quand la réponse n'en porte pas (proxy, répartiteur de charge,
 * service arrêté) : jamais le `statusText` technique anglais (« Service Unavailable »).
 */
function messageRepli(res: Response): string {
  if ([502, 503, 504].includes(res.status)) {
    return 'Service momentanément indisponible. Réessayez dans quelques minutes.';
  }
  return `Une erreur est survenue (code ${res.status}).`;
}

/** Extrait un message d'erreur lisible d'une réponse NestJS. */
export async function messageErreur(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(' ');
    return body.message ?? messageRepli(res);
  } catch {
    return messageRepli(res);
  }
}

/**
 * Détail d'une erreur NestJS pour les formulaires : `error` = résumé,
 * `erreurs` = la liste des messages de validation (class-validator) le cas échéant.
 */
export async function detailErreur(
  res: Response,
): Promise<{ error: string; erreurs: string[] }> {
  try {
    const body = (await res.json()) as {
      message?: string | string[];
      error?: string;
    };
    if (Array.isArray(body.message)) {
      return {
        error:
          body.error ?? 'Certains champs sont invalides.',
        erreurs: body.message,
      };
    }
    return { error: body.message ?? messageRepli(res), erreurs: [] };
  } catch {
    return { error: messageRepli(res), erreurs: [] };
  }
}
