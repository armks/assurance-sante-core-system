'use client';

import { usePathname } from 'next/navigation';

import { Brand } from '@/components/brand';
import {
  ID_CONTENU_PRINCIPAL,
  LienEvitement,
  ListeNav,
  NavMobile,
} from '@/components/dashboard/navigation-shell';
import { LogoutButton } from '@/components/logout-button';
import { ModeToggle } from '@/components/mode-toggle';
import { Badge } from '@/components/ui/badge';
import {
  RANG_NIVEAU,
  navPourDashboard,
  type NiveauAcces,
} from '@/lib/dashboard-nav';
import { CLASSE_LARGEUR, largeurPourChemin } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export interface ShellProps {
  email: string;
  role: string | null;
  libelleRole: string | null;
  entite: string | null;
  niveauAcces: NiveauAcces;
  peutValider: boolean;
  dashboardRoute: string | null;
  children: React.ReactNode;
}

const LIBELLE_NIVEAU: Record<NiveauAcces, string> = {
  LECTURE_SEULE: 'Lecture seule',
  MODIFICATION: 'Modification',
  ADMIN: 'Administration',
};

export function DashboardShell({
  email,
  role,
  libelleRole,
  entite,
  niveauAcces,
  peutValider,
  dashboardRoute,
  children,
}: ShellProps) {
  const pathname = usePathname();

  // Filtrage : n'afficher que les sections accessibles au rôle. On ne montre
  // jamais un lien vers une action que la RLS refuserait ensuite.
  const items = navPourDashboard(dashboardRoute).filter((item) => {
    const niveauRequis = item.minNiveau ?? 'LECTURE_SEULE';
    if (RANG_NIVEAU[niveauAcces] < RANG_NIVEAU[niveauRequis]) return false;
    if (item.requiertValidation && !peutValider) return false;
    return true;
  });

  const largeur = largeurPourChemin(pathname, items);

  const enteteRole = (
    <>
      <p className="text-sm font-medium leading-tight">
        {libelleRole ?? role ?? 'Rôle inconnu'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entite && <Badge variant="secondary">{entite}</Badge>}
        <Badge variant="outline">{LIBELLE_NIVEAU[niveauAcces]}</Badge>
        {peutValider && <Badge variant="success">Validation</Badge>}
      </div>
    </>
  );

  return (
    <div className="grid min-h-svh md:grid-cols-[16rem_1fr]">
      <LienEvitement />

      {/* Sidebar (desktop) */}
      <aside className="hidden flex-col border-r bg-card md:flex">
        <div className="border-b px-4 py-4">
          <Brand />
        </div>

        <div className="border-b px-4 py-4">{enteteRole}</div>

        <ListeNav items={items} className="flex-1 overflow-y-auto px-2 py-3" />

        <div className="border-t p-3">
          <LogoutButton />
        </div>
      </aside>

      {/* Contenu */}
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
          {/* Nav mobile : panneau latéral au lieu d'une barre horizontale */}
          <NavMobile items={items} entete={enteteRole} />
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
