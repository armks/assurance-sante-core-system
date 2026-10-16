'use client';

import { Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AnnoncePublique } from '@/lib/annonces-publiques';

type Phase = 'cache' | 'entree' | 'sortie';

const CLE_SESSION = 'annonces-bandeau-fermees';

/** Signature de l'ensemble des annonces affichées : une nouvelle annonce rouvre le bandeau même si l'ancien a été fermé. */
const signature = (annonces: AnnoncePublique[]) => annonces.map((a) => a.id).sort().join('|');

/**
 * Bandeau d'annonces FIXÉ au bas de la page d'accueil (il reste en place quand on fait défiler la page) : il monte depuis le
 * bas, fait défiler les messages de GAUCHE À DROITE, puis redescend et disparaît après la durée définie par l'émetteur (la plus
 * longue des annonces affichées). Le survol suspend le défilement, la croix le ferme pour la session ; avec « réduire les
 * animations », le texte reste fixe. Le texte est aussi exposé aux lecteurs d'écran (région annoncée poliment).
 */
export function BandeauAnnonces({ annonces }: { annonces: AnnoncePublique[] }) {
  const [phase, setPhase] = useState<Phase>('cache');
  const sig = signature(annonces);
  const dureeS = annonces.reduce((m, a) => Math.max(m, a.dureeAffichageSecondes), 0);

  useEffect(() => {
    if (annonces.length === 0) return;
    try {
      if (window.sessionStorage.getItem(CLE_SESSION) === sig) return;
    } catch {
      /* stockage indisponible : on affiche */
    }
    setPhase('entree');
    const sortir = window.setTimeout(() => setPhase('sortie'), dureeS * 1000);
    return () => window.clearTimeout(sortir);
  }, [annonces.length, sig, dureeS]);

  useEffect(() => {
    if (phase !== 'sortie') return;
    const fin = window.setTimeout(() => setPhase('cache'), 450);
    return () => window.clearTimeout(fin);
  }, [phase]);

  if (annonces.length === 0 || phase === 'cache') return null;

  const texte = annonces.map((a) => a.texte).join('   •   ');
  // vitesse régulière d'environ 90 px/s : la durée d'un passage suit la longueur du texte (10 à 80 s)
  const dureeTour = Math.min(80, Math.max(10, (texte.length * 8 + 1200) / 90));

  const fermer = () => {
    try {
      window.sessionStorage.setItem(CLE_SESSION, sig);
    } catch {
      /* ignoré */
    }
    setPhase('sortie');
  };

  return (
    <section
      aria-label="Annonces"
      className={`fixed inset-x-0 bottom-0 z-50 border-t border-primary/30 bg-primary text-primary-foreground shadow-[0_-6px_20px_rgba(0,0,0,0.18)] ${
        phase === 'sortie' ? 'annonce-descente' : 'annonce-montee'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Megaphone aria-hidden="true" className="size-4 shrink-0" />
        <p className="sr-only" aria-live="polite">
          {texte}
        </p>
        <div aria-hidden="true" className="relative h-10 min-w-0 flex-1 overflow-hidden">
          <span
            className="annonce-defilement absolute inset-y-0 left-0 flex items-center whitespace-nowrap text-sm font-medium"
            style={{ ['--duree-tour' as string]: `${dureeTour}s` }}
          >
            {texte}
          </span>
        </div>
        <button
          type="button"
          onClick={fermer}
          aria-label="Fermer le bandeau d’annonces"
          className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-primary-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
}
