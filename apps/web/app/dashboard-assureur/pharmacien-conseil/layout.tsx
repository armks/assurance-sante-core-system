import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Pharmacien Conseil' };

export default async function PharmacienConseilLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/pharmacien-conseil');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/pharmacien-conseil') {
    redirect(route ?? '/dashboard');
  }
  return <>{children}</>;
}
