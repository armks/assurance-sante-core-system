import {
  ArrowLeftRight,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileSignature,
  FileText,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  LineChart,
  BookMarked,
  Handshake,
  History,
  type LucideIcon,
  MapPin,
  Megaphone,
  Package,
  PackageCheck,
  Pill,
  ReceiptText,
  Scale,
  Settings,
  Stethoscope,
  Users,
  Wallet,
} from 'lucide-react';

import type { LargeurPage } from '@/lib/navigation';

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
  /** largeur du contenu de cette page (défaut : `liste`), voir `lib/navigation.ts`. */
  largeur?: LargeurPage;
  /** catégorie de menu (sous-menu repliable) — déduite du libellé, voir `GROUPE_PAR_LABEL`. */
  groupe?: GroupeNav;
}

export type CouleurGroupe = 'rose' | 'indigo' | 'teal' | 'emerald' | 'amber' | 'violet';
export interface GroupeNav {
  id: string;
  label: string;
  icon: LucideIcon;
  couleur: CouleurGroupe;
}

const GROUPES = {
  soins: { id: 'soins', label: 'Soins & prestations', icon: HeartPulse, couleur: 'rose' },
  clients: { id: 'clients', label: 'Clients & contrats', icon: Building2, couleur: 'indigo' },
  reseau: { id: 'reseau', label: 'Réseau & référentiels', icon: Handshake, couleur: 'teal' },
  finance: { id: 'finance', label: 'Finance', icon: Wallet, couleur: 'emerald' },
  communication: { id: 'communication', label: 'Communication', icon: Megaphone, couleur: 'amber' },
  admin: { id: 'admin', label: 'Administration', icon: Settings, couleur: 'violet' },
} as const satisfies Record<string, GroupeNav>;

/**
 * Catégorie de chaque entrée de menu. Un groupe qui ne compte qu'une entrée pour un rôle
 * donné reste un lien simple : seules les catégories de 2 entrées ou plus deviennent un sous-menu.
 */
