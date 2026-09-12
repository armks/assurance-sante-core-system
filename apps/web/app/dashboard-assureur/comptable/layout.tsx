import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Assurance Comptable' };

/**
 * Garde propre à la vue d'ensemble Comptable. Le layout parent
 * (`dashboard-assureur/layout.tsx`) a déjà vérifié la session, l'entité
 * ASSUREUR et le provisioning. L'écran de gestion partagé (Cotisations) vit
 * sous `/dashboard-assureur/informatique/*` : son layout accepte déjà la
 * `dashboardRoute` comptable (voir `ROUTES_ADMIN_ASSUREUR`).
 */
export default async function ComptableLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/comptable');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/comptable') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
