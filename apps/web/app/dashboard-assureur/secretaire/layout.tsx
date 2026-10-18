import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Secrétaire assurance' };

/** Garde du tableau de bord de la secrétaire de l'assurance : rendez-vous des patients et demandes des adhérents (messagerie). */
export default async function SecretaireLayout({ children }: { children: React.ReactNode }) {
  const etat = await exigerIdentite('/dashboard-assureur/secretaire');
  if (etat.kind !== 'ok') redirect('/dashboard');
  const route = etat.identity.permissions.dashboardRoute;
  if (route !== '/dashboard-assureur/secretaire') redirect(route ?? '/dashboard');
  return <>{children}</>;
}
