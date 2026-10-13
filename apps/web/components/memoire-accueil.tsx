'use client';

import { useEffect } from 'react';

/** Clé de session : la page d'accueil la plus récemment visitée (`/` ou la page `/{slug}` d'une société). */
export const CLE_ACCUEIL_ORIGINE = 'accueil-origine';

/** Seules ces formes sont acceptées comme destination (jamais une adresse externe ni un chemin arbitraire). */
export const FORME_ACCUEIL = /^\/([a-z0-9][a-z0-9-]*)?$/;

/**
 * Retient, pour la durée de l'onglet, la page d'accueil que le visiteur vient de consulter (plateforme ou société) : les pages de connexion et
 * d'authentification y reconduisent ensuite (`LienAccueil`), même après un rechargement de la page.
 */
export function MemoireAccueil({ racine }: { racine: string }) {
  useEffect(() => {
    try {
      if (FORME_ACCUEIL.test(racine)) sessionStorage.setItem(CLE_ACCUEIL_ORIGINE, racine);
    } catch {
      /* stockage indisponible : le lien ramènera à l'accueil de la plateforme */
    }
  }, [racine]);
  return null;
}
