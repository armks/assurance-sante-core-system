import {
  Building2,
  ClipboardList,
  CreditCard,
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
const EXPLOITATION = '/dashboard-assureur/exploitation';
const EXPLOITATION_CONJOINTE = '/dashboard-assureur/exploitation-conjointe';
const COMPTABLE = '/dashboard-assureur/comptable';
const COMPTABLE_ADJOINT = '/dashboard-assureur/comptable-adjoint';
const MEDECIN_CONSEIL = '/dashboard-assureur/medecin-conseil';
const MEDECIN_SOUSCRIPTEUR = '/dashboard-assureur/medecin-souscripteur';
const PHARMACIEN_CONSEIL = '/dashboard-assureur/pharmacien-conseil';
const CENTRE_MEDICAL = '/dashboard-centre-medical';
const ADHERENT = '/dashboard-adherent';
const PHARMACIEN = '/dashboard-pharmacie/pharmacien';
const CAISSIERE = '/dashboard-pharmacie/caissiere';
const PHARMACIE_COMPTABLE = '/dashboard-pharmacie/comptable';
const SOCIETE_ADMINISTRATION = '/dashboard-societe/administration';
const SOCIETE_ASSUREE = '/dashboard-societe/assuree';
const SOCIETE_COMPTABLE = '/dashboard-societe/comptable';
const SOCIETE_RECEPTION = '/dashboard-societe/reception';

export const NAV_PAR_DASHBOARD: Record<string, NavItem[]> = {
  // Espace ADHERENT (ADHERENT_TITULAIRE / SOUSCRIPTEUR_INDIVIDUEL) : self-service,
  // aucune donnée d'un autre adhérent n'est jamais exposée (voir les fix de
  // scoping member/claims/preauthorization de l'audit dashboard adhérent).
  [ADHERENT]: [
    { label: "Vue d'ensemble", href: ADHERENT, icon: LayoutDashboard },
    {
      label: 'Consultation',
      href: `${ADHERENT}/consultation`,
      icon: Stethoscope,
    },
    { label: 'Ordonnances', href: `${ADHERENT}/ordonnances`, icon: Pill },
    { label: 'Factures', href: `${ADHERENT}/factures`, icon: ReceiptText },
    { label: 'Réclamations', href: `${ADHERENT}/reclamations`, icon: Scale },
    { label: 'Ma carte', href: `${ADHERENT}/carte`, icon: CreditCard },
  ],
  // Espace PHARMACIE — module `pharmacy/` (verrou par ligne). Pharmacien et
  // caissière partagent le même écran de dispensation (`DispensationFlowEcran`,
  // ROLES_PHARMACIE ne distingue pas ces 2 rôles sur la préparation, vérifié) ;
  // seuls « Mon stock » (écriture réservée au pharmacien, `assertPharmacien`)
  // et « Médicaments remboursables » (référentiel national, lecture seule)
  // sont propres au pharmacien.
  [PHARMACIEN]: [
    { label: "Vue d'ensemble", href: PHARMACIEN, icon: LayoutDashboard },
    { label: 'Mon stock', href: `${PHARMACIEN}/stock`, icon: Wallet },
    {
      label: 'Médicaments remboursables',
      href: `${PHARMACIEN}/medicaments`,
      icon: Pill,
    },
  ],
  [CAISSIERE]: [{ label: "Vue d'ensemble", href: CAISSIERE, icon: LayoutDashboard }],
  [PHARMACIE_COMPTABLE]: [
    {
      label: 'Suivi des dispensations',
      href: PHARMACIE_COMPTABLE,
      icon: ReceiptText,
    },
  ],
  [SOCIETE_ADMINISTRATION]: [
    {
      label: 'Adhérents',
      href: `${SOCIETE_ADMINISTRATION}/adherents`,
      icon: Users,
    },
  ],
  // Contact principal de l'entreprise cliente : vue d'ensemble propre +
  // renvoi vers l'écran adhérents déjà construit pour SOCIETE_ADMINISTRATION
  // (lecture seule pour ce rôle — l'API ne lui accorde pas l'écriture).
  [SOCIETE_ASSUREE]: [
    { label: "Vue d'ensemble", href: SOCIETE_ASSUREE, icon: LayoutDashboard },
    {
      label: 'Adhérents',
      href: `${SOCIETE_ADMINISTRATION}/adherents`,
      icon: Users,
    },
  ],
  // Lecture des cotisations/factures de la société ; pas de confirmation de
  // paiement (réservée à ASSUREUR_COMPTABLE / ASSUREUR_INFORMATIQUE côté API).
  [SOCIETE_COMPTABLE]: [
    { label: 'Cotisations', href: SOCIETE_COMPTABLE, icon: Wallet },
  ],
  // LECTURE_SEULE explicite (niveau posé en base) : aucune action d'écriture.
  [SOCIETE_RECEPTION]: [
    { label: 'Adhérents', href: SOCIETE_RECEPTION, icon: Users },
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
  [MEDECIN_SOUSCRIPTEUR]: [
    {
      label: 'Questionnaires médicaux',
      href: MEDECIN_SOUSCRIPTEUR,
      icon: ClipboardList,
    },
    {
      label: 'Tarifications',
      href: `${MEDECIN_SOUSCRIPTEUR}/tarifications`,
      icon: Wallet,
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
  // Exploitation (+ conjointe, rôle hérité — même chaîne de rôles, mêmes
  // droits API sur ces 4 modules, vérifié avant construction). Ni Produits
  // (ROLES_GESTION_PRODUIT ne l'inclut pas), ni Cotisations/Réseau de soins
  // (réservés à l'informatique) : ces écrans ne masquent pas encore leurs
  // actions d'écriture selon le rôle, les exposer en lecture y afficherait
  // des boutons que l'API refuserait. Pas de section Utilisateurs : niveau
  // MODIFICATION, pas ADMIN.
  [EXPLOITATION]: navExploitation(EXPLOITATION),
  [EXPLOITATION_CONJOINTE]: navExploitation(EXPLOITATION_CONJOINTE),
  // Comptable (+ adjoint) : le SEUL écran partagé où ce rôle a une écriture
  // réelle est Cotisations (`ROLES_GESTION_BILLING` = COMPTABLE + INFORMATIQUE,
  // vérifié). Ni Souscripteurs/Polices/Adhérents/Produits/Réseau (aucune
  // écriture, même raison que l'exclusion Exploitation ci-dessus), ni
  // Réclamations (`ROLES_LECTURE_CLAIMS` ne l'inclut PAS — contrairement à
  // Exploitation, aucun accès du tout, pas même en lecture), ni Utilisateurs
  // (jamais créateur ni validateur dans `regles_provisioning`).
  [COMPTABLE]: navComptable(COMPTABLE),
  [COMPTABLE_ADJOINT]: navComptable(COMPTABLE_ADJOINT),
  [INFORMATIQUE]: navInformatique(INFORMATIQUE),
  // Informatique adjoint : rôle hérité de l'informatique (roleChain, niveauAcces).
  // Mêmes écrans, seule la vue d'ensemble pointe vers sa propre route ; les
  // boutons de validation finale sont retirés dans les écrans eux-mêmes via
  // `permissions.peutValider` (false pour ce rôle).
  [INFORMATIQUE_ADJOINT]: navInformatique(INFORMATIQUE_ADJOINT),
};

/**
 * Navigation de l'espace Assurance Informatique. `racineVueEnsemble` distingue
 * le titulaire (`/dashboard-assureur/informatique`) de l'adjoint
 * (`/dashboard-assureur/informatique-adjoint`) : les autres écrans sont partagés.
 */
/**
 * Navigation Exploitation / Exploitation conjointe — droits API identiques
 * sur ces 4 modules (`ROLES_GESTION_SOUSCRIPTEUR`/`ROLES_GESTION_POLICE`/
 * `ROLES_GESTION_MEMBRE`/`ROLES_LECTURE_CLAIMS`), vérifié explicitement.
 */
function navExploitation(racineVueEnsemble: string): NavItem[] {
  return [
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard },
    {
      label: 'Souscripteurs',
      href: `${INFORMATIQUE}/souscripteurs`,
      icon: Building2,
    },
    { label: 'Polices', href: `${INFORMATIQUE}/polices`, icon: FileText },
    { label: 'Adhérents', href: `${INFORMATIQUE}/adherents`, icon: Users },
    {
      label: 'Réclamations',
      href: `${INFORMATIQUE}/reclamations`,
      icon: ReceiptText,
    },
  ];
}

/**
 * Navigation Comptable / Comptable adjoint — un seul écran partagé où ce rôle
 * a une écriture réelle vérifiée (`ROLES_GESTION_BILLING`). Voir le
 * commentaire de `NAV_PAR_DASHBOARD` pour le détail des exclusions.
 */
function navComptable(racineVueEnsemble: string): NavItem[] {
  return [
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard },
    { label: 'Cotisations', href: `${INFORMATIQUE}/cotisations`, icon: Wallet },
  ];
}

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
