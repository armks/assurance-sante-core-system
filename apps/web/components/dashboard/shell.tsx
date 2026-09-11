'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Brand } from '@/components/brand';
import { LogoutButton } from '@/components/logout-button';
import { ModeToggle } from '@/components/mode-toggle';
import { Badge } from '@/components/ui/badge';
import {
  NavItem,
  RANG_NIVEAU,
  navPourDashboard,
  type NiveauAcces,
} from '@/lib/dashboard-nav';
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

  return (
    <div className="grid min-h-svh md:grid-cols-[16rem_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="hidden flex-col border-r bg-muted/30 md:flex">
        <div className="border-b px-4 py-4">
          <Brand />
        </div>

        <div className="border-b px-4 py-4">
          <p className="text-sm font-medium leading-tight">
            {libelleRole ?? role ?? 'Rôle inconnu'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entite && <Badge variant="secondary">{entite}</Badge>}
            <Badge variant="outline">{LIBELLE_NIVEAU[niveauAcces]}</Badge>
            {peutValider && <Badge variant="success">Validation</Badge>}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {items.map((item) => (
            <LienNav
              key={item.href}
              item={item}
              actif={estActif(pathname, item.href)}
            />
          ))}
        </nav>

        <div className="border-t p-3">
          <LogoutButton />
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-h-svh flex-col">
        <header className="flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
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
        </header>

        {/* Nav horizontale (mobile) */}
        <nav className="flex gap-1 overflow-x-auto border-b bg-muted/20 px-3 py-2 md:hidden">
          {items.map((item) => (
            <LienNav
              key={item.href}
              item={item}
              actif={estActif(pathname, item.href)}
              compact
            />
          ))}
        </nav>

        <main className="flex-1 bg-muted/10 p-4 md:p-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function estActif(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LienNav({
  item,
  actif,
  compact = false,
}: {
  item: NavItem;
  actif: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const contenu = (
    <span
      className={cn(
        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
        compact ? 'whitespace-nowrap' : 'w-full',
        actif
          ? 'bg-background font-medium text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
        item.bientot && 'cursor-default hover:bg-transparent hover:text-muted-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className={compact ? '' : 'flex-1'}>{item.label}</span>
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
  return <Link href={item.href}>{contenu}</Link>;
}
