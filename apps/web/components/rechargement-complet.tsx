'use client';

import { useEffect } from 'react';

/**
 * Recharge l'URL courante en navigation complète : la route interceptée cède
 * alors la place à la vraie page (les rechargements ne sont jamais interceptés).
 */
export function RechargementComplet() {
  useEffect(() => {
    window.location.replace(window.location.href);
  }, []);
  return null;
}
