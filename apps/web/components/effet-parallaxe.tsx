'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Coefficient de lissage : à chaque image, la couche rattrape 3,5 % de l'écart avec sa cible — elle « traîne » longuement derrière la molette (≈ 1,3 s pour se poser) : effet très ralenti. */
const INERTIE = 0.035;

/**
 * Parallaxe douce : les éléments marqués `data-parallaxe="vitesse"` se déplacent plus lentement que le défilement (vitesse > 0 : 0,2 = la
 * couche avance à 80 % de la vitesse de la page ; vitesse < 0 : elle devance la page). Le décalage est mesuré par rapport au CENTRE de
 * l'écran (ou, avec `data-parallaxe-origine="haut"`, par rapport au haut de la page), puis lissé par inertie : au défilement la couche retarde, puis se pose en douceur quand on s'arrête.
 *
 * Mise en page : l'élément marqué doit DÉPASSER son parent (ou porter `data-parallaxe-max="px"`, plafond du décalage pour un bloc de texte) (qui rogne, `overflow-hidden`) de la marge dont il peut bouger — le décalage est
 * plafonné à cette marge, donc jamais de bord vide visible. La mesure se fait sur le parent (immobile) pour éviter toute boucle de rétroaction.
 *
 * Sûretés : désactivé si l'utilisateur préfère réduire les animations ; seuls les éléments proches de l'écran sont recalculés ; la boucle
 * d'animation ne tourne que pendant le défilement et jusqu'à stabilisation ; aucun effet sans JavaScript (les images restent à leur place).
 */
export function EffetParallaxe() {
  const chemin = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const actuels = new WeakMap<HTMLElement, number>();
    let elements: HTMLElement[] = [];
    let image: number | null = null;

    const cible = (el: HTMLElement, parent: HTMLElement): number => {
      const r = parent.getBoundingClientRect();
      // origine « haut » (bannière en tête de page) : décalage nul à l'ouverture, qui croît avec le défilement ; sinon nul quand le parent
      // est centré à l'écran
      const ecart = el.dataset.parallaxeOrigine === 'haut' ? -window.scrollY : r.top + r.height / 2 - window.innerHeight / 2;
      // marge de déplacement : explicite (`data-parallaxe-max`, en px, pour un bloc qui ne dépasse pas son parent) ou débordement de l'élément
      const marge = el.dataset.parallaxeMax ? Number(el.dataset.parallaxeMax) : Math.max((el.offsetHeight - parent.clientHeight) / 2, 0);
      const brut = -ecart * (Number(el.dataset.parallaxe) || 0);
      return Math.max(-marge, Math.min(marge, brut));
    };

    const tourner = () => {
      image = null;
      let encore = false;
      for (const el of elements) {
        const parent = el.parentElement;
        if (!parent) continue;
        const r = parent.getBoundingClientRect();
        if (r.bottom < -300 || r.top > window.innerHeight + 300) continue; // loin de l'écran : inutile de recalculer
        const c = cible(el, parent);
        const a = actuels.has(el) ? actuels.get(el)! : c; // première mesure : pas de glissement parasite à l'ouverture
        const suivant = a + (c - a) * INERTIE;
        const fini = Math.abs(c - suivant) < 0.15;
        const valeur = fini ? c : suivant;
        actuels.set(el, valeur);
        el.style.transform = `translate3d(0, ${valeur.toFixed(2)}px, 0)`;
        if (!fini) encore = true;
      }
      if (encore) image = requestAnimationFrame(tourner);
    };
    const demander = () => {
      if (image === null) image = requestAnimationFrame(tourner);
    };

    const scanner = () => {
      elements = [...document.querySelectorAll<HTMLElement>('[data-parallaxe]')];
      for (const el of elements) el.style.willChange = 'transform';
      demander();
    };

    scanner();
    window.addEventListener('scroll', demander, { passive: true });
    window.addEventListener('resize', demander);
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const main = document.querySelector('main') ?? document.body;
    const surMutation = new MutationObserver(() => {
      clearTimeout(minuterie);
      minuterie = setTimeout(scanner, 80);
    });
    surMutation.observe(main, { childList: true, subtree: true });
    return () => {
      clearTimeout(minuterie);
      surMutation.disconnect();
      window.removeEventListener('scroll', demander);
      window.removeEventListener('resize', demander);
      if (image !== null) cancelAnimationFrame(image);
      for (const el of elements) {
        el.style.transform = '';
        el.style.willChange = '';
      }
    };
  }, [chemin]);

  return null;
}
