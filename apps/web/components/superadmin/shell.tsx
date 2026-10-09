'use client';

import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  Library,
  ShieldCheck,
  SlidersHorizontal,
  Type,
} from 'lucide-react';

import { Brand } from '@/components/brand';
import {
  ID_CONTENU_PRINCIPAL,
  LienEvitement,
  ListeNav,
  NavMobile,
  type EntreeNav,
} from '@/components/dashboard/navigation-shell';
import { LogoutButton } from '@/components/logout-button';
import { ModeToggle } from '@/components/mode-toggle';
import { Badge } from '@/components/ui/badge';
import {
  CLASSE_LARGEUR,
  largeurPourChemin,
  type LargeurPage,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';

const NAV: (EntreeNav & { largeur?: LargeurPage })[] = [
  // grille de cartes (pas de tableau) : largeur intermédiaire
  { label: 'Sociétés', href: '/superadmin/societes', icon: Building2, largeur: 'dashboard' },
  // chiffres-clés + un tableau
  { label: 'Santé système', href: '/superadmin/sante-systeme', icon: Activity, largeur: 'dashboard' },
  { label: 'Paramètres', href: '/superadmin/parametres', icon: SlidersHorizontal },
  {
    label: 'Catalogue national',
    href: '/superadmin/catalogue-national',
    icon: Library,
  },
  { label: 'Lettres-clés', href: '/superadmin/lettres-cles', icon: Type },
];

export function SuperadminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const largeur = largeurPourChemin(pathname, NAV);

  const enteteRole = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
        <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
        Super administration
      </p>
      <div className="mt-2">
        <Badge variant="secondary">Superadministrateur</Badge>
      </div>
    </>
  );

  return (
    <div className="grid min-h-svh md:grid-cols-[16rem_1fr]">
      <LienEvitement />

      <aside className="hidden flex-col border-r bg-card md:flex">
        <div className="border-b px-4 py-4">
          <Brand />
        </div>
        <div className="border-b px-4 py-4">{enteteRole}</div>
        <ListeNav items={NAV} className="flex-1 px-2 py-3" />
        <div className="border-t p-3">
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <span className="ml-auto truncate text-sm text-muted-foreground">
            {email}
          </span>
          <ModeToggle />
          <div className="md:hidden">
            <LogoutButton />
          </div>
          {/* Nav mobile : absente jusqu'ici sur le superadmin */}
          <NavMobile items={NAV} entete={enteteRole} />
        </header>
        <main
          id={ID_CONTENU_PRINCIPAL}
          tabIndex={-1}
          className="flex-1 p-4 focus:outline-none md:p-8"
        >
          <div className={cn('mx-auto', CLASSE_LARGEUR[largeur])}>{children}</div>
        </main>
      </div>
    </div>
  );
}
