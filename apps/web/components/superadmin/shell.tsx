'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  Library,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

import { Brand } from '@/components/brand';
import { LogoutButton } from '@/components/logout-button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Sociétés', href: '/superadmin/societes', icon: Building2 },
  { label: 'Santé système', href: '/superadmin/sante-systeme', icon: Activity },
  { label: 'Paramètres', href: '/superadmin/parametres', icon: SlidersHorizontal },
  {
    label: 'Catalogue national',
    href: '/superadmin/catalogue-national',
    icon: Library,
  },
];

export function SuperadminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-svh md:grid-cols-[16rem_1fr]">
      <aside className="hidden flex-col border-r bg-muted/30 md:flex">
        <div className="border-b px-4 py-4">
          <Brand />
        </div>
        <div className="border-b px-4 py-4">
          <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Super administration
          </p>
          <div className="mt-2">
            <Badge variant="secondary">Superadministrateur</Badge>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV.map(({ label, href, icon: Icon }) => {
            const actif = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  actif
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <span className="ml-auto truncate text-sm text-muted-foreground">
            {email}
          </span>
          <div className="md:hidden">
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 bg-muted/10 p-4 md:p-8">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