const GROUPE_PAR_LABEL: Record<string, GroupeNav> = {
  'Accueil — codes': GROUPES.soins,
  Consultation: GROUPES.soins,
  Ordonnances: GROUPES.soins,
  Dispensations: GROUPES.soins,
  'Pré-autorisations': GROUPES.soins,
  'Dossiers de soins': GROUPES.soins,
  Contestations: GROUPES.soins,
  Réclamations: GROUPES.soins,
  'Réclamations en revue': GROUPES.soins,
  Prescriptions: GROUPES.soins,
  'Questionnaires médicaux': GROUPES.soins,
  Tarifications: GROUPES.soins,
  Souscripteurs: GROUPES.clients,
  Produits: GROUPES.clients,
  Polices: GROUPES.clients,
  Adhérents: GROUPES.clients,
  'Mes bénéficiaires': GROUPES.clients,
  'Entrants / sortants': GROUPES.clients,
  'Demandes d’adhésion': GROUPES.clients,
  Établissements: GROUPES.reseau,
  Pharmacies: GROUPES.reseau,
  Conventions: GROUPES.reseau,
  'Tarifs proposés': GROUPES.reseau,
  'Actes du catalogue': GROUPES.reseau,
  'Médicaments du catalogue': GROUPES.reseau,
  'Médicaments remboursables': GROUPES.reseau,
  'Référentiel médical': GROUPES.reseau,
  'Catalogue national': GROUPES.reseau,
  'Réseau de soins': GROUPES.reseau,
  Cotisations: GROUPES.finance,
  'Comptes financiers': GROUPES.finance,
  'Mouvements & dépenses': GROUPES.finance,
  'Factures pharmacie': GROUPES.finance,
  'Factures établissements': GROUPES.finance,
  'Factures mensuelles': GROUPES.finance,
  'Factures des prescriptions': GROUPES.finance,
  'Suivi des paiements': GROUPES.finance,
  'Facturation sociétés': GROUPES.finance,
  'Suivi des dispensations': GROUPES.finance,
  Facturation: GROUPES.finance,
  'Mes factures': GROUPES.finance,
  'Facture mensuelle': GROUPES.finance,
  Factures: GROUPES.finance,
  Événements: GROUPES.communication,
  Annonces: GROUPES.communication,
  'Logos partenaires': GROUPES.communication,
  Utilisateurs: GROUPES.admin,
  'Journal des actions': GROUPES.admin,
};

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
const ADHERENT_INDIVIDUEL = '/dashboard-adherent/individuel';
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
    { label: "Vue d'ensemble", href: ADHERENT, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Mes bénéficiaires',
      href: `${ADHERENT}/beneficiaires`,
      icon: Users,
    },
    {
      label: 'Consultation',
      href: `${ADHERENT}/consultation`,
      icon: Stethoscope,
    },
    { label: 'Ordonnances', href: `${ADHERENT}/ordonnances`, icon: Pill },
    {
      label: 'Dispensations',
      href: `${ADHERENT}/dispensations`,
      icon: PackageCheck,
    },
    { label: 'Factures', href: `${ADHERENT}/factures`, icon: ReceiptText },
    { label: 'Réclamations', href: `${ADHERENT}/reclamations`, icon: Scale },
    { label: 'Réseau de soins', href: `${ADHERENT}/reseau-de-soins`, icon: MapPin },
  ],
  // SOUSCRIPTEUR_INDIVIDUEL : rôle distinct d'ADHERENT_TITULAIRE (même entité
  // ADHERENT, dashboardRoute propre en base). Le narrowing au seul dossier de
  // souscription (questionnaire médical + tarification, module `underwriting/`)
  // était une limite de périmètre du prompt du 2026-09-15 (« hors périmètre de
  // ce prompt »), pas une décision métier — vérifié avant d'élargir (2026-09-24) :
  // aucune raison de sécurité/produit trouvée, ROLES_ADHERENT traite déjà ce
  // rôle à l'identique d'ADHERENT_TITULAIRE côté API pour ces écrans. Les liens
  // pointent vers les mêmes routes que `[ADHERENT]` (le layout ne distingue le
  // rôle que par `dashboardRoute`, la page sous-jacente est partagée) — jamais
  // de duplication. « Mes bénéficiaires » et « Réclamations » restent hors
  // périmètre, non demandés pour ce rôle.
  [ADHERENT_INDIVIDUEL]: [
    { label: "Vue d'ensemble", href: ADHERENT_INDIVIDUEL, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Consultation',
      href: `${ADHERENT}/consultation`,
      icon: Stethoscope,
    },
    { label: 'Ordonnances', href: `${ADHERENT}/ordonnances`, icon: Pill },
    {
      label: 'Dispensations',
      href: `${ADHERENT}/dispensations`,
      icon: PackageCheck,
    },
    { label: 'Factures', href: `${ADHERENT}/factures`, icon: ReceiptText },
  ],
  // Espace PHARMACIE — module `pharmacy/` (verrou par ligne). Pharmacien et
  // caissière partagent le même écran de dispensation (`DispensationFlowEcran`,
  // ROLES_PHARMACIE ne distingue pas ces 2 rôles sur la préparation, vérifié) ;
  // seul « Médicaments remboursables » (catalogue national, liste de la pharmacie) est propre au pharmacien.
  [PHARMACIEN]: [
    { label: "Vue d'ensemble", href: PHARMACIEN, icon: LayoutDashboard },
    { label: 'Factures des prescriptions', href: `${PHARMACIEN}/factures`, icon: ReceiptText },
    {
      label: 'Médicaments remboursables',
      href: `${PHARMACIEN}/medicaments`,
      icon: Pill,
    },
    {
      label: 'Contestations',
      href: `${PHARMACIEN}/contestations`,
      icon: Scale,
    },
    {
      label: 'Factures mensuelles',
      href: `${PHARMACIEN}/factures-mensuelles`,
      icon: CreditCard,
    },
  ],
  [CAISSIERE]: [
    { label: "Vue d'ensemble", href: CAISSIERE, icon: LayoutDashboard },
    { label: 'Factures des prescriptions', href: `${CAISSIERE}/factures`, icon: ReceiptText },
  ],
  [PHARMACIE_COMPTABLE]: [
    {
      label: 'Suivi des dispensations',
      href: PHARMACIE_COMPTABLE,
      icon: ReceiptText,
    },
    {
      label: 'Factures des prescriptions',
      href: `${PHARMACIE_COMPTABLE}/factures`,
      icon: ReceiptText,
    },
    {
      label: 'Factures mensuelles',
      href: `${PHARMACIE_COMPTABLE}/factures-mensuelles`,
      icon: CreditCard,
    },
    {
      label: 'Contestations',
      href: `${PHARMACIE_COMPTABLE}/contestations`,
      icon: Scale,
    },
  ],
  [SOCIETE_ADMINISTRATION]: [
    {
      label: 'Adhérents',
      href: `${SOCIETE_ADMINISTRATION}/adherents`,
      icon: Users,
    },
    {
      label: 'Entrants / sortants',
      href: `${SOCIETE_ADMINISTRATION}/mouvements`,
      icon: ArrowLeftRight,
    },
    {
      label: 'Réclamations',
      href: `${SOCIETE_ADMINISTRATION}/reclamations`,
      icon: Scale,
    },
  ],
  // Contact principal de l'entreprise cliente : vue d'ensemble propre +
  // renvoi vers les écrans adhérents/réclamations déjà construits pour
  // SOCIETE_ADMINISTRATION (URL partagée — lecture seule sur les adhérents,
  // l'API ne lui accorde pas l'écriture directe ; peut en revanche PROPOSER
  // des ajouts, cf. `ROLES_PROPOSITION_ADHERENTS_SOCIETE` ; réclamations en
  // lecture pour ses propres adhérents, cf. `ROLES_SOCIETE_CLAIMS`).
  [SOCIETE_ASSUREE]: [
    { label: "Vue d'ensemble", href: SOCIETE_ASSUREE, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Adhérents',
      href: `${SOCIETE_ADMINISTRATION}/adherents`,
      icon: Users,
    },
    {
      label: 'Entrants / sortants',
      href: `${SOCIETE_ADMINISTRATION}/mouvements`,
      icon: ArrowLeftRight,
    },
    {
      label: 'Réclamations',
      href: `${SOCIETE_ADMINISTRATION}/reclamations`,
      icon: Scale,
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
    {
      label: 'Mes factures',
      href: `${CENTRE_MEDICAL}/mes-factures`,
      icon: CreditCard,
    },
    {
      label: 'Facture mensuelle',
      href: `${CENTRE_MEDICAL}/facture-mensuelle`,
      icon: Wallet,
    },
    {
      label: 'Contestations',
      href: `${CENTRE_MEDICAL}/contestations`,
      icon: Scale,
    },
    // Tarifs proposés pour les actes non tarifables (lot barème 4) : comptable et administratif
    { label: 'Tarifs proposés', href: `${CENTRE_MEDICAL}/tarifs-proposes`, icon: FileSignature },
  ],
  [MEDECIN_CONSEIL]: [
    { label: "Vue d'ensemble", href: MEDECIN_CONSEIL, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Actes du catalogue',
      href: `${MEDECIN_CONSEIL}/actes-a-homologuer`,
      icon: Stethoscope,
    },
    // Validation des conventions des établissements (jamais de sa propre saisie) — lot barème 2
    { label: 'Conventions', href: `${MEDECIN_CONSEIL}/conventions`, icon: FileSignature },
    // File des tarifs proposés par les établissements pour les actes non tarifables — lot barème 5
    { label: 'Tarifs proposés', href: `${MEDECIN_CONSEIL}/tarifs-proposes`, icon: FileSignature },
    {
      label: 'Pré-autorisations',
      href: `${MEDECIN_CONSEIL}/preautorisations`,
      icon: ClipboardList,
    },
    { label: 'Dossiers de soins', href: `${MEDECIN_CONSEIL}/dossiers`, icon: Stethoscope },
    {
      label: 'Réclamations en revue',
      href: `${MEDECIN_CONSEIL}/reclamations-revue`,
      icon: Scale,
    },
    {
      label: 'Contestations',
      href: `${MEDECIN_CONSEIL}/contestations`,
      icon: FileText,
    },
    {
      label: 'Factures établissements',
      href: `${MEDECIN_CONSEIL}/factures-etablissement`,
      icon: CreditCard,
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
    { label: "Vue d'ensemble", href: PHARMACIEN_CONSEIL, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Médicaments du catalogue',
      href: `${PHARMACIEN_CONSEIL}/medicaments-a-homologuer`,
      icon: Pill,
    },
    {
      label: 'Factures mensuelles',
      href: `${PHARMACIEN_CONSEIL}/factures-mensuelles`,
      icon: CreditCard,
    },
    {
      label: 'Prescriptions',
      href: `${PHARMACIEN_CONSEIL}/prescriptions`,
      icon: FileText,
    },
    { label: 'Dossiers de soins', href: `${PHARMACIEN_CONSEIL}/dossiers`, icon: Stethoscope },
  ],
  // Direction : vue d'ensemble propre + les écrans de gestion partagés avec
  // l'informatique (l'API autorise déjà ASSUREUR_DIRECTION sur ces modules).
  // Pas de Cotisations ni de réseau de soins : réservés à l'informatique.
  [DIRECTION]: [
    { label: "Vue d'ensemble", href: DIRECTION, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Souscripteurs',
      href: `${INFORMATIQUE}/souscripteurs`,
      icon: Building2,
    },
    { label: 'Produits', href: `${INFORMATIQUE}/produits`, icon: Package },
    { label: 'Polices', href: `${INFORMATIQUE}/polices`, icon: FileText },
    { label: 'Adhérents', href: `${INFORMATIQUE}/adherents`, icon: Users },
    // Validation des conventions des établissements (lot barème 2)
    { label: 'Conventions', href: `${DIRECTION}/conventions`, icon: FileSignature },
    // Tarifs proposés non décidés (escalade J+5) : lecture seule — lot barème 5
    { label: 'Tarifs proposés', href: `${DIRECTION}/tarifs-proposes`, icon: FileSignature },
    { label: 'Journal des actions', href: `${DIRECTION}/journal-actions`, icon: History },
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
  // « Comptes financiers » N'EST PAS partagé avec l'adjoint (contrairement au
  // reste de cette liste) : réservé EXCLUSIVEMENT au rôle EXACT
  // ASSUREUR_COMPTABLE côté API (ROLES_GESTION_COMPTES_FINANCIERS,
  // payment.types.ts) — ajouté SEULEMENT à l'entrée du titulaire, jamais via
  // `navComptable()` qui reste partagé.
  [COMPTABLE]: [
    ...navComptable(COMPTABLE),
    {
      label: 'Comptes financiers',
      href: `${COMPTABLE}/comptes-financiers`,
      icon: Wallet,
    },
    {
      label: 'Mouvements & dépenses',
      href: `${COMPTABLE}/mouvements-financiers`,
      icon: Wallet,
    },
  ],
  [COMPTABLE_ADJOINT]: navComptable(COMPTABLE_ADJOINT),
  // « Comptes financiers » (cycle de vie : libellé, archivage, suppression — ADR-007 lot 5) : rôle EXACT
  // informatique seulement, jamais l'adjoint (ROLES_CYCLE_COMPTES_FINANCIERS, payment.types.ts).
  [INFORMATIQUE]: [
    ...navInformatique(INFORMATIQUE),
    { label: 'Comptes financiers', href: `${INFORMATIQUE}/comptes-financiers`, icon: Wallet },
  ],
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
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard, largeur: 'dashboard' },
    {
      label: 'Pré-autorisations',
      href: `${racineVueEnsemble}/preautorisations`,
      icon: ClipboardList,
    },
    // Écran ajouté pour exercer un droit déjà existant côté API mais jusque-là
    // sans aucune interface : la clôture forcée est réservée à
    // ASSUREUR_EXPLOITATION (ROLE_CLOTURE_FORCEE, care-episode.types.ts).
    // Direction/Informatique/Médecin-conseil peuvent aussi LIRE tous les
    // dossiers côté API (ROLES_LECTURE_DOSSIER_STAFF) mais n'ont pas ce
    // besoin métier documenté — écran non ajouté à leur navigation.
    {
      label: 'Dossiers de soins',
      href: `${INFORMATIQUE}/dossiers`,
      icon: Stethoscope,
    },
    {
      label: 'Réclamations',
      href: `${INFORMATIQUE}/reclamations`,
      icon: ReceiptText,
    },
    {
      label: 'Souscripteurs',
      href: `${INFORMATIQUE}/souscripteurs`,
      icon: Building2,
    },
    { label: 'Polices', href: `${INFORMATIQUE}/polices`, icon: FileText },
    { label: 'Adhérents', href: `${INFORMATIQUE}/adherents`, icon: Users },
    // Demandes du formulaire « Adhésion » (ROLES_DEMANDES_ADHESION =
    // INFORMATIQUE + EXPLOITATION, vitrine.types.ts).
    { label: 'Demandes d’adhésion', href: `${INFORMATIQUE}/demandes-adhesion`, icon: Inbox },
  ];
}

