'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Courbe du méga menu (cubic-bezier(0.4, 0, 0.2, 1)) : départ doux, vitesse maximale au milieu, arrivée en douceur. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (p: number) => {
    let t = p;
    for (let i = 0; i < 8; i++) {
      const e = x(t) - p;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return y(Math.min(1, Math.max(0, t)));
  };
}
const adoucir = bezier(0.4, 0, 0.2, 1);

/** Durée : 1,4 s minimum (comme l'ouverture du méga menu), jusqu'à 2,4 s pour les longues distances. */
const duree = (distance: number) => Math.min(2400, Math.max(1400, 900 + Math.abs(distance) * 0.45));

/**
 * Défilement LENT vers les ancres de la page (« Qui sommes-nous », « Contact », « Découvrir le réseau », « Nous contacter »…) : au clic,
 * la page glisse jusqu'à la section en 1,4 à 2,4 s avec la courbe douce du méga menu, au lieu de sauter. La section arrive sous
 * l'en-tête collant (marge `scroll-margin-top` de la section respectée). L'adresse reçoit l'ancre (`#contact`) ; le visiteur peut
 * interrompre le défilement à tout moment (molette, toucher, clavier) ; arrivée depuis une autre page sur `/#contact` : même glissement.
 * Désactivé (saut immédiat habituel) si l'utilisateur préfère réduire les animations. Monté une fois dans le layout racine.
 */
export function DefilementAncres() {
  const chemin = usePathname();

  useEffect(() => {
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let image: number | null = null;

    const arreter = () => {
      if (image !== null) cancelAnimationFrame(image);
      image = null;
    };

    const cibleDe = (id: string): number | null => {
      const el = document.getElementById(decodeURIComponent(id));
      if (!el) return null;
      const marge = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      return Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - marge));
    };

    const glisser = (cible: number) => {
      arreter();
      const depart = window.scrollY;
      const distance = cible - depart;
      if (Math.abs(distance) < 2) return;
      const d = duree(distance);
      const t0 = performance.now();
      const pas = (maintenant: number) => {
        const p = Math.min(1, (maintenant - t0) / d);
        window.scrollTo(0, depart + distance * adoucir(p));
        image = p < 1 ? requestAnimationFrame(pas) : null;
      };
      image = requestAnimationFrame(pas);
    };

    const surClic = (e: MouseEvent) => {
      if (reduit || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      // seulement une ancre de LA page courante
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash || url.hash.length < 2) return;
      const cible = cibleDe(url.hash.slice(1));
      if (cible === null) return;
      e.preventDefault();
      glisser(cible);
      window.history.pushState(null, '', url.hash);
    };

    // le visiteur reprend la main : on s'arrête immédiatement
    const interrompre = () => arreter();
    document.addEventListener('click', surClic);
    window.addEventListener('wheel', interrompre, { passive: true });
    window.addEventListener('touchstart', interrompre, { passive: true });
    const surTouche = (e: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) arreter();
    };
    window.addEventListener('keydown', surTouche);

    // arrivée sur `/#contact` depuis une autre page : on repart du haut et on glisse jusqu'à la section
    let depart: ReturnType<typeof setTimeout> | undefined;
    if (!reduit && window.location.hash.length > 1) {
      const id = window.location.hash.slice(1);
      window.scrollTo(0, 0);
      depart = setTimeout(() => {
        const c = cibleDe(id);
        if (c !== null) glisser(c);
      }, 450);
    }

    return () => {
      clearTimeout(depart);
      arreter();
      document.removeEventListener('click', surClic);
      window.removeEventListener('wheel', interrompre);
      window.removeEventListener('touchstart', interrompre);
      window.removeEventListener('keydown', surTouche);
    };
  }, [chemin]);

  return null;
}
