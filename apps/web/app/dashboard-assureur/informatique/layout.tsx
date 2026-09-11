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
 */
const ROUTES_ADMIN_ASSUREUR = [
  '/dashboard-assureur/informatique',
  '/dashboard-assureur/direction',
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
