'use client';

import { useEffect } from 'react';

/**
 * « Échap » ferme d'abord le tableau de résultats d'une recherche, pas la fenêtre du formulaire qui le contient : la fenêtre (Radix) écoute
 * sur le document, on intercepte donc plus haut, sur `window`, en phase de capture, tant que le tableau est visible.
 */
export function useEchapFermeTableau(visible: boolean, fermer: () => void) {
  useEffect(() => {
    if (!visible) return;
    const surEchap = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      fermer();
    };
    window.addEventListener('keydown', surEchap, true);
    return () => window.removeEventListener('keydown', surEchap, true);
  }, [visible, fermer]);
}
