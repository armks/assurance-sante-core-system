'use client';

import { Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Bascule clair / sombre / système — `next-themes` pilote la classe `.dark`
 * sur `<html>` (voir `ThemeProvider` dans `app/layout.tsx`), les variables CSS
 * de `.dark` existent déjà dans `globals.css`. Monté après hydratation pour
 * éviter tout mismatch SSR (le thème réel n'est connu que côté client).
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [monte, setMonte] = React.useState(false);

  React.useEffect(() => setMonte(true), []);

  if (!monte) {
    return (
      <Button variant="ghost" size="icon" aria-label="Thème" disabled>
        <Sun className="size-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Changer de thème" className="relative">
          <Sun className="size-4 scale-100 dark:scale-0" />
          <Moon className="absolute size-4 scale-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(
          [
            { valeur: 'light', libelle: 'Clair', icon: Sun },
            { valeur: 'dark', libelle: 'Sombre', icon: Moon },
            { valeur: 'system', libelle: 'Système', icon: Laptop },
          ] as const
        ).map(({ valeur, libelle, icon: Icon }) => (
          <DropdownMenuItem
            key={valeur}
            onClick={() => setTheme(valeur)}
            className={cn(theme === valeur && 'bg-accent text-accent-foreground')}
          >
            <Icon className="size-4" /> {libelle}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
