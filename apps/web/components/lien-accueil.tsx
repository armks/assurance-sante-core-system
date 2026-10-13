'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CLE_ACCUEIL_ORIGINE, FORME_ACCUEIL } from '@/components/memoire-accueil';
import { cn } from '@/lib/utils';

/**
 * Lien « Retour à l'accueil » des pages d'authentification (connexion, mot de passe oublié…) : en haut à gauche, en face du bouton de thème de
 * la page de connexion. Il ramène à la page d'accueil D'OÙ VIENT LE VISITEUR — celle de sa société (`/{slug}`) s'il l'a consultée juste avant,
 * sinon celle de la plateforme (`/`). Apparition douce, comme le reste de l'ouverture de ces pages (classes megamenu-*).
 */
export function LienAccueil({ className }: { className?: string }) {
  const [accueil, setAccueil] = useState('/');

  useEffect(() => {
    try {
      const memorise = sessionStorage.getItem(CLE_ACCUEIL_ORIGINE);
      if (memorise && FORME_ACCUEIL.test(memorise)) setAccueil(memorise);
    } catch {
      /* stockage indisponible : accueil de la plateforme */
    }
  }, []);

  return (
    <Link
      href={accueil}
      className={cn(
        'megamenu-colonne absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={{ animationDelay: '200ms' }}
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Retour à l’accueil
    </Link>
  );
}
