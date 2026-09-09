import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Médecin Conseil' };

export default async function MedecinConseilLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/medecin-conseil');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/medecin-conseil') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
