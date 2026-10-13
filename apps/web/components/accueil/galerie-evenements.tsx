'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import type { EvenementPublic } from '@/lib/evenements-publics';
import { cn } from '@/lib/utils';

const DUREE_DIAPO_MS = 7000;

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
 * Galerie des événements (5 au plus) du bloc « Qui sommes-nous » — volontairement différente de la bannière d'en-tête
 * (fondu enchaîné, texte superposé, barres de progression) :
 *  - les photos GLISSENT horizontalement sur une piste (4:3, coins arrondis) ;
 *  - la légende (date, titre, description) est dans une CARTE sous la photo, jamais superposée ;
 *  - flèches précédent / suivant sur la photo, compteur « 2 / 5 » et rangée de MINIATURES cliquables.
 * Accessibilité : défilement automatique suspendu au survol, au focus, par le bouton Pause (WCAG 2.2.2) et désactivé si l'utilisateur
 * préfère réduire les animations ; flèches du clavier ← → ; un seul événement : photo fixe et légende, sans contrôles.
 */
export function GalerieEvenements({ evenements }: { evenements: EvenementPublic[] }) {
  const [actif, setActif] = useState(0);
  const [enPause, setEnPause] = useState(false);
  const [suspendu, setSuspendu] = useState(false);
  const reduit = useMouvementReduit();
  const n = evenements.length;
  const plusieurs = n > 1;
  const defile = plusieurs && !enPause && !suspendu && !reduit;
  const aller = (i: number) => setActif(((i % n) + n) % n);

  useEffect(() => {
    if (!defile) return;
    const t = setTimeout(() => setActif((i) => (i + 1) % n), DUREE_DIAPO_MS);
    return () => clearTimeout(t);
  }, [defile, actif, n]);

  const ev = evenements[actif];

  return (
    <div
      role="region"
      aria-roledescription="carrousel"
      aria-label="Nos événements"
      className="w-full"
      onMouseEnter={() => setSuspendu(true)}
      onMouseLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuspendu(false);
      }}
      onKeyDown={(e) => {
        if (!plusieurs) return;
        if (e.key === 'ArrowRight') aller(actif + 1);
        if (e.key === 'ArrowLeft') aller(actif - 1);
      }}
    >
      {/* Piste : les photos glissent côte à côte. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
        <div
          className="flex h-full transition-transform duration-[650ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(-${actif * 100}%)` }}
        >
          {evenements.map((e, i) => (
            <div key={e.id} className="relative h-full w-full shrink-0" aria-hidden={i !== actif}>
              <Image
                src={e.imageUrl}
                alt={i === actif ? e.titre : ''}
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-nuit shadow-sm backdrop-blur">
          {ev.statut === 'A_VENIR' ? 'À venir' : 'Passé'}
        </span>

        {plusieurs && (
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button
              type="button"
              onClick={() => aller(actif - 1)}
              aria-label="Événement précédent"
              className="grid size-9 place-items-center rounded-full bg-white/90 text-nuit shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => aller(actif + 1)}
              aria-label="Événement suivant"
              className="grid size-9 place-items-center rounded-full bg-white/90 text-nuit shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </div>
        )}
      </div>

      {/* Légende : carte sous la photo (jamais superposée). */}
      <div className="mt-3 rounded-xl border bg-card p-4 shadow-sm" aria-live={defile ? 'off' : 'polite'}>
        <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
          <p key={`d-${ev.id}`} className="accueil-texte-entree flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            <time dateTime={ev.dateEvenement}>{dateFr(ev.dateEvenement)}</time>
          </p>
          {plusieurs && (
            <p className="flex items-center gap-2">
              <span className="tabular-nums" aria-label={`Événement ${actif + 1} sur ${n}`}>
                {String(actif + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
              </span>
              {!reduit && (
                <button
                  type="button"
                  onClick={() => setEnPause((p) => !p)}
                  aria-label={enPause ? 'Reprendre le défilement' : 'Mettre le défilement en pause'}
                  className="grid size-7 place-items-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {enPause ? <Play aria-hidden="true" className="size-3.5" /> : <Pause aria-hidden="true" className="size-3.5" />}
                </button>
              )}
            </p>
          )}
        </div>
        <p key={`t-${ev.id}`} className="accueil-texte-entree mt-1.5 font-display text-lg font-semibold leading-snug">
          {ev.titre}
        </p>
        {ev.description && (
          <p key={`x-${ev.id}`} className="accueil-texte-entree mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {ev.description}
          </p>
        )}
      </div>

      {/* Miniatures cliquables. */}
      {plusieurs && (
        <div className="mt-3 flex gap-2" role="group" aria-label="Choisir un événement">
          {evenements.map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => aller(i)}
              aria-label={`Événement ${i + 1} sur ${n} : ${e.titre}`}
              aria-current={i === actif}
              className={cn(
                'relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-lg ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                i === actif ? 'ring-2 ring-primary' : 'opacity-60 hover:opacity-100',
              )}
            >
              <Image src={e.imageUrl} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
