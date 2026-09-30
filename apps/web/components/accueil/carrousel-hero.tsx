'use client';

import { Pause, Play } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { PHOTOS, type PhotoAccueil } from './photos';

interface Diapo {
  photo: PhotoAccueil;
  /** Fin du titre, qui change avec la diapositive. */
  accroche: string;
  texte: string;
}

const DIAPOS: Diapo[] = [
  {
    photo: PHOTOS.heroSoins,
    accroche: 'votre réseau de soins',
    texte: 'Établissements de santé conventionnés, adhérents identifiés par leur carte à chaque visite.',
  },
  {
    photo: PHOTOS.heroPharmacie,
    accroche: 'vos pharmacies partenaires',
    texte: 'Ordonnances suivies de la prescription à la délivrance, validées par le pharmacien conseil.',
  },
  {
    photo: PHOTOS.heroPilotage,
    accroche: 'vos cotisations et remboursements',
    texte: 'Cotisations, facturation mensuelle et remboursements calculés au franc près, dans un seul outil.',
  },
];

const DUREE_DIAPO_MS = 6500;

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
 * Bannière d'en-tête : carrousel en fondu enchaîné (3 diapositives), titre
 * dont la fin change avec la diapositive. Défilement automatique suspendu au
 * survol, au focus clavier, par le bouton Pause (WCAG 2.2.2) et totalement
 * désactivé si l'utilisateur préfère réduire les animations.
 */
export function CarrouselHero() {
  const [actif, setActif] = useState(0);
  const [enPause, setEnPause] = useState(false);
  const [suspendu, setSuspendu] = useState(false);
  const reduit = useMouvementReduit();
  const defile = !enPause && !suspendu && !reduit;

  useEffect(() => {
    if (!defile) return;
    const t = setTimeout(() => setActif((i) => (i + 1) % DIAPOS.length), DUREE_DIAPO_MS);
    return () => clearTimeout(t);
  }, [defile, actif]);

  const diapo = DIAPOS[actif];

  return (
    <section
      aria-roledescription="carrousel"
      aria-label="Présentation de la plateforme"
      className="relative isolate flex min-h-[560px] items-end overflow-hidden bg-[#17152b] text-white md:h-[calc(100dvh-4rem)] md:max-h-[820px] md:items-center"
      onMouseEnter={() => setSuspendu(true)}
      onMouseLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuspendu(false);
      }}
    >
      {/* Photos empilées : seule l'active est opaque (fondu enchaîné). */}
      {DIAPOS.map((d, i) => (
        <Image
          key={d.photo.src}
          src={d.photo.src}
          alt={i === actif ? d.photo.alt : ''}
          aria-hidden={i !== actif}
          fill
          priority={i === 0}
          sizes="100vw"
          className={cn(
            'object-cover transition-opacity duration-[900ms] ease-out motion-reduce:transition-none',
            i === actif ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
      {/* Voile : lisibilité du texte blanc (plein sur mobile, dégradé depuis la gauche au-delà). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[#17152b] via-[#17152b]/80 to-[#17152b]/30 md:bg-gradient-to-r md:from-[#17152b]/95 md:via-[#17152b]/75 md:to-transparent"
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-40 sm:px-6 md:py-16">
        <div className="max-w-2xl" aria-live={defile ? 'off' : 'polite'}>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Une seule plateforme pour{' '}
            <span key={actif} className="accueil-texte-entree block text-[#c9b8ff]">
              {diapo.accroche}
            </span>
          </h1>
          <p key={`t-${actif}`} className="accueil-texte-entree mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
            {diapo.texte}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="active:scale-[0.98]">
              <a href="#contact">Nous contacter</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white active:scale-[0.98]"
            >
              <a href="#reseau">Découvrir le réseau</a>
            </Button>
          </div>
        </div>

        {/* Contrôles : une pastille par diapositive (progression) + pause. */}
        <div className="mt-10 flex items-center gap-3 md:mt-14">
          <div className="flex gap-2" role="group" aria-label="Choisir une diapositive">
            {DIAPOS.map((d, i) => (
              <button
                key={d.accroche}
                type="button"
                onClick={() => setActif(i)}
                aria-label={`Diapositive ${i + 1} sur ${DIAPOS.length} : ${d.accroche}`}
                aria-current={i === actif}
                className="group relative h-1.5 w-10 overflow-hidden rounded-full bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
      </div>
    </section>
  );
}
