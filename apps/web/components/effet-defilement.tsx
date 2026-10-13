'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect } from 'react';

/** Avant la peinture (le contenu d'une nouvelle page ne doit jamais s'afficher une image avant de s'animer) ; sur le serveur : useEffect, sans avertissement. */
const useEffetAvantPeinture = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const VU = 'data-defilement-vu';

/** Marqueur posé juste avant la redirection qui suit une connexion réussie (voir `annoncerOuvertureLente`) ; valable 20 s. */
export const CLE_OUVERTURE_LENTE = 'ouverture-lente';

/** À appeler quand une connexion vient de réussir : la PREMIÈRE page affichée ensuite (tableau de bord, profil) s'ouvre en mode lent. */
export function annoncerOuvertureLente() {
  try {
    sessionStorage.setItem(CLE_OUVERTURE_LENTE, String(Date.now()));
  } catch {
    /* stockage indisponible : ouverture normale */
  }
}

const PAGES_PUBLIQUES = ['/login', '/auth'];

/** Consomme le marqueur (une seule fois) ; le même chemin reste lent si l'effet est relancé (double montage du mode développement). */
function ouvertureLente(chemin: string): boolean {
  const w = window as unknown as { __ouvertureLente?: string };
  if (w.__ouvertureLente === chemin) return true;
  if (PAGES_PUBLIQUES.some((p) => chemin.startsWith(p))) return false;
  try {
    const pose = Number(sessionStorage.getItem(CLE_OUVERTURE_LENTE));
    if (!pose) return false;
    sessionStorage.removeItem(CLE_OUVERTURE_LENTE);
    if (Date.now() - pose > 20_000) return false;
    w.__ouvertureLente = chemin;
    return true;
  } catch {
    return false;
  }
}

/**
 * Blocs d'une page à animer : on descend dans les enveloppes à enfant unique (`main > div > div.space-y-8 > …`) puis on prend les
 * enfants. Sur la page d'accueil (plusieurs sections côte à côte) c'est le contenu de chaque section qui bouge, pas son fond, et la
 * bannière d'en-tête (qui a ses propres animations) est laissée de côté.
 */
function blocsDe(main: Element): Element[] {
  let n: Element = main;
  while (n.children.length === 1 && n.firstElementChild?.tagName === 'DIV') n = n.firstElementChild;
  return [...n.children].flatMap((enfant) => {
    // bloc qui porte son propre effet d'ouverture (ex. page de connexion) : pas d'apparition générique par-dessus
    if (enfant.hasAttribute('data-sans-defilement')) return [];
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
 * (140 ms d’écart), les autres au moment où l'on fait défiler jusqu'à eux. Monté une seule fois dans le layout racine : toutes les pages
 * (accueil, connexion, tableaux de bord, superadmin, profil) en profitent sans modification.
 *
 * Sûretés : rien n'est caché sans JavaScript ; désactivé si l'utilisateur préfère réduire les animations ; l'animation ne laisse aucune
 * transformation après coup (pas de contexte d'empilement parasite pour les éléments fixes ou collants) ; impression : tout est visible.
 */
export function EffetDefilement() {
  const chemin = usePathname();

  useEffetAvantPeinture(() => {
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

    // Première page après une connexion réussie : ouverture LENTE — la coquille (en-tête, menu latéral) descend d'abord, puis les blocs de la page
    // l'un après l'autre (2,2 s chacun, 260 ms d'écart), avec les mêmes animations « du haut vers le bas » que le reste du site.
    const lent = ouvertureLente(chemin);
    const entrer = (el: HTMLElement, delai: number) => {
      el.setAttribute(VU, '');
      el.style.animationDelay = `${delai}ms`;
      el.classList.add('defilement-entree');
      if (lent) el.classList.add('defilement-lent');
      el.addEventListener('animationend', () => { el.classList.remove('defilement-entree', 'defilement-lent'); el.style.animationDelay = ''; }, { once: true });
    };
    let coquillePrete = false;
    const preparerCoquille = () => {
      if (!lent || coquillePrete) return;
      const parts = [...document.querySelectorAll<HTMLElement>('body header, body aside')].filter((e) => !e.closest('main') && !e.hasAttribute(VU));
      if (parts.length === 0) return;
      coquillePrete = true;
      parts.forEach((el, i) => entrer(el, i * 200));
    };

    const preparer = () => {
      const main = document.querySelector('main');
      if (!main) return;
      preparerCoquille();
      let rang = 0;
      for (const el of blocsDe(main)) {
        if (el.hasAttribute(VU) || !(el instanceof HTMLElement)) continue;
        el.setAttribute(VU, '');
        const r = el.getBoundingClientRect();
        const visible = r.top < window.innerHeight && r.bottom > 0;
        if (visible) {
          // déjà à l'écran à l'ouverture : cascade (mode lent : après la coquille, 260 ms d'écart)
          entrer(el, lent ? 500 + Math.min(rang, 6) * 260 : Math.min(rang, 5) * 140);
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
        el.classList.remove('defilement-cache', 'defilement-entree', 'defilement-lent');
        (el as HTMLElement).style.animationDelay = '';
      });
    };
  }, [chemin]);

  return null;
}
