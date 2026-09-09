import {
  Building2,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Users,
  Wallet,
} from 'lucide-react';

export type NiveauAcces = 'LECTURE_SEULE' | 'MODIFICATION' | 'ADMIN';

export const RANG_NIVEAU: Record<NiveauAcces, number> = {
  LECTURE_SEULE: 0,
  MODIFICATION: 1,
  ADMIN: 2,
};

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** niveau d'accès minimal pour voir la section (défaut : LECTURE_SEULE). */
  minNiveau?: NiveauAcces;
  /** la section n'apparaît que si le rôle `peutValider`. */
  requiertValidation?: boolean;
  /** section pas encore implémentée — affichée mais non cliquable. */
  bientot?: boolean;
}

/**
 * Navigation par dashboard de rôle. La clé est la `dashboardRoute` renvoyée par
 * `GET /api/v1/identity/me`. Le `DashboardShell` filtre ces items selon
 * `niveauAcces` / `peutValider` : on n'affiche jamais un lien vers une action que
 * la RLS Postgres refuserait ensuite (règle transverse du skill).
 */
const INFORMATIQUE = '/dashboard-assureur/informatique';

export const NAV_PAR_DASHBOARD: Record<string, NavItem[]> = {
  [INFORMATIQUE]: [
    { label: "Vue d'ensemble", href: INFORMATIQUE, icon: LayoutDashboard },
    {
      label: 'Souscripteurs',
      href: `${INFORMATIQUE}/souscripteurs`,
      icon: Building2,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Produits',
      href: `${INFORMATIQUE}/produits`,
      icon: Package,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Polices',
      href: `${INFORMATIQUE}/polices`,
      icon: FileText,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Cotisations',
      href: `${INFORMATIQUE}/cotisations`,
      icon: Wallet,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Utilisateurs',
      href: `${INFORMATIQUE}/utilisateurs`,
      icon: Users,
      minNiveau: 'ADMIN', // provisioning de comptes — modules identity + invitations
    },
  ],
};

export function navPourDashboard(dashboardRoute: string | null): NavItem[] {
  return (dashboardRoute && NAV_PAR_DASHBOARD[dashboardRoute]) || [];
}
