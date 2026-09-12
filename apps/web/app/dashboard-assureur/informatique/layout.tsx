import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = {
  title: 'Assurance Informatique',
};

/**
 * Garde propre à ce dashboard : si la `dashboardRoute` du rôle connecté n'est pas
 * celle-ci, on renvoie l'utilisateur vers la sienne (pas d'accès à un dashboard
 * d'un autre rôle en tapant l'URL).
 *
 * `ASSUREUR_DIRECTION` partage ces écrans de gestion (souscripteurs, produits,
 * polices, adhérents, réclamations, utilisateurs) : l'API l'autorise déjà sur
 * ces modules. Sa vue d'ensemble propre reste `/dashboard-assureur/direction`.
 * Les écrans réservés à l'informatique (cotisations, réseau de soins) renverront
 * un 403 côté API — ils ne figurent pas dans sa navigation.
 *
 * `ASSUREUR_INFORMATIQUE_ADJOINT` hérite du rôle informatique (roleChain,
 * niveauAcces) : mêmes écrans, sa vue d'ensemble propre est
 * `/dashboard-assureur/informatique-adjoint`. Son rôle propre porte
 * `peut_valider = false` : les boutons de validation finale sont retirés dans
 * chaque écran via `permissions.peutValider`.
 *
 * `ASSUREUR_EXPLOITATION`(_CONJOINTE) partage exactement les mêmes 4 écrans
 * que la direction — souscripteurs, polices, adhérents, réclamations
 * (`ROLES_GESTION_SOUSCRIPTEUR`/`ROLES_GESTION_POLICE`/`ROLES_GESTION_MEMBRE`/
 * `ROLES_LECTURE_CLAIMS` incluent les deux rôles de façon identique, vérifié
 * avant d'étendre cette liste). **Produits, Cotisations et Réseau de soins ne
 * figurent PAS dans sa navigation** : l'exploitation n'a aucun droit
 * d'écriture sur ces 3 modules (`ROLES_GESTION_PRODUIT`/`ROLES_GESTION_COTISATION`/
 * `ROLES_GESTION_RESEAU` ne l'incluent pas) et ces écrans ne masquent pas
 * encore leurs actions d'écriture selon le rôle — les y exposer en lecture
 * afficherait des boutons que l'API refuserait (403).
 */
const ROUTES_ADMIN_ASSUREUR = [
  '/dashboard-assureur/informatique',
  '/dashboard-assureur/informatique-adjoint',
  '/dashboard-assureur/direction',
  '/dashboard-assureur/exploitation',
  '/dashboard-assureur/exploitation-conjointe',
];

export default async function InformatiqueLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/informatique');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (!route || !ROUTES_ADMIN_ASSUREUR.includes(route)) {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
