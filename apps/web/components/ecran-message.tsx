import Link from 'next/link';

import { Brand } from '@/components/brand';
import { LogoutButton } from '@/components/logout-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tonalite = 'neutre' | 'attention' | 'erreur';

const CADRE: Record<Tonalite, string> = {
  neutre: 'border-border',
  attention:
    'border-amber-300/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20',
  erreur:
    'border-destructive/40 bg-destructive/5 dark:bg-destructive/10',
};

/** Écran plein page centré, brandé — pour les états « pas de rôle », erreur, etc. */
export function EcranMessage({
  titre,
  description,
  tonalite = 'neutre',
  avecDeconnexion = true,
  children,
}: {
  titre: string;
  description?: string;
  tonalite?: Tonalite;
  avecDeconnexion?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/20 px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand size="lg" />
        </div>

        <div
          className={cn(
            'rounded-xl border bg-background p-6 shadow-sm',
            CADRE[tonalite],
          )}
        >
          <h1 className="text-base font-semibold">{titre}</h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
          {children && <div className="mt-4 text-sm">{children}</div>}

          <div className="mt-6 flex flex-wrap gap-3">
            {avecDeconnexion && <LogoutButton />}
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Retour à l’accueil</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
