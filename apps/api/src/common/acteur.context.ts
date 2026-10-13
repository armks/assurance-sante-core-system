import { AsyncLocalStorage } from 'node:async_hooks';

/** Périmètre de l'acteur au moment de l'action (le rôle et le rattachement peuvent changer ensuite). */
export interface PerimetreActeur {
  role: string | null;
  organisationId: string | null;
  etablissementId: string | null;
  pharmacieId: string | null;
  societeId: string | null;
}

/**
 * Utilisateur authentifié à l'origine de la requête en cours : propagé à tout le code asynchrone qu'elle déclenche
 * (services, transactions) sans le passer en paramètre — c'est ce qui permet de tracer CHAQUE écriture (journal des actions).
 */
export interface ActeurCourant {
  userId: string;
  /** Périmètre chargé à la première écriture de la requête, puis réutilisé. */
  perimetre?: Promise<PerimetreActeur>;
}

export const acteurStorage = new AsyncLocalStorage<ActeurCourant>();

export function acteurCourant(): ActeurCourant | undefined {
  return acteurStorage.getStore();
}
