import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Conteneur en grille pour une rangée de cartes de résumé. */
export function GrilleCartes({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}

/**
 * Carte de résumé : un chiffre-clé, son libellé, un indice secondaire optionnel
 * (évolution, sous-total, quota…) et une icône. Utile pour les vues d'ensemble.
 */
export function CarteResume({
  libelle,
  valeur,
  indice,
  icon: Icon,
  tonIndice = 'neutre',
  href,
  compact = false,
}: {
  libelle: string;
  valeur: React.ReactNode;
  indice?: React.ReactNode;
  icon?: LucideIcon;
  tonIndice?: 'neutre' | 'positif' | 'negatif';
  href?: string;
  /** Carte moins haute (marges et chiffre réduits), pour les rangées de beaucoup de cases. */
  compact?: boolean;
}) {
  const contenu = (
    <Card
      className={cn(
        'h-full',
        compact && 'gap-0 py-2',
        href && 'transition-colors hover:border-primary/40 hover:bg-accent/40',
      )}
    >
      <CardContent className={cn('flex items-start justify-between gap-3', compact && 'px-4')}>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{libelle}</p>
          <p className={cn('mt-1 font-semibold tracking-tight tabular-nums', compact ? 'text-xl leading-tight' : 'text-2xl')}>
            {valeur}
          </p>
          {indice != null && (
            <p
              className={cn(
                compact ? 'text-xs' : 'mt-1 text-xs',
                tonIndice === 'positif' &&
                  'text-emerald-600 dark:text-emerald-400',
                tonIndice === 'negatif' && 'text-rose-600 dark:text-rose-400',
                tonIndice === 'neutre' && 'text-muted-foreground',
              )}
            >
              {indice}
            </p>
          )}
        </div>
        {Icon && (
          <span className={cn('grid shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground', compact ? 'size-8' : 'size-9')}>
            <Icon className="size-4" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="group block">
      {contenu}
    </Link>
  ) : (
    contenu
  );
}
