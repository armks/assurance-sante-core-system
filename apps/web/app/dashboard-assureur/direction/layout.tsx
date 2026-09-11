import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Direction' };

/**
 * Garde propre à la vue d'ensemble Direction. Le layout parent
 * (`dashboard-assureur/layout.tsx`) a déjà vérifié la session, l'entité ASSUREUR
 * et le provisioning ; on s'assure seulement que la `dashboardRoute` du rôle est
 * bien celle-ci.
 */
export default async function DirectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/direction');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/direction') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
