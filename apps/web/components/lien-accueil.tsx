import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Lien « Retour à l'accueil » des pages d'authentification (connexion, mot de passe oublié…) : en haut à gauche, en face du bouton de thème de
 * la page de connexion. Apparition douce, comme le reste de l'ouverture de ces pages (classes megamenu-*).
 */
export function LienAccueil({ className }: { className?: string }) {
  return (
    <Link
      href="/"
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
