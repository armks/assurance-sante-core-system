import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Tons colorés des cartes (classes complètes pour Tailwind) : bandeau latéral, fond doux, pastille d'icône. */
const TONS = [
  { bord: 'border-l-indigo-500', fond: 'from-indigo-500/10', icone: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' },
  { bord: 'border-l-cyan-500', fond: 'from-cyan-500/10', icone: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300' },
  { bord: 'border-l-emerald-500', fond: 'from-emerald-500/10', icone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
  { bord: 'border-l-amber-500', fond: 'from-amber-500/10', icone: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
  { bord: 'border-l-rose-500', fond: 'from-rose-500/10', icone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  { bord: 'border-l-violet-500', fond: 'from-violet-500/10', icone: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  { bord: 'border-l-fuchsia-500', fond: 'from-fuchsia-500/10', icone: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300' },
  { bord: 'border-l-teal-500', fond: 'from-teal-500/10', icone: 'bg-teal-500/15 text-teal-600 dark:text-teal-300' },
] as const;

/** Ton stable déduit du libellé : une même carte garde toujours la même couleur. */
function tonPour(libelle: string) {
  let h = 0;
  for (let i = 0; i < libelle.length; i++) h = (h * 31 + libelle.charCodeAt(i)) >>> 0;
  return TONS[h % TONS.length];
}

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
  const ton = tonPour(libelle);
  const contenu = (
    <Card
      className={cn(
        'h-full border-l-4 bg-gradient-to-br to-transparent',
        ton.bord,
        ton.fond,
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
          <span className={cn('grid shrink-0 place-items-center rounded-xl', ton.icone, compact ? 'size-8' : 'size-9')}>
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
