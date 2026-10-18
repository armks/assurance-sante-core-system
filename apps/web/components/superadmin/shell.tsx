'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  History,
  KeyRound,
  Library,
  Megaphone,
  ShieldCheck,
  SlidersHorizontal,
  Type,
  Stethoscope,
} from 'lucide-react';

import { Brand } from '@/components/brand';
import {
  ID_CONTENU_PRINCIPAL,
  LienEvitement,
  ListeNav,
  NavMobile,
  type EntreeNav,
} from '@/components/dashboard/navigation-shell';
import { AvatarUtilisateur, CarteUtilisateur, nomAffiche, type UtilisateurResume } from '@/components/dashboard/utilisateur-resume';
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
  { label: 'Licences', href: '/superadmin/licences', icon: KeyRound, largeur: 'dashboard' },
  // chiffres-clés + un tableau
  { label: 'Santé système', href: '/superadmin/sante-systeme', icon: Activity, largeur: 'dashboard' },
  { label: 'Paramètres', href: '/superadmin/parametres', icon: SlidersHorizontal },
  {
    label: 'Catalogue national',
    href: '/superadmin/catalogue-national',
    icon: Library,
  },
  { label: 'Lettres-clés', href: '/superadmin/lettres-cles', icon: Type },
  // Maladies codées CIM-10 : choisies par les médecins pour le diagnostic des consultations
  { label: 'Maladies (CIM-10)', href: '/superadmin/cim10', icon: Stethoscope },
  // Traçabilité : qui a fait quoi, dans toutes les organisations
  // Bandeau d'annonces défilant au bas des pages d'accueil (toute la plateforme ou une société)
  { label: 'Annonces', href: '/superadmin/annonces', icon: Megaphone },
  { label: 'Journal des actions', href: '/superadmin/journal-actions', icon: History },
];

export function SuperadminShell({
  email,
  utilisateur,
  children,
}: {
  email: string;
  utilisateur?: UtilisateurResume;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const largeur = largeurPourChemin(pathname, NAV);

  const enteteRole = (
    <>
      {utilisateur && (
        <div className="mb-3 border-b pb-3">
          <CarteUtilisateur utilisateur={utilisateur} />
        </div>
      )}
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
          {utilisateur ? (
            <Link href="/profil" className="ml-auto flex min-w-0 items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 text-sm hover:bg-muted/60" title="Mon profil">
              <AvatarUtilisateur utilisateur={utilisateur} taille="sm" />
              <span className="min-w-0 truncate">
                <span className="font-medium">{nomAffiche(utilisateur)}</span>
                <span className="hidden text-muted-foreground lg:inline"> · Superadministrateur</span>
              </span>
            </Link>
          ) : (
            <span className="ml-auto truncate text-sm text-muted-foreground">{email}</span>
          )}
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
