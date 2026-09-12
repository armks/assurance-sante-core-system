import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Comptable Adjoint — Assurance' };

/**
 * Garde propre à la vue d'ensemble Comptable adjoint — même principe que
 * `informatique-adjoint/layout.tsx`. Le rôle hérite de `ASSUREUR_COMPTABLE`
 * (roleChain, niveauAcces) ; seule sa `dashboardRoute` propre diffère.
 */
export default async function ComptableAdjointLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/comptable-adjoint');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/comptable-adjoint') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
