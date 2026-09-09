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
 */
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
  if (route !== '/dashboard-assureur/informatique') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
