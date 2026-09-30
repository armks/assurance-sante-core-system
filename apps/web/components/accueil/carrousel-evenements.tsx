'use client';

import { Pause, Play } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import type { EvenementPublic } from '@/lib/evenements-publics';
import { cn } from '@/lib/utils';

const DUREE_DIAPO_MS = 6500;

const dateFr = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Préférence système « réduire les animations » (réactive). */
function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduit(mq.matches);
    const surChangement = () => setReduit(mq.matches);
    mq.addEventListener('change', surChangement);
    return () => mq.removeEventListener('change', surChangement);
  }, []);
  return reduit;
}

/**
 * Carrousel des événements (5 au plus), à la place et au format exacts de
 * l'image du bloc « Qui sommes-nous » (4:3, coins arrondis). Même principe que
 * la bannière : fondu enchaîné, pastilles de progression, défilement suspendu
 * au survol, au focus, par le bouton Pause (WCAG 2.2.2) et désactivé si
 * l'utilisateur préfère réduire les animations. Un seul événement : image fixe,
 * sans contrôles.
 */
export function CarrouselEvenements({ evenements }: { evenements: EvenementPublic[] }) {
  const [actif, setActif] = useState(0);
  const [enPause, setEnPause] = useState(false);
  const [suspendu, setSuspendu] = useState(false);
  const reduit = useMouvementReduit();
  const plusieurs = evenements.length > 1;
  const defile = plusieurs && !enPause && !suspendu && !reduit;

  useEffect(() => {
    if (!defile) return;
    const t = setTimeout(() => setActif((i) => (i + 1) % evenements.length), DUREE_DIAPO_MS);
    return () => clearTimeout(t);
  }, [defile, actif, evenements.length]);

  const ev = evenements[actif];

  return (
    <div
      role="region"
      aria-roledescription="carrousel"
      aria-label="Nos événements"
      className="relative isolate aspect-[4/3] w-full overflow-hidden rounded-2xl bg-nuit text-white"
      onMouseEnter={() => setSuspendu(true)}
      onMouseLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuspendu(false);
      }}
    >
      {evenements.map((e, i) => (
        <Image
          key={e.id}
          src={e.imageUrl}
          alt=""
          aria-hidden="true"
          fill
          sizes="(min-width: 768px) 50vw, 100vw"
          className={cn(
            'object-cover transition-opacity duration-[900ms] ease-out motion-reduce:transition-none',
            i === actif ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
      {/* Voile bas : lisibilité du texte blanc sur n'importe quelle photo. */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-nuit/95 via-nuit/55 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6" aria-live={defile ? 'off' : 'polite'}>
        <p key={`d-${ev.id}`} className="accueil-texte-entree flex flex-wrap items-center gap-2 text-xs font-medium text-white/85">
          <span className="rounded-full bg-white/15 px-2 py-0.5 backdrop-blur">
            {ev.statut === 'A_VENIR' ? 'À venir' : 'Passé'}
          </span>
          <time dateTime={ev.dateEvenement}>{dateFr(ev.dateEvenement)}</time>
        </p>
        <p key={`t-${ev.id}`} className="accueil-texte-entree mt-2 font-display text-xl font-semibold leading-snug sm:text-2xl">
          {ev.titre}
        </p>
        {ev.description && (
          <p key={`x-${ev.id}`} className="accueil-texte-entree mt-1.5 line-clamp-2 max-w-[55ch] text-sm leading-relaxed text-white/85">
            {ev.description}
          </p>
        )}

        {plusieurs && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex gap-2" role="group" aria-label="Choisir un événement">
              {evenements.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setActif(i)}
                  aria-label={`Événement ${i + 1} sur ${evenements.length} : ${e.titre}`}
                  aria-current={i === actif}
                  className="group relative h-1.5 w-8 overflow-hidden rounded-full bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <span
                    className={cn(
                      'absolute inset-0 origin-left rounded-full bg-white',
                      i === actif ? (defile ? 'accueil-progression' : '') : 'scale-x-0',
                    )}
                    style={i === actif && defile ? { animationDuration: `${DUREE_DIAPO_MS}ms` } : undefined}
                  />
                </button>
              ))}
            </div>
            {!reduit && (
              <button
                type="button"
                onClick={() => setEnPause((p) => !p)}
                aria-label={enPause ? 'Reprendre le défilement' : 'Mettre le défilement en pause'}
                className="grid size-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {enPause ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
