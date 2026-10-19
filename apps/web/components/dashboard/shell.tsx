'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Brand } from '@/components/brand';
import {
  ID_CONTENU_PRINCIPAL,
  LienEvitement,
  ListeNav,
  NavMobile,
} from '@/components/dashboard/navigation-shell';
import { LogoutButton } from '@/components/logout-button';
import { MessagerieFlottante } from '@/components/messagerie/messagerie-flottante';
import { ROLES_MESSAGERIE } from '@/lib/messagerie';
import { ModeToggle } from '@/components/mode-toggle';
import { Badge } from '@/components/ui/badge';
import { AvatarUtilisateur, CarteUtilisateur, nomAffiche, type UtilisateurResume } from '@/components/dashboard/utilisateur-resume';
import {
  RANG_NIVEAU,
  navPourDashboard,
  type NiveauAcces,
} from '@/lib/dashboard-nav';
import { CLASSE_LARGEUR, largeurPourChemin } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export interface ShellProps {
  email: string;
  /** Qui est connecté : pseudo, photo, structure d'appartenance (facultatif : repli sur l'e-mail). */
  utilisateur?: UtilisateurResume;
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
  utilisateur,
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
      {utilisateur && (
        <div className="mb-3 border-b pb-3">
          <CarteUtilisateur utilisateur={utilisateur} />
        </div>
      )}
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
      <aside className="menu-couleur menu-degrade hidden flex-col border-r bg-card text-card-foreground md:flex">
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
        <header className="menu-couleur menu-degrade-h flex items-center gap-3 border-b border-white/10 px-4 py-3 text-card-foreground md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          {utilisateur ? (
            <Link href="/profil" className="ml-auto flex min-w-0 items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 text-sm hover:bg-muted/60" title="Mon profil">
              <AvatarUtilisateur utilisateur={utilisateur} taille="sm" />
              <span className="min-w-0 truncate">
                <span className="font-medium">{nomAffiche(utilisateur)}</span>
                {utilisateur.libelleRole && <span className="hidden text-muted-foreground lg:inline"> · {utilisateur.libelleRole}</span>}
                {utilisateur.structure && <span className="hidden text-muted-foreground xl:inline"> · {utilisateur.structure}</span>}
              </span>
            </Link>
          ) : (
            <span className="ml-auto truncate text-sm text-muted-foreground">{email}</span>
          )}
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
      {role && ROLES_MESSAGERIE.includes(role) && <MessagerieFlottante />}
    </div>
  );
}
