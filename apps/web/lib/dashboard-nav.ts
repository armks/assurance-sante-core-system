import {
  Building2,
  DoorOpen,
  FileText,
  HeartPulse,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Pill,
  ReceiptText,
  Scale,
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
const INFORMATIQUE_ADJOINT = '/dashboard-assureur/informatique-adjoint';
const DIRECTION = '/dashboard-assureur/direction';
const MEDECIN_CONSEIL = '/dashboard-assureur/medecin-conseil';
const PHARMACIEN_CONSEIL = '/dashboard-assureur/pharmacien-conseil';
const CENTRE_MEDICAL = '/dashboard-centre-medical';
const SOCIETE = '/dashboard-societe';

export const NAV_PAR_DASHBOARD: Record<string, NavItem[]> = {
  [SOCIETE]: [
    {
      label: 'Adhérents',
      href: `${SOCIETE}/administration/adherents`,
      icon: Users,
    },
  ],
  // Parcours de soins côté établissement : nav commune aux 4 sous-rôles
  // CENTRE_MEDICAL. Chaque écran retire ensuite ses propres actions selon le
  // rôle connecté (l'API reste seule juge).
  [CENTRE_MEDICAL]: [
    {
      label: 'Accueil — codes',
      href: `${CENTRE_MEDICAL}/accueil`,
      icon: DoorOpen,
    },
    {
      label: 'Dossiers de soins',
      href: `${CENTRE_MEDICAL}/medecin`,
      icon: Stethoscope,
    },
    {
      label: 'Facturation',
      href: `${CENTRE_MEDICAL}/comptable`,
      icon: ReceiptText,
    },
  ],
  [MEDECIN_CONSEIL]: [
    { label: "Vue d'ensemble", href: MEDECIN_CONSEIL, icon: LayoutDashboard },
    {
      label: 'Actes à homologuer',
      href: `${MEDECIN_CONSEIL}/actes-a-homologuer`,
      icon: Stethoscope,
    },
    {
      label: 'Réclamations en revue',
      href: `${MEDECIN_CONSEIL}/reclamations-revue`,
      icon: Scale,
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
  // Direction : vue d'ensemble propre + les écrans de gestion partagés avec
  // l'informatique (l'API autorise déjà ASSUREUR_DIRECTION sur ces modules).
  // Pas de Cotisations ni de réseau de soins : réservés à l'informatique.
  [DIRECTION]: [
    { label: "Vue d'ensemble", href: DIRECTION, icon: LayoutDashboard },
    {
      label: 'Souscripteurs',
      href: `${INFORMATIQUE}/souscripteurs`,
      icon: Building2,
    },
    { label: 'Produits', href: `${INFORMATIQUE}/produits`, icon: Package },
    { label: 'Polices', href: `${INFORMATIQUE}/polices`, icon: FileText },
    { label: 'Adhérents', href: `${INFORMATIQUE}/adherents`, icon: Users },
    {
      label: 'Réclamations',
      href: `${INFORMATIQUE}/reclamations`,
      icon: ReceiptText,
    },
    {
      label: 'Utilisateurs',
      href: `${INFORMATIQUE}/utilisateurs`,
      icon: Users,
      minNiveau: 'ADMIN',
    },
  ],
  [INFORMATIQUE]: navInformatique(INFORMATIQUE),
  // Informatique adjoint : rôle hérité de l'informatique (accès identique côté
  // API). Mêmes écrans, seule la vue d'ensemble pointe vers sa propre route ;
  // les boutons de validation finale sont retirés dans les écrans eux-mêmes
  // (cf. `peutValiderFinal` dans `lib/identity.ts`).
  [INFORMATIQUE_ADJOINT]: navInformatique(INFORMATIQUE_ADJOINT),
};

/**
 * Navigation de l'espace Assurance Informatique. `racineVueEnsemble` distingue
 * le titulaire (`/dashboard-assureur/informatique`) de l'adjoint
 * (`/dashboard-assureur/informatique-adjoint`) : les autres écrans sont partagés.
 */
function navInformatique(racineVueEnsemble: string): NavItem[] {
  return [
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard },
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
      label: 'Adhérents',
      href: `${INFORMATIQUE}/adherents`,
      icon: Users,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Réclamations',
      href: `${INFORMATIQUE}/reclamations`,
      icon: ReceiptText,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Utilisateurs',
      href: `${INFORMATIQUE}/utilisateurs`,
      icon: Users,
      minNiveau: 'ADMIN', // provisioning de comptes — modules identity + invitations
    },
  ];
}

export function navPourDashboard(dashboardRoute: string | null): NavItem[] {
  return (dashboardRoute && NAV_PAR_DASHBOARD[dashboardRoute]) || [];
}
