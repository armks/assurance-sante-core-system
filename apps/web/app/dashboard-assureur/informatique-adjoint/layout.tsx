import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Assurance Informatique (adjoint)' };

/**
 * Garde de la vue d'ensemble « informatique adjoint ». Les écrans de gestion
 * eux-mêmes vivent sous `/dashboard-assureur/informatique/*` : leur layout
 * accepte déjà la `dashboardRoute` de l'adjoint.
 */
export default async function InformatiqueAdjointLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/informatique-adjoint');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/informatique-adjoint') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
