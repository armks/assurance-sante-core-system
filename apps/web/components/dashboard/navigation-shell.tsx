'use client';

import { ChevronRight, Menu, type LucideIcon } from 'lucide-react';
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
  /** Catégorie de menu : les entrées d'une même catégorie forment un sous-menu repliable. */
  groupe?: GroupeEntreeNav;
}

export interface GroupeEntreeNav {
  id: string;
  label: string;
  icon: LucideIcon;
  couleur: 'rose' | 'indigo' | 'teal' | 'emerald' | 'amber' | 'violet';
}

/** Classes complètes (Tailwind) par couleur de catégorie : pastille d'icône, icône de lien, fond actif. */
const COULEURS_GROUPE: Record<GroupeEntreeNav['couleur'], { pastille: string; icone: string; actif: string }> = {
  rose: { pastille: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', icone: 'text-rose-500', actif: 'bg-rose-500/10 text-foreground' },
  indigo: { pastille: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', icone: 'text-indigo-500', actif: 'bg-indigo-500/10 text-foreground' },
  teal: { pastille: 'bg-teal-500/15 text-teal-600 dark:text-teal-300', icone: 'text-teal-500', actif: 'bg-teal-500/10 text-foreground' },
  emerald: { pastille: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', icone: 'text-emerald-500', actif: 'bg-emerald-500/10 text-foreground' },
  amber: { pastille: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', icone: 'text-amber-500', actif: 'bg-amber-500/10 text-foreground' },
  violet: { pastille: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', icone: 'text-violet-500', actif: 'bg-violet-500/10 text-foreground' },
};

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
  const couleurs = item.groupe ? COULEURS_GROUPE[item.groupe.couleur] : null;
  const contenu = (
    <span
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
        actif
          ? cn('font-semibold', couleurs ? couleurs.actif : 'bg-accent text-accent-foreground')
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        item.bientot && 'cursor-default hover:bg-transparent hover:text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', couleurs?.icone ?? 'text-primary')} />
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

type Section =
  | { type: 'lien'; item: EntreeNav }
  | { type: 'groupe'; groupe: GroupeEntreeNav; items: EntreeNav[] };

/** Regroupe les entrées par catégorie (à la place de la première) ; seules les catégories de 2 entrées ou plus restent des sous-menus. */
function sections(items: EntreeNav[]): Section[] {
  const effectifs = new Map<string, number>();
  for (const i of items) if (i.groupe) effectifs.set(i.groupe.id, (effectifs.get(i.groupe.id) ?? 0) + 1);
  const vus = new Set<string>();
  const res: Section[] = [];
  for (const item of items) {
    const g = item.groupe;
    if (!g || (effectifs.get(g.id) ?? 0) < 2) {
      res.push({ type: 'lien', item });
    } else if (!vus.has(g.id)) {
      vus.add(g.id);
      res.push({ type: 'groupe', groupe: g, items: items.filter((i) => i.groupe?.id === g.id) });
    }
  }
  return res;
}

/** Catégorie repliable : en-tête coloré, ouverte d'office quand la page courante en fait partie. */
function CategorieNav({
  groupe,
  items,
  hrefActif,
  pathname,
  onNaviguer,
}: {
  groupe: GroupeEntreeNav;
  items: EntreeNav[];
  hrefActif: string | undefined;
  pathname: string;
  onNaviguer?: () => void;
}) {
  const contientActif = items.some((i) => i.href === hrefActif);
  const [ouvert, setOuvert] = useState(contientActif);
  useEffect(() => {
    if (contientActif) setOuvert(true);
  }, [contientActif]);
  const Icon = groupe.icon;
  const couleurs = COULEURS_GROUPE[groupe.couleur];
  return (
    <li>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-lg', couleurs.pastille)}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="flex-1 text-left">{groupe.label}</span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">{items.length}</span>
        <ChevronRight aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform', ouvert && 'rotate-90')} />
      </button>
      {ouvert && (
        <ul className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
          {items.map((item) => (
            <li key={item.href}>
              <LienNav item={item} actif={hrefActif === item.href} courant={pathname === item.href} onNaviguer={onNaviguer} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Liste de liens du menu, avec catégories repliables et calcul du lien actif (un seul à la fois). */
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
        {sections(items).map((section) =>
          section.type === 'lien' ? (
            <li key={section.item.href}>
              <LienNav
                item={section.item}
                actif={actif?.href === section.item.href}
                courant={pathname === section.item.href}
                onNaviguer={onNaviguer}
              />
            </li>
          ) : (
            <CategorieNav
              key={section.groupe.id}
              groupe={section.groupe}
              items={section.items}
              hrefActif={actif?.href}
              pathname={pathname}
              onNaviguer={onNaviguer}
            />
          ),
        )}
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
