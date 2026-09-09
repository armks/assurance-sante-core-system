import { cn } from '@/lib/utils';

/** Marque du produit — carré coloré + nom. Réutilisée sur /login et le header du dashboard. */
export function Brand({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'grid place-items-center rounded-lg bg-primary font-bold text-primary-foreground',
          size === 'lg' ? 'size-9 text-base' : 'size-7 text-sm',
        )}
      >
        AS
      </span>
      <span
        className={cn(
          'font-semibold leading-tight tracking-tight',
          size === 'lg' ? 'text-lg' : 'text-sm',
        )}
      >
        Assurance Santé
        <span className="block text-xs font-normal text-muted-foreground">
          Core System
        </span>
      </span>
    </div>
  );
}
