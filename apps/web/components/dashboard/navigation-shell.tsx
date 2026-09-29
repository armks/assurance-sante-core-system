'use client';

import { Menu, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { lienActif } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Briques de navigation communes aux shells (`dashboard/shell.tsx`,
 * `superadmin/shell.tsx`) : lien d'évitement, lien de menu, menu mobile.
 */

/** Cible du lien d'évitement : le `<main>` de chaque shell porte cet id. */
export const ID_CONTENU_PRINCIPAL = 'contenu-principal';

export interface EntreeNav {
  label: string;
  href: string;
  icon: LucideIcon;
  bientot?: boolean;
}

/**
 * Premier élément focalisable de la page : invisible, il apparaît au focus
 * clavier (Tab) et renvoie au contenu principal sans parcourir le menu.
 */
export function LienEvitement() {
  return (
    <a
      href={`#${ID_CONTENU_PRINCIPAL}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Aller au contenu principal
    </a>
  );
}

/**
 * Lien de menu. `actif` = section courante (mise en évidence visuelle, y
 * compris sur ses fiches `[id]`) ; `aria-current="page"` seulement quand le
 * lien pointe exactement sur la page affichée.
 */
export function LienNav({
  item,
  actif,
  courant,
  onNaviguer,
}: {
  item: EntreeNav;
  actif: boolean;
  courant: boolean;
  onNaviguer?: () => void;
}) {
  const Icon = item.icon;
  const contenu = (
    <span
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
        actif
          ? 'bg-background font-medium text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
        item.bientot && 'cursor-default hover:bg-transparent hover:text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.bientot && (
        <Badge variant="muted" className="ml-1 text-[10px] font-normal">
          bientôt
        </Badge>
      )}
    </span>
  );

  if (item.bientot) {
    return (
      <span aria-disabled="true" title="Disponible prochainement">
        {contenu}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={courant ? 'page' : undefined}
      onClick={onNaviguer}
      className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {contenu}
    </Link>
  );
}

/** Liste de liens du menu, avec calcul du lien actif (un seul à la fois). */
export function ListeNav({
  items,
  onNaviguer,
  className,
}: {
  items: EntreeNav[];
  onNaviguer?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const actif = lienActif(
    pathname,
    items.filter((i) => !i.bientot),
  );
  return (
    <nav aria-label="Navigation principale" className={className}>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <LienNav
              item={item}
              actif={actif?.href === item.href}
              courant={pathname === item.href}
              onNaviguer={onNaviguer}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Menu mobile (< md) : bouton « Menu » dans l'en-tête, qui ouvre un panneau
 * latéral (Dialog existant, `side="right"`) avec l'en-tête de rôle et la
 * liste complète des sections. Se referme à la navigation.
 */
export function NavMobile({
  items,
  entete,
}: {
  items: EntreeNav[];
  entete?: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const pathname = usePathname();

  // referme le panneau après un changement de page (lien, retour arrière…)
  useEffect(() => {
    setOuvert(false);
  }, [pathname]);

  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" className="md:hidden">
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent side="right" className="max-w-xs gap-0 p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>Menu</DialogTitle>
        </DialogHeader>
        {entete && <div className="border-b px-4 py-4">{entete}</div>}
        <ListeNav
          items={items}
          onNaviguer={() => setOuvert(false)}
          className="flex-1 px-2 py-3"
        />
      </DialogContent>
    </Dialog>
  );
}
