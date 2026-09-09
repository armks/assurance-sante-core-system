import {
  Building2,
  FileText,
  HeartPulse,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Pill,
  Stethoscope,
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
const MEDECIN_CONSEIL = '/dashboard-assureur/medecin-conseil';
const PHARMACIEN_CONSEIL = '/dashboard-assureur/pharmacien-conseil';

export const NAV_PAR_DASHBOARD: Record<string, NavItem[]> = {
  [MEDECIN_CONSEIL]: [
    { label: "Vue d'ensemble", href: MEDECIN_CONSEIL, icon: LayoutDashboard },
    {
      label: 'Actes à homologuer',
      href: `${MEDECIN_CONSEIL}/actes-a-homologuer`,
      icon: Stethoscope,
    },
  ],
  [PHARMACIEN_CONSEIL]: [
    { label: "Vue d'ensemble", href: PHARMACIEN_CONSEIL, icon: LayoutDashboard },
    {
      label: 'Médicaments à homologuer',
      href: `${PHARMACIEN_CONSEIL}/medicaments-a-homologuer`,
      icon: Pill,
    },
  ],
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
      label: 'Établissements',
      href: `${INFORMATIQUE}/etablissements`,
      icon: HeartPulse,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Pharmacies',
      href: `${INFORMATIQUE}/pharmacies`,
      icon: Pill,
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