/**
 * Navigation Comptable / Comptable adjoint — un seul écran partagé où ce rôle
 * a une écriture réelle vérifiée (`ROLES_GESTION_BILLING`). Voir le
 * commentaire de `NAV_PAR_DASHBOARD` pour le détail des exclusions.
 */
function navComptable(racineVueEnsemble: string): NavItem[] {
  return [
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard, largeur: 'dashboard' },
    { label: 'Cotisations', href: `${INFORMATIQUE}/cotisations`, icon: Wallet },
    {
      label: 'Factures pharmacie',
      href: `${racineVueEnsemble}/factures-pharmacie`,
      icon: CreditCard,
    },
    {
      label: 'Factures établissements',
      href: `${racineVueEnsemble}/factures-etablissement`,
      icon: CreditCard,
    },
    {
      label: 'Suivi des paiements',
      href: `${racineVueEnsemble}/paiements`,
      icon: LineChart,
    },
    {
      label: 'Facturation sociétés',
      href: `${racineVueEnsemble}/facturation-societes`,
      icon: Building2,
    },
  ];
}

function navInformatique(racineVueEnsemble: string): NavItem[] {
  return [
    { label: "Vue d'ensemble", href: racineVueEnsemble, icon: LayoutDashboard, largeur: 'dashboard' },
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
    // Conventions des établissements (lot barème 2) : saisie par l'assurance informatique, lecture pour l'adjoint.
    {
      label: 'Conventions',
      href: `${INFORMATIQUE}/conventions`,
      icon: FileSignature,
      minNiveau: 'LECTURE_SEULE',
    },
    {
      label: 'Pharmacies',
      href: `${INFORMATIQUE}/pharmacies`,
      icon: Pill,
      minNiveau: 'LECTURE_SEULE',
    },
    // Événements de la page d'accueil : ASSUREUR_INFORMATIQUE EXCLUSIVEMENT (rôle
    // exact côté API et RLS) — absent de la navigation de l'adjoint.
    ...(racineVueEnsemble === INFORMATIQUE
      ? [{ label: 'Événements', href: `${INFORMATIQUE}/evenements`, icon: CalendarDays }]
      : []),
    // Annonces du bandeau défilant du bas de la page d'accueil de SA société : même rôle exact que les événements.
    ...(racineVueEnsemble === INFORMATIQUE
      ? [{ label: 'Annonces', href: `${INFORMATIQUE}/annonces`, icon: Megaphone }]
      : []),
    // Logos des partenaires du bandeau défilant de la page d'accueil de SA société : même rôle exact que les événements.
    ...(racineVueEnsemble === INFORMATIQUE
      ? [{ label: 'Logos partenaires', href: `${INFORMATIQUE}/partenaires`, icon: Handshake }]
      : []),
    // Demandes du formulaire « Adhésion » (ROLES_DEMANDES_ADHESION, vitrine.types.ts).
    { label: 'Demandes d’adhésion', href: `${INFORMATIQUE}/demandes-adhesion`, icon: Inbox },
    // Création directe d'actes/médicaments (ROLE_PROPOSITION = ASSUREUR_INFORMATIQUE,
    // reference.types.ts) — homologation restant réservée au médecin conseil /
    // pharmacien conseil sur leurs propres écrans.
    {
      label: 'Référentiel médical',
      href: `${INFORMATIQUE}/referentiel-medical`,
      icon: Stethoscope,
      minNiveau: 'LECTURE_SEULE',
    },
    // Mise à jour du catalogue national, comme le superadmin (ADR-009) — ASSUREUR_INFORMATIQUE exclusivement.
    ...(racineVueEnsemble === INFORMATIQUE
      ? [{ label: 'Catalogue national', href: `${INFORMATIQUE}/catalogue-national`, icon: BookMarked }]
      : []),
    // Traçabilité : qui a fait quoi (informatique et direction de l'assureur)
    { label: 'Journal des actions', href: `${INFORMATIQUE}/journal-actions`, icon: History },
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
  const items = (dashboardRoute && NAV_PAR_DASHBOARD[dashboardRoute]) || [];
  return items.map((i) => ({ ...i, groupe: GROUPE_PAR_LABEL[i.label] }));
}
