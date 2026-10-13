'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const VU = 'data-defilement-vu';

/**
 * Blocs d'une page à animer : on descend dans les enveloppes à enfant unique (`main > div > div.space-y-8 > …`) puis on prend les
 * enfants. Sur la page d'accueil (plusieurs sections côte à côte) c'est le contenu de chaque section qui bouge, pas son fond, et la
 * bannière d'en-tête (qui a ses propres animations) est laissée de côté.
 */
function blocsDe(main: Element): Element[] {
  let n: Element = main;
  while (n.children.length === 1 && n.firstElementChild?.tagName === 'DIV') n = n.firstElementChild;
  return [...n.children].flatMap((enfant) => {
    if (enfant.tagName === 'SECTION') {
      if (enfant.hasAttribute('aria-roledescription')) return [];
      return enfant.firstElementChild ? [enfant.firstElementChild] : [];
    }
    return ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(enfant.tagName) ? [] : [enfant];
  });
}

/**
 * Effet « du haut vers le bas » à l'ouverture de chaque page et au défilement de la souris : les blocs de la page descendent en
 * fondu (de -28 px vers leur place) à mesure qu'ils entrent dans l'écran. Ceux déjà visibles à l'ouverture apparaissent en cascade
 * (80 ms d'écart), les autres au moment où l'on fait défiler jusqu'à eux. Monté une seule fois dans le layout racine : toutes les pages
 * (accueil, connexion, tableaux de bord, superadmin, profil) en profitent sans modification.
 *
 * Sûretés : rien n'est caché sans JavaScript ; désactivé si l'utilisateur préfère réduire les animations ; l'animation ne laisse aucune
 * transformation après coup (pas de contexte d'empilement parasite pour les éléments fixes ou collants) ; impression : tout est visible.
 */
export function EffetDefilement() {
  const chemin = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          observateur.unobserve(el);
          el.classList.remove('defilement-cache');
          el.classList.add('defilement-entree');
          el.addEventListener('animationend', () => el.classList.remove('defilement-entree'), { once: true });
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );

    const preparer = () => {
      const main = document.querySelector('main');
      if (!main) return;
      let rang = 0;
      for (const el of blocsDe(main)) {
        if (el.hasAttribute(VU) || !(el instanceof HTMLElement)) continue;
        el.setAttribute(VU, '');
        const r = el.getBoundingClientRect();
        const visible = r.top < window.innerHeight && r.bottom > 0;
        if (visible) {
          // déjà à l'écran à l'ouverture : cascade
          el.style.animationDelay = `${Math.min(rang, 5) * 80}ms`;
          el.classList.add('defilement-entree');
          el.addEventListener('animationend', () => { el.classList.remove('defilement-entree'); el.style.animationDelay = ''; }, { once: true });
          rang += 1;
        } else {
          el.classList.add('defilement-cache');
          observateur.observe(el);
        }
      }
    };

    preparer();
    // contenu qui arrive après coup (diffusion, changement de page, listes chargées) : on prépare les nouveaux blocs
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const main = document.querySelector('main');
    const surMutation = new MutationObserver(() => {
      clearTimeout(minuterie);
      minuterie = setTimeout(preparer, 60);
    });
    if (main) surMutation.observe(main, { childList: true, subtree: true });
    return () => {
      clearTimeout(minuterie);
      surMutation.disconnect();
      observateur.disconnect();
      // rien ne doit rester caché ni marqué quand l'effet est relancé (changement de page, double montage du mode développement)
      document.querySelectorAll('[' + VU + ']').forEach((el) => {
        el.removeAttribute(VU);
        el.classList.remove('defilement-cache', 'defilement-entree');
        (el as HTMLElement).style.animationDelay = '';
      });
    };
  }, [chemin]);

  return null;
}
