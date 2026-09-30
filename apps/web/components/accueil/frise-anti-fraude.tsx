'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const ETAPES = ['Consultation', 'Ordonnance', 'Ticket de soins', 'Facturation'];

/** Décalage entre deux étapes (apparition successive). */
const PAS_MS = 220;

/**
 * Frise des quatre codes du parcours anti-fraude : horizontale à partir de md,
 * empilée verticalement en dessous. Chaque étape apparaît l'une après l'autre
 * quand la frise entre dans l'écran (un seul IntersectionObserver, déclenché une
 * fois : aucun écouteur de défilement).
 *
 * Sans JavaScript, ou avec « réduire les animations », la frise est affichée
 * d'emblée : l'état masqué n'est appliqué qu'une fois le composant monté et
 * l'animation autorisée.
 */
export function FriseAntiFraude() {
  const racine = useRef<HTMLOListElement>(null);
  const [etat, setEtat] = useState<'statique' | 'attente' | 'visible'>('statique');

  useEffect(() => {
    const el = racine.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      return;
    }
    setEtat('attente');
    const obs = new IntersectionObserver(
      ([entree]) => {
        if (entree.isIntersecting) {
          setEtat('visible');
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const masque = etat === 'attente';
  const anime = etat === 'visible';

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8 md:p-10">
      <h3 className="text-center font-display text-lg font-semibold md:text-xl">Le parcours, étape par étape</h3>
      <ol
        ref={racine}
        aria-label="Les quatre codes du parcours anti-fraude"
        className="mx-auto mt-8 flex max-w-4xl flex-col items-center md:grid md:grid-cols-4 md:items-start"
      >
        {ETAPES.map((etape, i) => {
          const dernier = i === ETAPES.length - 1;
          const delai = { animationDelay: `${i * PAS_MS}ms` };
          const delaiTrait = { animationDelay: `${i * PAS_MS + PAS_MS / 2}ms` };
          return (
            <li key={etape} className="relative flex flex-col items-center text-center">
              <span
                className={cn(
                  'relative z-10 grid size-14 place-items-center rounded-full bg-primary font-display text-xl font-semibold text-primary-foreground shadow-[0_8px_24px_-8px_hsl(253_78%_62%/0.6)] ring-8 ring-accent',
                  masque && 'opacity-0',
                  anime && 'accueil-etape',
                )}
                style={anime ? delai : undefined}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span
                className={cn('mt-4 font-display text-base font-semibold', masque && 'opacity-0', anime && 'accueil-etape')}
                style={anime ? delai : undefined}
              >
                <span className="sr-only">Étape {i + 1} : </span>
                {etape}
              </span>

              {!dernier && (
                <>
                  {/* Liaison horizontale (md+) : du bord du cercle au suivant, avec pointe de flèche. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute left-[calc(50%+2.75rem)] right-[calc(-50%+2.75rem)] top-7 hidden h-0.5 origin-left -translate-y-1/2 bg-primary/60 md:block',
                      "after:absolute after:-right-0.5 after:top-1/2 after:size-2 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-t-2 after:border-primary/60 after:content-['']",
                      masque && 'scale-x-0',
                      anime && 'accueil-trait-x',
                    )}
                    style={anime ? delaiTrait : undefined}
                  />
                  {/* Liaison verticale (mobile) sous le libellé. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative my-3 block h-10 w-0.5 origin-top bg-primary/60 md:hidden',
                      "after:absolute after:-bottom-0.5 after:left-1/2 after:size-2 after:-translate-x-1/2 after:rotate-[135deg] after:border-r-2 after:border-t-2 after:border-primary/60 after:content-['']",
                      masque && 'scale-y-0',
                      anime && 'accueil-trait-y',
                    )}
                    style={anime ? delaiTrait : undefined}
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
